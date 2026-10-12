// TAL-71 — lanzador de la batería E2E de regresión (`npm run test:e2e:regresion`).
// Ver docs/e2e.md § "Batería de regresión (TAL-71)". En este orden:
// 1. salvaguardas: nunca producción (dev: + hostnames coherentes + lista de
//    denegación), nunca `--prod`, `E2E_PORT` explícito → exit 2;
// 2. el conjunto de tests `@regresion` es idéntico al manifiesto → exit 3;
// 3. cerrojo `.e2e-suite-lock` (mkdir atómico, owner con token, espera si
//    está tomado; un cerrojo huérfano NO se borra: se avisa y se espera);
// 4. Playwright con `--grep @regresion`; las señales se reenvían SOLO a ese
//    hijo y se espera a que termine antes de soltar el cerrojo;
// 5. resumen (ejecutados, pasados, fallidos, omitidos, espera del cerrojo y
//    duración de Playwright por separado); un omitido hace fallar la batería
//    (exit 1), salvo con `--list` (solo lista, no ejecuta nada).
// Nunca mata procesos por patrón.
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = path.join(ROOT, "e2e", "regresion.manifest.json");
const LOCK_POLL_MS = Number(process.env.TAL71_LOCK_POLL_MS ?? 15_000);
const PORTS = "T1 3000 · T2 3001 · T3 3002";

// Deployments de PRODUCCIÓN conocidos: la batería se niega a apuntar a ellos
// aunque todo lo demás cuadre. Capa extra sobre la defensa principal (dev: +
// hostnames coherentes). Para añadir uno: su slug aquí, con de qué proyecto es.
const DENIED_PROD_SLUGS = [
  "abundant-badger-144", // calendario-adviento (producción real, docs/stack.md)
  "standing-jellyfish-468", // calendario-adviento-t2
  // calendario-adviento-t3: no documentado (no se consulta con --prod).
];

const args = process.argv.slice(2);

function abort(code, message) {
  console.error(`✗ batería de regresión: ${message}`);
  process.exit(code);
}

// --- 1 · salvaguardas --------------------------------------------------------------------------
config({ path: path.join(ROOT, ".env.local"), quiet: true });
config({ path: path.join(ROOT, ".env"), quiet: true });

if (args.some((a) => a === "--prod" || a.startsWith("--prod="))) abort(2, "prohibido --prod.");
if (!process.env.E2E_PORT) abort(2, `falta E2E_PORT explícito (${PORTS}); sin él Playwright podría reutilizar el next dev de otra terminal.`);

const deployment = (process.env.CONVEX_DEPLOYMENT ?? "").trim();
if (!deployment.startsWith("dev:")) abort(2, `CONVEX_DEPLOYMENT debe ser un deployment dev: (es «${deployment || "vacío"}»).`);
const slug = deployment.slice("dev:".length).trim().split(/\s+/)[0];
if (!slug) abort(2, "CONVEX_DEPLOYMENT dev: sin slug.");

function hostOf(name) {
  const raw = process.env[name];
  if (!raw) abort(2, `falta ${name}.`);
  try {
    return new URL(raw).hostname;
  } catch {
    abort(2, `${name} no es una URL válida.`);
  }
}
const cloudHost = hostOf("NEXT_PUBLIC_CONVEX_URL");
const siteHost = hostOf("NEXT_PUBLIC_CONVEX_SITE_URL");
for (const denied of DENIED_PROD_SLUGS) {
  for (const [what, value] of [["CONVEX_DEPLOYMENT", slug], ["NEXT_PUBLIC_CONVEX_URL", cloudHost], ["NEXT_PUBLIC_CONVEX_SITE_URL", siteHost]]) {
    if (value === denied || value.startsWith(`${denied}.`)) abort(2, `${what} apunta a producción (${denied}, lista de denegación).`);
  }
}
if (cloudHost !== `${slug}.convex.cloud`) abort(2, `NEXT_PUBLIC_CONVEX_URL (${cloudHost}) no es ${slug}.convex.cloud del CONVEX_DEPLOYMENT dev:${slug}.`);
if (siteHost !== `${slug}.convex.site`) abort(2, `NEXT_PUBLIC_CONVEX_SITE_URL (${siteHost}) no es ${slug}.convex.site del CONVEX_DEPLOYMENT dev:${slug}.`);
console.log(`✓ salvaguardas: dev:${slug} · ${cloudHost} · ${siteHost} · E2E_PORT=${process.env.E2E_PORT}`);

