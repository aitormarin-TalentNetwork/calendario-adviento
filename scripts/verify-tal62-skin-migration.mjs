// Evidencia de auditoría — TAL-62 (catálogo de 8 skins + migración de
// calendarios). Ensaya contra el deployment de DESARROLLO de esta terminal
// lo que el runbook de producción (docs/skins.md § "Catálogo 2026") hará:
//   1. barrera de escritura ANTES de sembrar (comportamiento de siempre);
//   2. siembra cruda de calendarios en skins antiguos (pino, dorado,
//      medianoche, nieve, tira-comica, rojiblanco) y uno con `skinId` roto
//      (skin temporal que se retira con una restauración ZIP de `skins`
//      que conserva los _id);
//   3. sembrado del catálogo nuevo (dos veces, idempotente) + integridad
//      (una fila de skinStyles por skin, sortOrder 1..8, una sola Nieve por
//      key, conservados con el mismo _id y campos antiguos intactos);
//   4. backup verificable (después de sembrar, antes de migrar: runbook);
//   5. barrera de escritura DESPUÉS de sembrar;
//   6. auditoría → migración por lotes de 2 con fallo parcial y
//      relanzamiento → mapeos → auditoría legacy 0 / missingSkin 0 →
//      segunda pasada sin cambios;
//   7. restauración con un skippedEdited y un skippedMissing; borrado
//      abortado con legacy > 0; migración nueva (reutilizar id rechazado);
//   8. carrera: update a un skin retirado tras migrar → la barrera guarda
//      Alegre → borrado protegido (skippedReferenced 0) → solo quedan 8;
//   9. restauración desde ZIP parcial (skins + calendars) con _id
//      conservados y demás tablas intactas;
//  10. deja el deployment migrado (sin borrar) y limpia lo sembrado.
//
// NUNCA contra producción: aborta si CONVEX_DEPLOYMENT no es `dev:` y
// ningún comando lleva `--prod`. Ejecutar desde la raíz del worktree:
//   set -a && source .env.local && source .env && set +a && node scripts/verify-tal62-skin-migration.mjs
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

