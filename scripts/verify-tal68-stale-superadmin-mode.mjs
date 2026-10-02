// Evidencia de auditoría — TAL-68 (opción «Super Admin» en el menú de la
// cuenta). Comprueba dos cosas que no tienen ninguna vía desplegada para
// provocarse desde la app:
//
//   A. Valor guardado que ya no es válido: un usuario guardó
//      preferredMode "superadmin" siendo Super Admin y después le quitaron
//      el rol. Al entrar sin callbackUrl tiene que aterrizar en su modo
//      válido (/admin si administra algo, /c si no), nunca en /superadmin
//      ni en /unauthorized.
//   B. Runbook de rollback (docs/menu-cuenta.md): con
//      PREFERRED_MODE_SUPERADMIN_FROZEN=1 nadie puede guardar "superadmin"
//      (ni un Super Admin); la limpieza paginada deja la suma del recuento
//      paginado en 0.
//
// Para A hace falta quitar el rol a un usuario, y eso no existe en el
// código desplegado (a propósito). Patrón `_scratch_*` (mismo que
// scripts/verify-tal22-skin-schema-migration.mjs): escribe una mutation
// temporal en convex/_scratch_tal68_stale_mode.ts, la despliega SOLO en el
// deployment de desarrollo, la usa y, en el finally, la borra, vuelve a
// desplegar y verifica que ya no existe.
//
// Defensas (copiadas de scripts/verify-tal62-skin-migration.mjs):
//   - aborta ANTES de crear ningún fichero si CONVEX_DEPLOYMENT no es `dev:`;
//   - aborta ANTES de cualquier escritura si el host de NEXT_PUBLIC_CONVEX_URL
//     no es exactamente `<slug>.convex.cloud` del CONVEX_DEPLOYMENT dev:<slug>
//     (las escrituras por HTTP no pasan por la CLI; NO-GO loop 1);
//   - un único wrapper `cli()` para todos los comandos de Convex, que
//     rechaza `--prod`;
//   - limpieza completa en el finally (fichero, deploy, verificación, y la
//     variable de congelación).
//
// Ejecutar desde la raíz del worktree:
//   set -a && source .env.local && source .env && set +a && node scripts/verify-tal68-stale-superadmin-mode.mjs
import { execFile } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { ConvexHttpClient } from "convex/browser";