// --- 2 · manifiesto ----------------------------------------------------------------------------
const playwrightBin = path.join(ROOT, "node_modules", ".bin", "playwright");
const listed = spawnSync(playwrightBin, ["test", "--grep", "@regresion", "--list", "--reporter=json"], { cwd: ROOT, encoding: "utf8", env: process.env, maxBuffer: 64 * 1024 * 1024 });
if (listed.status !== 0) abort(3, `no se pudo listar la batería:\n${listed.stderr}`);
const listedKeys = [];
(function walk(suites, file) {
  for (const s of suites ?? []) {
    const f = s.file ?? file;
    for (const spec of s.specs ?? []) listedKeys.push(`${spec.file ?? f} › ${spec.title}`);
    walk(s.suites, f);
  }
})(JSON.parse(listed.stdout).suites);
const manifestKeys = JSON.parse(readFileSync(MANIFEST, "utf8")).map((t) => `${t.file} › ${t.title}`);
const duplicates = (keys) => keys.filter((k, i) => keys.indexOf(k) !== i);
const dupManifest = duplicates(manifestKeys);
const dupListed = duplicates(listedKeys);
if (dupManifest.length || dupListed.length) {
  abort(3, `entradas duplicadas.
  en el manifiesto:
${dupManifest.map((k) => `    = ${k}`).join("\n") || "    (ninguna)"}
  en --list --grep @regresion:
${dupListed.map((k) => `    = ${k}`).join("\n") || "    (ninguna)"}`);
}
const sortedManifest = [...manifestKeys].sort();
const sortedListed = [...listedKeys].sort();
if (sortedManifest.length !== sortedListed.length || sortedManifest.some((k, i) => k !== sortedListed[i])) {
  const missing = sortedManifest.filter((k) => !sortedListed.includes(k));
  const extra = sortedListed.filter((k) => !sortedManifest.includes(k));
  abort(3, `el conjunto @regresion no coincide con e2e/regresion.manifest.json.
  en el manifiesto y sin etiqueta (o renombrado):
${missing.map((k) => `    - ${k}`).join("\n") || "    (ninguno)"}
  etiquetado y fuera del manifiesto:
${extra.map((k) => `    + ${k}`).join("\n") || "    (ninguno)"}`);
}
console.log(`✓ manifiesto: ${manifestKeys.length} tests, sin duplicados e idéntico (listas ordenadas) a --list --grep @regresion`);

// --- 3 · cerrojo -------------------------------------------------------------------------------
const commonDir = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
if (!commonDir) abort(2, "no se encuentra el repositorio git (git rev-parse --git-common-dir).");
const LOCK = path.join(path.dirname(commonDir), ".e2e-suite-lock");
const OWNER = path.join(LOCK, "owner");
const token = randomBytes(8).toString("hex");

function readOwner() {
  try {
    return readFileSync(OWNER, "utf8");
  } catch {
    return null;
  }
}
function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Entre el `mkdir` de otro lanzador y la escritura de su `owner` hay un
// instante sin fichero. Sin owner legible con `pid=` (ausente, vacío o
// parcial), el cerrojo solo cuenta como huérfano si dura más de esto.
const NO_OWNER_GRACE_MS = 5_000;
// Ganchos SOLO para la evidencia (TAL-71): pausas en las ventanas críticas.
const TEST_PAUSE_IN_OWNER_WRITE_MS = Number(process.env.TAL71_TEST_PAUSE_IN_OWNER_WRITE_MS ?? 0);
const TEST_PAUSE_BEFORE_SPAWN_MS = Number(process.env.TAL71_TEST_PAUSE_BEFORE_SPAWN_MS ?? 0);
const RUN_BIN = process.env.TAL71_TEST_PLAYWRIGHT_BIN || playwrightBin;

