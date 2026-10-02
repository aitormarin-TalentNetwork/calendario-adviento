// Evidencia de auditoría — TAL-60 (migración de coverIcon emoji → Lucide).
// Ensaya contra el deployment de DESARROLLO de esta terminal todo lo que el
// runbook de producción (docs/iconos.md) hará después:
//   1. siembra calendarios con coverIcon en formato ANTIGUO crudo — con
//      `npx convex import --append` (solo valida contra el schema, no por
//      la lógica de escritura), incluidos emojis sin equivalente y uno
//      desconocido;
//   2. backup verificable (`npx convex export`, zip + recuento);
//   3. auditoría (inválidos) → migración lote a lote (batchSize 2) con un
//      fallo parcial simulado y relanzamiento desde cero → log sin
//      duplicados, mapeos esperados → auditoría limpia → segunda pasada
//      sin cambios (idempotencia);
//   4. restauración desde el log con un calendario editado entre medias
//      (`skippedEdited`, nunca se pisa);
//   5. restauración desde backup de SOLO la tabla calendars (ZIP parcial +
//      `npx convex import --replace <zip>`), verificando que se conservan
//      los _id, que una membership sigue resolviendo y que las demás
//      tablas no cambian;
//   6. deja el deployment migrado y borra lo sembrado.
//
// NUNCA contra producción: aborta si CONVEX_DEPLOYMENT no es `dev:` y
// ningún comando lleva `--prod`. Ejecutar desde la raíz del worktree:
//
//   set -a && source .env.local && source .env && set +a && node scripts/verify-tal60-cover-icon-migration.mjs
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

const deployment = process.env.CONVEX_DEPLOYMENT ?? "";
const secret = process.env.CONVEX_APP_SERVER_SECRET;
if (!deployment.startsWith("dev:")) {
  console.error(`ABORTADO: CONVEX_DEPLOYMENT="${deployment}" no es un deployment de desarrollo.`);
  process.exit(1);
}
if (!secret) {
  console.error("Falta CONVEX_APP_SERVER_SECRET en el entorno.");
  process.exit(1);
}

function log(title, value) {
  console.log(`\n### ${title}`);
  if (value !== undefined) console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));
}

function assert(condition, message) {
  if (!condition) {
    console.error(`\n✗ FALLO: ${message}`);
    process.exit(1);
  }
  console.log(`✓ ${message}`);
}