const run = promisify(execFile);
const deployment = process.env.CONVEX_DEPLOYMENT ?? "";
const secret = process.env.CONVEX_APP_SERVER_SECRET;
const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!deployment.startsWith("dev:")) {
  console.error(`ABORTADO: CONVEX_DEPLOYMENT="${deployment}" no es un deployment de desarrollo.`);
  process.exit(1);
}
if (!secret || !url) {
  console.error("Faltan CONVEX_APP_SERVER_SECRET y/o NEXT_PUBLIC_CONVEX_URL en el entorno.");
  process.exit(1);
}
// La CLI usa CONVEX_DEPLOYMENT, pero el ConvexHttpClient de abajo usa
// NEXT_PUBLIC_CONVEX_URL: si estuvieran cruzadas (dev: + URL de producción),
// las escrituras por HTTP irían a producción. Antes de cualquier escritura,
// la URL tiene que ser EXACTAMENTE la del deployment de desarrollo.
const devSlug = deployment.slice("dev:".length).trim().split(/\s+/)[0];
let urlHost = null;
try {
  urlHost = new URL(url).hostname;
} catch {
  urlHost = null;
}
if (!devSlug || urlHost !== `${devSlug}.convex.cloud`) {
  console.error(
    `ABORTADO: NEXT_PUBLIC_CONVEX_URL="${url}" (host ${urlHost ?? "no válido"}) no es el deployment de desarrollo ` +
      `${devSlug || "(vacío)"}.convex.cloud indicado por CONVEX_DEPLOYMENT="${deployment}".`
  );
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRATCH_PATH = path.join(root, "convex", "_scratch_tal68_stale_mode.ts");
const SCRATCH_FN = "_scratch_tal68_stale_mode:markStale";
const FREEZE_VAR = "PREFERRED_MODE_SUPERADMIN_FROZEN";
const SCRATCH_SOURCE = `// TEMPORAL — generado por scripts/verify-tal68-stale-superadmin-mode.mjs,
// se borra automáticamente al terminar el script. Simula a un usuario que
// guardó preferredMode "superadmin" y al que después le quitaron el rol.
import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

export const markStale = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, { preferredMode: "superadmin", isSuperAdmin: false });
  },
});
`;

const log = (title, value) => {
  console.log(`\n### ${title}`);
  if (value !== undefined) console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));
};
const assert = (condition, message) => {
  if (!condition) throw new Error(`FALLO: ${message}`);
  console.log(`✓ ${message}`);
};
async function cli(args) {
  if (args.includes("--prod")) throw new Error("Prohibido --prod en este script.");
  const { stdout } = await run("npx", ["convex", ...args], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}
async function convexRun(fn, argsObj = {}) {
  const out = await cli(["run", fn, JSON.stringify(argsObj)]);
  const text = out.split("\n").filter((l) => l.trim() && !l.includes("Warning") && !l.includes("trace-warnings")).join("\n");
  return text === "" || text === "null" ? null : JSON.parse(text);
}
/** Recorre todos los cursores de una función paginada del runbook y devuelve las páginas. */
async function allPages(fn) {
  const pages = [];
  let cursor = null;
  for (;;) {
    const page = await convexRun(fn, { cursor });
    pages.push(page);
    if (page.isDone) return pages;
    cursor = page.continueCursor;
  }
}

const client = new ConvexHttpClient(url);
const runId = `${Date.now()}-${process.pid}`;
const ADMIN_EMAIL = `e2e-tal68-stale-admin-${runId}@example.com`;
const GUEST_EMAIL = `e2e-tal68-stale-guest-${runId}@example.com`;
const OTHER_SA_EMAIL = `e2e-tal68-stale-sa-${runId}@example.com`;
let calendarId = null;
let calendarOwnerId = null;
let failed = false;

try {
  // --- Sembrado: dos Super Admin que eligen «Super Admin» de verdad ---
  const seed = (email) =>
    client.mutation("users:upsertUserOnLoginPublic", { serverSecret: secret, email, isSuperAdminOnCreate: true });
  const adminId = await seed(ADMIN_EMAIL);
  const guestId = await seed(GUEST_EMAIL);
  const otherSaId = await seed(OTHER_SA_EMAIL);
  calendarOwnerId = adminId;
  calendarId = await client.mutation("calendars:createCalendarPublic", {
    serverSecret: secret,
    userId: adminId, // queda ADMIN de este calendario por membership
    name: `TAL-68 stale ${runId}`,
    coverTitle: `TAL-68 stale ${runId}`,
    startDate: "2026-12-01",
    endDate: "2026-12-24",
    creationKey: `tal68-stale-${runId}`,
  });
  for (const userId of [adminId, guestId]) {
    await client.mutation("users:setPreferredModePublic", { serverSecret: secret, userId, mode: "superadmin" });
  }
  log("Sembrado", { adminId, guestId, otherSaId, calendarId });

  // --- A. Quitar el rol con la mutation _scratch_ (solo en dev) ---
  await writeFile(SCRATCH_PATH, SCRATCH_SOURCE);
  log("convex dev --once (con _scratch_)", (await cli(["dev", "--once"])).trim().split("\n").pop());
  for (const userId of [adminId, guestId]) await convexRun(SCRATCH_FN, { userId });
  for (const [label, userId] of [["admin", adminId], ["guest", guestId]]) {
    const user = await client.query("users:getByIdPublic", { serverSecret: secret, userId });
    assert(user.isSuperAdmin === false && user.preferredMode === "superadmin", `${label}: ya no es Super Admin y conserva preferredMode "superadmin"`);
  }

  log("E2E de aterrizaje (e2e/tal68-stale-landing.spec.ts)");
  const e2e = await run("npx", ["playwright", "test", "e2e/tal68-stale-landing.spec.ts", "--reporter=list"], {
    cwd: root,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, TAL68_STALE: JSON.stringify({ admin: ADMIN_EMAIL, guest: GUEST_EMAIL }) },
  }).catch((err) => {
    console.log(err.stdout);
    throw new Error("FALLO: el E2E de aterrizaje no pasó");
  });
  console.log(e2e.stdout.trim());
  assert(/2 passed/.test(e2e.stdout), "E2E de aterrizaje: 2 passed (Admin → /admin, invitado → /c, nunca /unauthorized)");

  // --- B. Congelación + limpieza paginada + recuento paginado = 0 ---
  await cli(["env", "set", FREEZE_VAR, "1"]);
  log(`${FREEZE_VAR}=1 en el deployment de desarrollo`);
  let frozenError = null;
  try {
    await client.mutation("users:setPreferredModePublic", { serverSecret: secret, userId: otherSaId, mode: "superadmin" });
  } catch (err) {
    frozenError = String(err.message ?? err);
  }
  assert(frozenError !== null && frozenError.includes("No autorizado."), `congelado: guardar "superadmin" se rechaza incluso para un Super Admin (${frozenError?.split("\n").find((l) => l.includes("No autorizado"))?.trim()})`);
  const before = await allPages("users:countSuperadminPreferredMode");
  log("Recuento antes de limpiar (todas las páginas)", before);
  const cleaned = await allPages("users:downgradeSuperadminPreferredMode");
  log("Limpieza (todas las páginas)", cleaned);
  const after = await allPages("users:countSuperadminPreferredMode");
  const total = after.reduce((sum, page) => sum + page.withSuperadmin, 0);
  log("Recuento después de limpiar (todas las páginas)", after);
  assert(total === 0, `suma de withSuperadmin en todas las páginas = ${total} (tiene que ser 0)`);
} catch (err) {
  failed = true;
  console.error(`\n✗ ${err.message ?? err}`);
} finally {
  // --- Limpieza completa, también si algo falló ---
  log("Limpieza final");
  try {
    await cli(["env", "remove", FREEZE_VAR]);
    console.log(`✓ ${FREEZE_VAR} eliminada del deployment de desarrollo`);
  } catch (err) {
    console.log(`(${FREEZE_VAR} no estaba puesta o no se pudo quitar: ${String(err.message ?? err).split("\n")[0]})`);
  }
  if (calendarId && calendarOwnerId) {
    // El Admin sembrado sigue siendo ADMIN del calendario por membership.
    const result = await client
      .mutation("calendars:deleteCalendarAsUserPublic", { serverSecret: secret, calendarId, userId: calendarOwnerId })
      .catch((err) => `error: ${String(err.message ?? err).split("\n")[0]}`);
    console.log(`✓ calendario de prueba borrado (${result})`);
  }
  await rm(SCRATCH_PATH, { force: true });
  console.log(`✓ borrado ${path.relative(root, SCRATCH_PATH)}`);
  console.log((await cli(["dev", "--once"])).trim().split("\n").pop());
  let stillThere = true;
  try {
    await cli(["run", SCRATCH_FN, JSON.stringify({ userId: "x" })]);
  } catch (err) {
    const message = `${err.stdout ?? ""}${err.stderr ?? ""}${err.message ?? ""}`;
    stillThere = !/could not find|not found|No such function/i.test(message);
    console.log(`$ npx convex run ${SCRATCH_FN} → falla: ${message.split("\n").find((l) => /find|found|No such/i.test(l))?.trim()}`);
  }
  if (stillThere) {
    console.error(`✗ FALLO: la función ${SCRATCH_FN} sigue existiendo tras la limpieza`);
    failed = true;
  } else {
    console.log(`✓ la función ${SCRATCH_FN} ya no existe en el deployment`);
  }
}
if (failed) process.exit(1);
console.log("\nDONE");