// Estado compartido con los manejadores de señales, que se registran ANTES
// de intentar el cerrojo: una señal en cualquier momento lo suelta si es
// nuestro (y si hay hijo, primero se le reenvía y se espera a que termine).
let lockHeld = false;
let child = null;
let receivedSignal = null;
const ownerTmp = path.join(LOCK, `.owner.tmp-${token}`);
const exitCodeFor = (sig) => 128 + ({ SIGINT: 2, SIGTERM: 15 }[sig] ?? 1);

function releaseLock() {
  if (!lockHeld) return;
  lockHeld = false;
  try {
    unlinkSync(ownerTmp);
  } catch {
    // no había temporal
  }
  const owner = readOwner();
  if (owner !== null && !owner.includes(`token=${token}`)) {
    console.warn(`⚠ el cerrojo ya no es de esta ejecución (owner con otro token): no se toca.`);
    return;
  }
  // owner con nuestro token, o aún sin owner (señal antes del rename): el mkdir fue nuestro.
  if (owner !== null) unlinkSync(OWNER);
  rmdirSync(LOCK);
  console.log("✓ cerrojo liberado");
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    receivedSignal = signal;
    if (child && child.exitCode === null && child.signalCode === null) {
      console.warn(`\n⚠ ${signal} recibido: se reenvía a Playwright (pid ${child.pid}) y se espera a que termine antes de soltar el cerrojo.`);
      child.kill(signal);
      return; // el flujo principal libera al terminar el hijo
    }
    console.warn(`\n⚠ ${signal} recibido ${lockHeld ? "con el cerrojo tomado y sin Playwright en marcha" : "sin cerrojo"}: se sale.`);
    releaseLock();
    process.exit(exitCodeFor(signal));
  });
}

async function acquireLock() {
  let warned = null;
  let unreadableSince = null;
  for (;;) {
    let created = false;
    try {
      mkdirSync(LOCK); // atómico: falla con EEXIST si otro lo tiene
      created = true;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
    }
    if (created) {
      lockHeld = true;
      // owner atómico: temporal en el propio directorio + rename.
      writeFileSync(ownerTmp, `terminal=E2E_PORT ${process.env.E2E_PORT}\ncwd=${ROOT}\npid=${process.pid}\ndesde=${new Date().toISOString()}\ntarea=batería de regresión (TAL-71)\ntoken=${token}\n`);
      if (TEST_PAUSE_IN_OWNER_WRITE_MS) {
        console.log(`(gancho de test: pausa de ${TEST_PAUSE_IN_OWNER_WRITE_MS} ms entre escribir el temporal y el rename)`);
        await sleep(TEST_PAUSE_IN_OWNER_WRITE_MS);
      }
      renameSync(ownerTmp, OWNER);
      console.log(`✓ cerrojo adquirido: ${LOCK}`);
      return;
    }
    const owner = readOwner();
    const pid = Number(owner?.match(/^pid=(\d+)$/m)?.[1]);
    const readable = pid > 0;
    unreadableSince = readable ? null : (unreadableSince ?? Date.now());
    const orphan = readable ? !pidAlive(pid) : Date.now() - unreadableSince > NO_OWNER_GRACE_MS;
    const why = owner === null ? "sin fichero owner" : !readable ? "owner vacío, parcial o sin pid=" : `pid ${pid} ya no existe`;
    const state = orphan ? `huérfano:${why}:${owner}` : `ocupado:${owner}`;
    if (state !== warned) {
      warned = state;
      if (orphan) {
        console.warn(
          `⚠ cerrojo posiblemente HUÉRFANO en ${LOCK} (${why}). No se borra automáticamente: compruébalo y, si es seguro, bórralo a mano (rm -f "${LOCK}"/owner "${LOCK}"/.owner.tmp-*; rmdir "${LOCK}"). Esperando…`
        );
      } else {
        console.log(`… cerrojo ocupado, esperando (reintento cada ${LOCK_POLL_MS / 1000} s). owner:\n${(owner ?? "(aún sin owner)").trim().replace(/^/gm, "    ")}`);
      }
    }
    await sleep(readable ? LOCK_POLL_MS : Math.min(LOCK_POLL_MS, 1_000));
  }
}