async function cli(args) {
  if (args.includes("--prod")) throw new Error("Prohibido --prod en este script.");
  const { stdout } = await run("npx", ["convex", ...args], { cwd: process.cwd(), maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

async function convexRun(fn, argsObj = {}) {
  const out = await cli(["run", fn, JSON.stringify(argsObj)]);
  const text = out
    .split("\n")
    .filter((l) => l.trim() && !l.includes("Warning") && !l.includes("trace-warnings"))
    .join("\n");
  return text === "" || text === "null" ? null : JSON.parse(text);
}

async function sh(cmd, args, opts = {}) {
  const { stdout } = await run(cmd, args, { maxBuffer: 64 * 1024 * 1024, ...opts });
  return stdout;
}

async function exportSnapshot(zipPath) {
  await cli(["export", "--path", zipPath]);
  const info = await stat(zipPath);
  const listing = await sh("unzip", ["-l", zipPath]);
  return { size: info.size, listing };
}

async function tableLines(zipPath, table) {
  try {
    const content = await sh("unzip", ["-p", zipPath, `${table}/documents.jsonl`]);
    return content.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

const runId = `${Date.now()}`;
const prefix = `tal60-verify-${runId}`;
const work = await mkdtemp(path.join(tmpdir(), "tal60-verify-"));
log("Deployment", deployment);
log("Directorio temporal", work);

// --- 1. Sembrado en formato antiguo crudo -------------------------------------------------
const skins = await convexRun("skins:listAllPublic", { serverSecret: secret });
const skinId = skins[0]._id;
const seeds = [
  { label: "arbol", coverIcon: "🎄", expected: "tree-pine" },
  { label: "copo-fe0f", coverIcon: "❄️", expected: "snowflake" },
  { label: "copo-sin-fe0f", coverIcon: "❄", expected: "snowflake" },
  { label: "champan", coverIcon: "🍾", expected: "wine" },
  { label: "unicornio", coverIcon: "🦄", expected: "sparkles" },
  { label: "reno", coverIcon: "🦌", expected: "paw-print" },
  { label: "panda", coverIcon: "🐼", expected: "paw-print" },
  { label: "cohete-desconocido", coverIcon: "🚀", expected: "gift" },
  { label: "ya-lucide", coverIcon: "star", expected: null },
  { label: "sin-icono", coverIcon: undefined, expected: null },
];
const jsonl = seeds
  .map((seed) =>
    JSON.stringify({
      name: `${prefix}-${seed.label}`,
      coverTitle: `Verificación TAL-60 ${seed.label}`,
      ...(seed.coverIcon !== undefined ? { coverIcon: seed.coverIcon } : {}),
      startDate: "2026-12-01",
      endDate: "2026-12-24",
      updatedAt: Date.now(),
      skinId,
    })
  )
  .join("\n");
const seedPath = path.join(work, "seed-calendars.jsonl");
await writeFile(seedPath, jsonl + "\n");
log("Sembrado (JSONL crudo, formato antiguo)", jsonl);
await cli(["import", "--table", "calendars", "--append", "-y", seedPath]);

// --- 2. Backup verificable ----------------------------------------------------------------
const backupZip = path.join(work, "tal60-pre-migration.zip");
const backup = await exportSnapshot(backupZip);
log("Backup: unzip -l", backup.listing);
assert(backup.size > 0, `el backup existe y no está vacío (${backup.size} bytes)`);
assert(backup.listing.includes("calendars/documents.jsonl"), "el backup contiene calendars/documents.jsonl");
const backupCalendars = await tableLines(backupZip, "calendars");
const idByLabel = Object.fromEntries(
  seeds.map((seed) => [seed.label, backupCalendars.find((doc) => doc.name === `${prefix}-${seed.label}`)?._id])
);
log("Ids sembrados (leídos del backup)", idByLabel);
assert(Object.values(idByLabel).every(Boolean), "los 10 calendarios sembrados están en el backup");

// Membership para comprobar referencias tras la restauración desde backup.
const userId = await convexRun("users:upsertUserOnLoginPublic", {
  serverSecret: secret,
  email: `${prefix}-guest@example.com`,
  isSuperAdminOnCreate: false,
});
await convexRun("calendarMemberships:addMembership", { calendarId: idByLabel.arbol, userId, role: "GUEST" });

// --- 3. Auditoría → migración por lotes con fallo parcial → auditoría ------------------------
const auditBefore = await convexRun("coverIconMigration:auditCoverIcons");
log("Auditoría ANTES de migrar", auditBefore);
assert(auditBefore.total === backupCalendars.length, `recuento del backup (${backupCalendars.length}) = total de la auditoría (${auditBefore.total})`);
assert(auditBefore.invalid >= 8, `hay al menos 8 inválidos (los sembrados): ${auditBefore.invalid}`);

const migrationId = `${prefix}-m1`;
const firstBatch = await convexRun("coverIconMigration:migrateCoverIconsBatch", { migrationId, cursor: null, batchSize: 2 });
log("Lote 1 (y aquí se simula que el proceso se cae)", firstBatch);

log("Relanzamiento desde el principio (cursor null), lote a lote con batchSize 2");
let cursor = null;
let batches = 0;
let migratedOnRelaunch = 0;
for (;;) {
  const result = await convexRun("coverIconMigration:migrateCoverIconsBatch", { migrationId, cursor, batchSize: 2 });
  batches++;
  migratedOnRelaunch += result.migrated;
  console.log(`  lote ${batches}: ${JSON.stringify(result)}`);
  if (result.isDone) break;
  cursor = result.continueCursor;
}
assert(batches > 1, `el relanzamiento recorrió varios lotes (${batches})`);

async function readLog(id, onlyUnrestored = false) {
  const entries = [];
  let logCursor = null;
  for (;;) {
    const page = await convexRun("coverIconMigration:listMigrationLogPage", { migrationId: id, cursor: logCursor, numItems: 50, onlyUnrestored });
    entries.push(...page.entries);
    if (page.isDone) break;
    logCursor = page.continueCursor;
  }
  return entries;
}
const logEntries = await readLog(migrationId);
log("Log de la migración (from → to, valor actual)", logEntries);
const loggedIds = logEntries.map((e) => e.calendarId);
assert(new Set(loggedIds).size === loggedIds.length, "el log no tiene calendarios duplicados pese al relanzamiento");
assert(firstBatch.migrated + migratedOnRelaunch === logEntries.length, "lo migrado en total = filas del log");
for (const seed of seeds) {
  const entry = logEntries.find((e) => e.calendarId === idByLabel[seed.label]);
  if (seed.expected === null) assert(!entry, `${seed.label}: no se toca (no aparece en el log)`);
  else assert(entry && entry.from === seed.coverIcon && entry.to === seed.expected && entry.current === seed.expected, `${seed.label}: ${seed.coverIcon} → ${seed.expected}`);
}

const auditAfter = await convexRun("coverIconMigration:auditCoverIcons");
log("Auditoría DESPUÉS de migrar", auditAfter);
assert(auditAfter.invalid === 0, "no queda ningún coverIcon inválido");
const second = await convexRun("coverIconMigration:runCoverIconMigration", { migrationId: `${prefix}-m1-rerun` });
log("Segunda migración completa (idempotencia)", second);
assert(second.migrated === 0, "la segunda pasada no migra nada");

// --- 4. Restauración desde el log con un calendario editado entre medias ------------------
const edited = backupCalendars.find((doc) => doc._id === idByLabel.champan);
await convexRun("calendars:updateCalendar", {
  calendarId: edited._id,
  name: edited.name,
  coverTitle: edited.coverTitle,
  coverIcon: "dog",
  startDate: edited.startDate,
  endDate: edited.endDate,
  skinId: edited.skinId,
});
log("Simulado: el Admin cambia el icono de 'champan' a 'dog' después de migrar");
const restore = await convexRun("coverIconMigration:runCoverIconRestore", { migrationId });
log("Restauración desde el log", restore);
assert(restore.skippedEdited === 1, "exactamente 1 skippedEdited (el editado)");
assert(restore.restored === logEntries.length - 1, "el resto vuelve a su valor anterior");
const unrestored = await readLog(migrationId, true);
log("Filas sin restaurar (revisión de skippedEdited)", unrestored);
assert(unrestored.length === 1 && unrestored[0].calendarId === edited._id && unrestored[0].current === "dog", "el editado conserva la elección del Admin ('dog')");
const auditRestored = await convexRun("coverIconMigration:auditCoverIcons");
log("Auditoría tras restaurar (vuelven los emojis, el editado es válido)", auditRestored);
assert(auditRestored.invalid === restore.restored, "inválidos = restaurados (emojis de vuelta); el editado cuenta como válido");

let reuseRejected = false;
try {
  await convexRun("coverIconMigration:migrateCoverIconsBatch", { migrationId, cursor: null, batchSize: 100 });
} catch (error) {
  reuseRejected = String(error.stderr ?? error.message).includes("ya se usó");
}
assert(reuseRejected, "reutilizar el migrationId de una migración restaurada se rechaza (hay que usar uno nuevo)");

// --- 5. Restauración desde backup: SOLO la tabla calendars ----------------------------------
const beforeImportZip = path.join(work, "before-import.zip");
await exportSnapshot(beforeImportZip);
const otherTables = ["calendarMemberships", "invitations", "days", "users", "coverIconMigrationLog"];
const countsBefore = {};
for (const table of otherTables) countsBefore[table] = (await tableLines(beforeImportZip, table)).length;

const restoreDir = path.join(work, "restore");
await mkdir(path.join(restoreDir, "calendars"), { recursive: true });
const calendarsJsonl = await sh("unzip", ["-p", backupZip, "calendars/documents.jsonl"]);
await writeFile(path.join(restoreDir, "calendars", "documents.jsonl"), calendarsJsonl);
const calendarsOnlyZip = path.join(work, "tal60-calendars-only.zip");
await sh("zip", ["-r", calendarsOnlyZip, "calendars"], { cwd: restoreDir });
const partialListing = await sh("unzip", ["-l", calendarsOnlyZip]);
log("ZIP parcial: unzip -l", partialListing);
const partialTables = partialListing
  .split("\n")
  .filter((line) => line.includes("documents.jsonl"))
  .map((line) => line.trim().split(/\s+/).pop());
assert(partialTables.length === 1 && partialTables[0] === "calendars/documents.jsonl", "el ZIP parcial solo trae calendars/documents.jsonl");
log("Comando (en dev, sin --prod)", `npx convex import --replace -y ${calendarsOnlyZip}`);
await cli(["import", "--replace", "-y", calendarsOnlyZip]);

const afterImportZip = path.join(work, "after-import.zip");
await exportSnapshot(afterImportZip);
const calendarsAfter = await tableLines(afterImportZip, "calendars");
assert(calendarsAfter.length === backupCalendars.length, `recuento de calendars = backup (${backupCalendars.length})`);
for (const label of ["arbol", "unicornio", "cohete-desconocido"]) {
  const doc = await convexRun("calendars:get", { calendarId: idByLabel[label] });
  const original = backupCalendars.find((d) => d._id === idByLabel[label]);
  assert(doc && doc._id === original._id && doc.name === original.name && doc.coverIcon === original.coverIcon, `_id ${label} conservado con su valor del backup (${doc?.coverIcon})`);
}
const access = await convexRun("access:resolveMemberAccess", { calendarId: idByLabel.arbol, userId });
assert(access && access.role === "GUEST", "la calendarMembership sigue resolviendo su calendario tras la restauración");
for (const table of otherTables) {
  const after = (await tableLines(afterImportZip, table)).length;
  assert(after === countsBefore[table], `tabla ${table} sin cambios (${countsBefore[table]} → ${after})`);
}

// --- 6. Dejar el deployment migrado y limpio -------------------------------------------------
const finalMigration = await convexRun("coverIconMigration:runCoverIconMigration", { migrationId: `${prefix}-final` });
log("Migración final", finalMigration);
const finalAudit = await convexRun("coverIconMigration:auditCoverIcons");
log("Auditoría final", finalAudit);
assert(finalAudit.invalid === 0, "deployment de desarrollo migrado, sin inválidos");
for (const id of Object.values(idByLabel)) await convexRun("calendars:deleteCalendar", { calendarId: id });
log("Limpieza", `borrados los ${seeds.length} calendarios sembrados (${prefix}-*)`);
console.log("\nOK — verificación TAL-60 completa.");