const log = (title, value) => {
  console.log(`\n### ${title}`);
  if (value !== undefined) console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));
};
const assert = (condition, message) => {
  if (!condition) {
    console.error(`\n✗ FALLO: ${message}`);
    process.exit(1);
  }
  console.log(`✓ ${message}`);
};
async function cli(args) {
  if (args.includes("--prod")) throw new Error("Prohibido --prod en este script.");
  const { stdout } = await run("npx", ["convex", ...args], { maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}
async function convexRun(fn, argsObj = {}) {
  const out = await cli(["run", fn, JSON.stringify(argsObj)]);
  const text = out.split("\n").filter((l) => l.trim() && !l.includes("Warning") && !l.includes("trace-warnings")).join("\n");
  return text === "" || text === "null" ? null : JSON.parse(text);
}
async function sh(cmd, args, opts = {}) {
  const { stdout } = await run(cmd, args, { maxBuffer: 64 * 1024 * 1024, ...opts });
  return stdout;
}
async function exportSnapshot(zipPath) {
  await cli(["export", "--path", zipPath]);
  return { size: (await stat(zipPath)).size, listing: await sh("unzip", ["-l", zipPath]) };
}
async function tableDocs(zipPath, table) {
  try {
    return (await sh("unzip", ["-p", zipPath, `${table}/documents.jsonl`])).split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}
async function importZipOfTables(zipPath, work, name, tables) {
  const dir = path.join(work, name);
  for (const [table, docs] of Object.entries(tables)) {
    await mkdir(path.join(dir, table), { recursive: true });
    await writeFile(path.join(dir, table, "documents.jsonl"), docs.map((d) => JSON.stringify(d)).join("\n") + "\n");
  }
  const out = path.join(work, `${name}.zip`);
  await sh("zip", ["-r", out, ...Object.keys(tables)], { cwd: dir });
  const listing = await sh("unzip", ["-l", out]);
  await cli(["import", "--replace", "-y", out]);
  return listing;
}
const listCatalog = () => convexRun("skins:listCatalogPublic", { serverSecret: secret });
const listAll = () => convexRun("skins:listAllPublic", { serverSecret: secret });
const getCal = (id) => convexRun("calendars:get", { calendarId: id });

const prefix = `tal62-verify-${Date.now()}`;
const work = await mkdtemp(path.join(tmpdir(), "tal62-verify-"));
log("Deployment", deployment);

// --- 0. Estado de partida -------------------------------------------------------------------
const catalogBefore = await listCatalog();
const seededAtStart = catalogBefore.length > 0;
log("Catálogo nuevo ya sembrado al empezar", seededAtStart);
const skinsBefore = await listAll();
const keyToSkin = Object.fromEntries(skinsBefore.map((s) => [s.key, s]));
for (const key of ["pino", "dorado", "medianoche", "nieve", "tira-comica", "rojiblanco"]) {
  assert(keyToSkin[key], `existe el skin antiguo "${key}"`);
}
const actor = await convexRun("users:upsertUserOnLoginPublic", { serverSecret: secret, email: `${prefix}-actor@example.com`, isSuperAdminOnCreate: true });
const createdIds = [];
const createCal = async (label, skinKey) => {
  const id = await convexRun("calendars:createCalendar", {
    userId: actor,
    name: `${prefix}-${label}`,
    coverTitle: `TAL-62 ${label}`,
    startDate: "2026-12-01",
    endDate: "2026-12-24",
    creationKey: `${prefix}-${label}`,
    ...(skinKey ? { skinId: keyToSkin[skinKey]._id } : {}),
  });
  createdIds.push(id);
  return id;
};
const updateSkin = async (id, skinKey) => {
  const cal = await getCal(id);
  await convexRun("calendars:updateCalendar", {
    calendarId: id, name: cal.name, coverTitle: cal.coverTitle, startDate: cal.startDate, endDate: cal.endDate,
    skinId: typeof skinKey === "string" && keyToSkin[skinKey] ? keyToSkin[skinKey]._id : skinKey,
  });
  return (await getCal(id)).skinId;
};

// --- 1. Barrera ANTES de sembrar ------------------------------------------------------------
if (!seededAtStart) {
  const pre = await createCal("barrera-pre", "pino");
  assert((await getCal(pre)).skinId === keyToSkin.pino._id, "antes de sembrar, crear con 'pino' guarda 'pino' (comportamiento de siempre)");
  assert((await updateSkin(pre, "dorado")) === keyToSkin.dorado._id, "antes de sembrar, actualizar a 'dorado' guarda 'dorado'");
} else {
  log("Barrera antes de sembrar", "OMITIDA: el catálogo ya estaba sembrado en este deployment (se ensayó en la primera ejecución).");
}

// --- 2. Siembra cruda: calendarios en skins antiguos + uno con skinId roto --------------------
const tmpSkinKey = `${prefix}-tmp`;
const tmpSkinId = await convexRun("skins:createSkin", { key: tmpSkinKey, name: "Temporal TAL-62", background: "#000000", accent: "#ffffff", textColor: "#ffffff" });
const legacyLabels = ["pino", "dorado", "medianoche", "nieve", "tira-comica", "rojiblanco"];
const jsonl = [...legacyLabels.map((k) => ({ label: k, skinId: keyToSkin[k]._id })), { label: "roto", skinId: tmpSkinId }]
  .map(({ label, skinId }) => JSON.stringify({ name: `${prefix}-${label}`, coverTitle: `TAL-62 ${label}`, startDate: "2026-12-01", endDate: "2026-12-24", updatedAt: Date.now(), skinId }))
  .join("\n");
const seedFile = path.join(work, "calendars.jsonl");
await writeFile(seedFile, jsonl + "\n");
log("Siembra cruda de calendarios (JSONL)", jsonl);
await cli(["import", "--table", "calendars", "--append", "-y", seedFile]);

// Retirar el skin temporal conservando los _id del resto (ZIP solo con `skins`).
const preTmpZip = path.join(work, "pre-tmp.zip");
await exportSnapshot(preTmpZip);
const skinsWithoutTmp = (await tableDocs(preTmpZip, "skins")).filter((d) => d.key !== tmpSkinKey);
await importZipOfTables(preTmpZip, work, "skins-sin-tmp", { skins: skinsWithoutTmp });
assert((await listAll()).every((s) => s.key !== tmpSkinKey), "el skin temporal ya no existe → el calendario 'roto' apunta a un skin inexistente");

// --- 4. Sembrado del catálogo nuevo (dos veces) + integridad ----------------------------------
const keptBefore = Object.fromEntries(["nieve", "tira-comica", "rojiblanco"].map((k) => [k, keyToSkin[k]]));
const seed1 = await convexRun("skins:seedSkinCatalog2026");
const seed2 = await convexRun("skins:seedSkinCatalog2026");
log("Sembrado 1", seed1);
log("Sembrado 2 (idempotente)", seed2);
assert(JSON.stringify(seed1.map((r) => r.skinId)) === JSON.stringify(seed2.map((r) => r.skinId)), "el segundo sembrado no crea filas nuevas (mismos _id)");
assert(seed2.every((r) => r.style === "updated"), "el segundo sembrado solo actualiza estilos existentes");
const catalog = await listCatalog();
log("listCatalogPublic", catalog.map((c) => ({ sortOrder: c.sortOrder, key: c.key, name: c.name, treatment: c.treatment ?? null, swatches: c.swatches })));
assert(catalog.length === 8, "listCatalogPublic devuelve 8 skins");
assert(JSON.stringify(catalog.map((c) => c.sortOrder)) === "[1,2,3,4,5,6,7,8]", "en orden por sortOrder 1..8, sin repetidos");
assert(JSON.stringify(catalog.map((c) => c.key)) === JSON.stringify(["alegre", "navidad-pop", "caramelo", "noche", "nieve", "minimal", "tira-comica", "rojiblanco"]), "keys y orden del Design System");
const allAfter = await listAll();
assert(allAfter.filter((s) => s.key === "nieve").length === 1 && !allAfter.some((s) => s.key === "nieve-2026"), "una sola fila 'nieve' y ninguna 'nieve-2026'");
assert(allAfter.filter((s) => s.name === "Nieve").length === 1, "una sola fila con nombre 'Nieve'");
for (const [key, before] of Object.entries(keptBefore)) {
  const after = allAfter.find((s) => s.key === key);
  assert(after._id === before._id, `'${key}' conserva su _id`);
  assert(after.background === before.background && after.accent === before.accent && after.textColor === before.textColor && after.textPill === before.textPill, `'${key}' conserva sus campos antiguos (compatibilidad con el Next anterior)`);
}
const alegreId = catalog.find((c) => c.key === "alegre")._id;
for (const skin of allAfter) keyToSkin[skin.key] = skin; // incluye ya los 5 skins nuevos

// --- 4b. Backup verificable (DESPUÉS de sembrar y ANTES de migrar, como en el runbook) ----------
const backupZip = path.join(work, "tal62-pre-migration.zip");
const backup = await exportSnapshot(backupZip);
log("Backup: unzip -l", backup.listing);
assert(backup.size > 0 && backup.listing.includes("calendars/documents.jsonl") && backup.listing.includes("skins/documents.jsonl"), `backup con calendars y skins (${backup.size} bytes)`);
const backupCalendars = await tableDocs(backupZip, "calendars");
const backupSkins = await tableDocs(backupZip, "skins");
const idByLabel = Object.fromEntries([...legacyLabels, "roto"].map((l) => [l, backupCalendars.find((c) => c.name === `${prefix}-${l}`)?._id]));
log("Calendarios sembrados (ids)", idByLabel);
assert(Object.values(idByLabel).every(Boolean), "los 7 calendarios sembrados están en el backup");

// --- 5. Barrera DESPUÉS de sembrar ----------------------------------------------------------
const postA = await createCal("barrera-post-a", "dorado");
assert((await getCal(postA)).skinId === alegreId, "tras sembrar, crear con 'dorado' (retirado) guarda Alegre");
assert((await updateSkin(postA, "pino")) === alegreId, "tras sembrar, actualizar a 'pino' (retirado) guarda Alegre");
for (const kept of ["nieve", "tira-comica", "rojiblanco"]) {
  assert((await updateSkin(postA, kept)) === keyToSkin[kept]._id, `tras sembrar, actualizar a '${kept}' (conservado) lo guarda tal cual`);
}
const postDefault = await createCal("barrera-post-default", null);
assert((await getCal(postDefault)).skinId === alegreId, "un calendario nuevo sin skin explícito nace con Alegre");

// --- 6. Auditoría → migración por lotes con fallo parcial → auditoría -------------------------
const auditBefore = await convexRun("skinMigration:auditCalendarSkins");
log("Auditoría ANTES de migrar", auditBefore);
assert(auditBefore.legacy >= 3 && auditBefore.missingSkin >= 1, `hay antiguos (${auditBefore.legacy}) y rotos (${auditBefore.missingSkin})`);

const migrationId = `${prefix}-m1`;
const first = await convexRun("skinMigration:migrateCalendarSkinsBatch", { migrationId, cursor: null, batchSize: 2 });
log("Lote 1 (y aquí se simula que el proceso se cae)", first);
let cursor = null;
let batches = 0;
let migratedRelaunch = 0;
for (;;) {
  const r = await convexRun("skinMigration:migrateCalendarSkinsBatch", { migrationId, cursor, batchSize: 2 });
  batches++;
  migratedRelaunch += r.migrated;
  console.log(`  lote ${batches}: ${JSON.stringify(r)}`);
  if (r.isDone) break;
  cursor = r.continueCursor;
}
assert(batches > 1, `el relanzamiento recorrió varios lotes (${batches})`);
async function readLog(id, onlyUnrestored = false) {
  const entries = [];
  let c = null;
  for (;;) {
    const page = await convexRun("skinMigration:listSkinMigrationLogPage", { migrationId: id, cursor: c, numItems: 50, onlyUnrestored });
    entries.push(...page.entries);
    if (page.isDone) break;
    c = page.continueCursor;
  }
  return entries;
}
const entries = await readLog(migrationId);
log("Log de la migración", entries);
assert(new Set(entries.map((e) => e.calendarId)).size === entries.length, "el log no tiene calendarios duplicados pese al relanzamiento");
assert(first.migrated + migratedRelaunch === entries.length, "lo migrado en total = filas del log");
for (const label of ["pino", "dorado", "medianoche", "roto"]) {
  const e = entries.find((x) => x.calendarId === idByLabel[label]);
  assert(e && e.toSkinId === alegreId && e.current === "alegre", `'${label}' → Alegre (from ${e?.fromKey})`);
}
for (const label of ["nieve", "tira-comica", "rojiblanco"]) {
  assert(!entries.some((x) => x.calendarId === idByLabel[label]), `'${label}' se conserva (no aparece en el log)`);
  assert((await getCal(idByLabel[label])).skinId === keyToSkin[label]._id, `'${label}' sigue con el mismo _id de skin`);
}
const auditAfter = await convexRun("skinMigration:auditCalendarSkins");
log("Auditoría DESPUÉS de migrar", auditAfter);
assert(auditAfter.legacy === 0 && auditAfter.missingSkin === 0, "legacy: 0 y missingSkin: 0");
const second = await convexRun("skinMigration:runCalendarSkinMigration", { migrationId: `${prefix}-m1-rerun` });
assert(second.migrated === 0, `segunda pasada sin cambios (${JSON.stringify(second)})`);

// --- 7. Restauración (skippedEdited + skippedMissing), borrado abortado, nueva migración --------
await updateSkin(idByLabel.medianoche, "noche");
log("Simulado: el Admin cambia 'medianoche' (ya en Alegre) a 'noche' después de migrar");
const restore = await convexRun("skinMigration:runCalendarSkinRestore", { migrationId });
log("Restauración desde el log", restore);
assert(restore.skippedEdited === 1, "1 skippedEdited (el editado conserva la elección del Admin)");
assert(restore.skippedMissing === 1, "1 skippedMissing (el 'roto': su skin de origen no existe)");
assert((await getCal(idByLabel.pino)).skinId === keyToSkin.pino._id, "'pino' vuelve a su skin antiguo");
const unrestored = await readLog(migrationId, true);
log("Filas sin restaurar (revisión de skippedEdited/skippedMissing, paginado hasta isDone)", unrestored);
const aborted = await convexRun("skinMigration:runDeleteRetiredSkins");
log("Borrado con legacy > 0", aborted);
assert(aborted.aborted === true && aborted.audit.legacy > 0, "runDeleteRetiredSkins ABORTA sin borrar nada si legacy > 0");
let reuseRejected = false;
try {
  await convexRun("skinMigration:migrateCalendarSkinsBatch", { migrationId, cursor: null, batchSize: 100 });
} catch (e) {
  reuseRejected = String(e.stderr ?? e.message).includes("ya se usó");
}
assert(reuseRejected, "reutilizar el migrationId de una migración restaurada se rechaza");
const m2 = await convexRun("skinMigration:runCalendarSkinMigration", { migrationId: `${prefix}-m2` });
log("Migración nueva", m2);
const audit2 = await convexRun("skinMigration:auditCalendarSkins");
assert(audit2.legacy === 0 && audit2.missingSkin === 0, "tras la migración nueva: legacy 0, missingSkin 0");

// --- 8. Carrera: escritura a un retirado entre la migración y el borrado ----------------------
assert((await updateSkin(idByLabel.dorado, "dorado")) === alegreId, "carrera: actualizar a 'dorado' (retirado) tras migrar → la barrera guarda Alegre");
const styledlessBeforeDelete = (await listAll()).length - catalog.length;
log("Skins sin estilo antes del borrado", styledlessBeforeDelete);
const del = await convexRun("skinMigration:runDeleteRetiredSkins");
log("Borrado protegido", del);
assert(del.aborted === false && del.skippedReferenced === 0, "borrado sin referencias pendientes (skippedReferenced: 0)");
assert(del.finalAudit.legacy === 0 && del.finalAudit.missingSkin === 0, "auditoría final: legacy 0 y missingSkin 0");
const skinsLeft = await listAll();
assert(skinsLeft.length === 8 && skinsLeft.every((s) => catalog.some((c) => c._id === s._id)), `en 'skins' solo quedan los 8 (${skinsLeft.map((s) => s.key).join(", ")})`);
assert(del.deleted === styledlessBeforeDelete && del.deletedKeys.length === del.deleted, `se borraron exactamente los ${styledlessBeforeDelete} skins sin estilo (${del.deletedKeys.join(", ")})`);

// --- 9. Restauración desde ZIP parcial (skins + calendars) -------------------------------------
const beforeImport = path.join(work, "before-import.zip");
await exportSnapshot(beforeImport);
const otherTables = ["calendarMemberships", "invitations", "days", "users", "skinStyles", "skinMigrationLog"];
const countsBefore = {};
for (const t of otherTables) countsBefore[t] = (await tableDocs(beforeImport, t)).length;
const restoreListing = await importZipOfTables(backupZip, work, "restore-skins-calendars", { skins: backupSkins, calendars: backupCalendars });
log("ZIP parcial de restauración: unzip -l", restoreListing);
const afterImport = path.join(work, "after-import.zip");
await exportSnapshot(afterImport);
assert((await tableDocs(afterImport, "skins")).length === backupSkins.length, `skins = backup (${backupSkins.length})`);
assert((await tableDocs(afterImport, "calendars")).length === backupCalendars.length, `calendars = backup (${backupCalendars.length})`);
for (const label of ["pino", "nieve", "roto"]) {
  const doc = await getCal(idByLabel[label]);
  const orig = backupCalendars.find((c) => c._id === idByLabel[label]);
  assert(doc && doc.skinId === orig.skinId, `_id de '${label}' conservado con su skin del backup`);
}
assert(await convexRun("skins:getByKey", { key: "pino" }), "el skin 'pino' vuelve a existir con el backup");
for (const t of otherTables) {
  const after = (await tableDocs(afterImport, t)).length;
  assert(after === countsBefore[t], `tabla ${t} sin cambios (${countsBefore[t]} → ${after})`);
}

// --- 10. Dejar el deployment migrado (sin borrar) y limpiar ------------------------------------
const final = await convexRun("skinMigration:runCalendarSkinMigration", { migrationId: `${prefix}-final` });
log("Migración final", final);
const finalAudit = await convexRun("skinMigration:auditCalendarSkins");
log("Auditoría final", finalAudit);
assert(finalAudit.legacy === 0 && finalAudit.missingSkin === 0, "deployment de desarrollo migrado: legacy 0, missingSkin 0");
for (const id of [...Object.values(idByLabel), ...createdIds]) {
  if (await getCal(id)) await convexRun("calendars:deleteCalendar", { calendarId: id });
}
log("Limpieza", `borrados los calendarios sembrados (${prefix}-*); el catálogo nuevo queda sembrado; los antiguos restaurados por el backup quedan sin calendarios`);
console.log("\nOK — verificación TAL-62 completa.");