// --- 4 · ejecución -----------------------------------------------------------------------------
const listOnly = args.includes("--list");
const waitStarted = Date.now();
await acquireLock();
const lockWaitSeconds = ((Date.now() - waitStarted) / 1000).toFixed(1);
const jsonReport = path.join(tmpdir(), `e2e-regresion-${process.pid}-${token}.json`);
let code = 1;
let childSignal = null;
let seconds = "0.0";
const started = Date.now();
try {
  if (TEST_PAUSE_BEFORE_SPAWN_MS) {
    console.log(`(gancho de test: pausa de ${TEST_PAUSE_BEFORE_SPAWN_MS} ms con el cerrojo tomado y sin Playwright)`);
    await sleep(TEST_PAUSE_BEFORE_SPAWN_MS);
  }
  [code, childSignal] = await new Promise((resolve) => {
    try {
      child = spawn(RUN_BIN, ["test", "--grep", "@regresion", "--reporter=list,json", ...args], {
        cwd: ROOT,
        stdio: "inherit",
        env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: jsonReport },
      });
    } catch (err) {
      console.error(`✗ no se pudo lanzar Playwright: ${err.message}`);
      resolve([1, null]);
      return;
    }
    child.on("error", (err) => {
      console.error(`✗ no se pudo lanzar Playwright (${RUN_BIN}): ${err.message}`);
      resolve([1, null]);
    });
    child.on("exit", (c, sig) => resolve([c, sig]));
  });
} finally {
  seconds = ((Date.now() - started) / 1000).toFixed(1);
  releaseLock();
}

if (receivedSignal || childSignal) {
  const sig = receivedSignal ?? childSignal;
  console.error(`✗ batería interrumpida (${sig}) tras ${seconds} s.`);
  // Comportamiento observado (TAL-71, docs/e2e.md): cortar a mitad mata el
  // next dev de Playwright en plena compilación, y el siguiente arranque se
  // puede quedar compilando al 100 % de CPU sin responder.
  console.error(`⚠ si la próxima ejecución se queda arrancando (next dev al 100 % de CPU sin responder), para ese next dev por su PID y borra .next de este worktree (rm -rf "${path.join(ROOT, ".next")}") antes de relanzar.`);
  process.exit(exitCodeFor(sig));
}

// --- 5 · resumen -------------------------------------------------------------------------------
let stats = null;
const skippedTests = [];
if (existsSync(jsonReport)) {
  const report = JSON.parse(readFileSync(jsonReport, "utf8"));
  stats = report.stats;
  (function walk(suites) {
    for (const s of suites ?? []) {
      for (const spec of s.specs ?? []) for (const t of spec.tests ?? []) if (t.status === "skipped") skippedTests.push(`${spec.file} › ${spec.title}`);
      walk(s.suites);
    }
  })(report.suites);
  unlinkSync(jsonReport);
}
const ran = stats ? stats.expected + stats.unexpected + stats.flaky : "?";
console.log(
  listOnly
    ? `\nBatería de regresión: solo listado (--list), nada ejecutado · espera del cerrojo ${lockWaitSeconds} s · Playwright ${seconds} s (exit ${code})`
    : `\nBatería de regresión: ${ran} ejecutados · ${stats?.expected ?? "?"} pasados · ${stats?.unexpected ?? "?"} fallidos · ${stats?.skipped ?? "?"} omitidos · ${stats?.flaky ?? "?"} inestables · espera del cerrojo ${lockWaitSeconds} s · Playwright ${seconds} s (exit de Playwright ${code})`
);
if (!listOnly && code === 0 && skippedTests.length > 0) {
  console.error(`✗ hay tests omitidos y la batería no admite omitidos:\n${skippedTests.map((t) => `    - ${t}`).join("\n")}`);
  process.exit(1);
}
process.exit(code ?? 1);
