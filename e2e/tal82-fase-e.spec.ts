import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { uniqueRunId } from "./helpers/auth";
import { assertDev, convexEnvRemove, convexEnvSet, convexRun, convexRunError, convexTableDocs } from "./helpers/convex-cli";

/**
 * TAL-82 — fase (e) de TAL-62: las operaciones nuevas de limpieza
 * (`skins:legacyPhaseEStatus`, `skins:runClearLegacySkinFields`,
 * `skinMigration:runDeleteRetiredSkins` con `expectRetired`,
 * `skinMigration:runClearSkinMigrationLog`) contra el deployment de DEV.
 *
 * Aislamiento: TODAS las llamadas llevan `testScope` (prefijo único por
 * ejecución). Con él, las funciones recorren la tabla ENTERA con el mismo
 * `paginate` (lotes de 3, para que los fixtures caigan en lotes distintos)
 * pero solo cuentan y escriben lo del prefijo. Los datos previos de dev no
 * se tocan: una huella `(_id, sha256 del documento completo)` de `skins`,
 * `skinStyles`, `calendars`, `skinMigrationLog` y `coverIconMigrationLog`
 * tomada antes y después del spec tiene que ser IDÉNTICA. Los fixtures se
 * borran en `afterAll` (también si algo falla).
 *
 * Activa `ALLOW_TEST_HELPERS=1` en el Convex de dev mientras dura (como
 * `tal67-files-lifecycle.spec.ts`) y la quita al terminar.
 */
test.describe.configure({ mode: "serial" });
test.setTimeout(300_000);

const PREFIX = `tal82t-${uniqueRunId()}-`;
const scope = { keyPrefix: PREFIX };
const TABLES = ["skins", "skinStyles", "calendars", "skinMigrationLog", "coverIconMigrationLog"] as const;

type Status = {
  skins: number;
  inCatalog: number;
  retired: number;
  withLegacyFields: number;
  calendars: number;
  calendarsOnRetired: number;
  calendarsMissingSkin: number;
  skinMigrationLog: number;
};
type Doc = Record<string, unknown> & { _id: string };

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value as object).sort().map((k) => [k, canonical((value as Record<string, unknown>)[k])]));
  }
  return value;
}
const sha = (doc: unknown) => createHash("sha256").update(JSON.stringify(canonical(doc))).digest("hex");

/** Huella de los datos de dev: por tabla, lista ordenada de `_id:sha256(documento completo)`. */
function fingerprint(): Record<string, string[]> {
  return Object.fromEntries(TABLES.map((t) => [t, convexTableDocs(t).map((d) => `${d._id}:${sha(d)}`).sort()]));
}
const docById = (table: string, id: string) => convexTableDocs(table).find((d) => d._id === id) as Doc | undefined;
const status = () => convexRun<Status>("skins:legacyPhaseEStatus", { testScope: scope });

let before: Record<string, string[]>;
let V1: string, V2: string, R1: string, R2: string, C1: string, C2: string;

test.beforeAll(() => {
  assertDev();
  convexEnvSet("ALLOW_TEST_HELPERS", "1");
  before = fingerprint();
  V1 = convexRun<string>("skins:insertCatalogSkinForTests", { key: `${PREFIX}v1`, sortOrder: 9001 });
  V2 = convexRun<string>("skins:insertCatalogSkinForTests", { key: `${PREFIX}v2`, sortOrder: 9002 });
  R1 = convexRun<string>("skins:insertRetiredSkinForTests", { key: `${PREFIX}r1` });
  R2 = convexRun<string>("skins:insertRetiredSkinForTests", { key: `${PREFIX}r2` });
  C1 = convexRun<string>("calendars:insertCalendarForTests", { name: `${PREFIX}c1`, skinId: V1 });
  C2 = convexRun<string>("calendars:insertCalendarForTests", { name: `${PREFIX}c2`, skinId: R2 });
  for (const calendarId of [C1, C2]) {
    convexRun("skinMigration:insertSkinMigrationLogForTests", { migrationId: `${PREFIX}log`, calendarId, fromSkinId: R1, toSkinId: V1 });
  }
});

test.afterAll(() => {
  let rounds = 0;
  for (;;) {
    const r = convexRun<{ deleted: number; isDone: boolean }>("skins:deleteTestFixtures", { keyPrefix: PREFIX });
    if (r.isDone || ++rounds > 20) break;
  }
  convexEnvRemove("ALLOW_TEST_HELPERS");
  const after = fingerprint();
  for (const table of TABLES) {
    expect(after[table], `huella de ${table}: datos previos de dev intactos`).toEqual(before[table]);
  }
  const leftovers = convexTableDocs("skins").filter((d) => String(d.key).startsWith(PREFIX)).length + convexTableDocs("calendars").filter((d) => String(d.name).startsWith(PREFIX)).length;
  expect(leftovers, "no queda ningún fixture").toBe(0);
});

test("estado inicial del alcance: 2 vigentes y 2 retirados con campos antiguos, C2 en un retirado, 2 filas de log", () => {
  expect(status()).toMatchObject({ skins: 4, inCatalog: 2, retired: 2, withLegacyFields: 4, calendars: 2, calendarsOnRetired: 1, calendarsMissingSkin: 0, skinMigrationLog: 2 });
});

test("1 · borrado: aborta con un calendario en un retirado; por lotes borra R1, salta R2 (referenciado) y nunca toca V1/V2", () => {
  const aborted = convexRun<{ aborted: boolean; audit: { legacy: number } }>("skinMigration:runDeleteRetiredSkins", { testScope: scope, expectRetired: 2 });
  expect(aborted.aborted).toBe(true);
  expect(aborted.audit.legacy).toBe(1);
  expect(docById("skins", R1), "nada borrado al abortar").toBeTruthy();

  let cursor: string | null = null;
  const totals = { batches: 0, deleted: 0, skippedReferenced: 0, deletedKeys: [] as string[] };
  for (;;) {
    const r: { deleted: number; skippedReferenced: number; deletedKeys: string[]; continueCursor: string; isDone: boolean } = convexRun(
      "skinMigration:deleteRetiredSkinsBatch",
      { cursor, batchSize: 3, testScope: scope }
    );
    totals.batches++;
    totals.deleted += r.deleted;
    totals.skippedReferenced += r.skippedReferenced;
    totals.deletedKeys.push(...r.deletedKeys);
    if (r.isDone) break;
    cursor = r.continueCursor;
  }
  expect(totals.batches, "varios lotes sobre la tabla entera").toBeGreaterThan(1);
  expect(totals).toMatchObject({ deleted: 1, skippedReferenced: 1, deletedKeys: [`${PREFIX}r1`] });
  expect(docById("skins", R1)).toBeUndefined();
  expect(docById("skins", R2), "R2 sigue: lo referencia C2").toBeTruthy();
  for (const id of [V1, V2]) expect(docById("skins", id), "vigente intacto").toBeTruthy();
});

test("2 · el log no se vacía mientras quede un retirado", () => {
  const aborted = convexRun<{ aborted: boolean; retired: number }>("skinMigration:runClearSkinMigrationLog", { testScope: scope, expectRows: 2 });
  expect(aborted).toMatchObject({ aborted: true, retired: 1 });
  expect(convexRunError("skinMigration:clearSkinMigrationLogBatch", { testScope: scope })).toMatch(/Quedan 1 skins retirados/);
  expect(status().skinMigrationLog).toBe(2);
});

test("3 · la limpieza de campos se rechaza con un retirado, sin escribir", () => {
  const aborted = convexRun<{ aborted: boolean; reason: string }>("skins:runClearLegacySkinFields", { testScope: scope, expectCatalog: 2, expectWithLegacyFields: 3 });
  expect(aborted.aborted).toBe(true);
  expect(aborted.reason).toMatch(/retirados/);
  expect(convexRunError("skins:clearLegacySkinFieldsBatch", { testScope: scope })).toMatch(/Quedan 1 skins retirados/);
  for (const id of [V1, V2]) expect(docById("skins", id)!.background, "V1/V2 conservan los campos").toBe("#fff8ee");
});

test("4 · expectRetired erróneo aborta sin borrar; lote parcial + reanudación; idempotente; V1/V2 conservan todo lo demás", () => {
  convexRun("calendars:setCalendarSkinForTests", { calendarId: C2, skinId: V2, keyPrefix: PREFIX });
  const wrong = convexRun<{ aborted: boolean; retired: number }>("skinMigration:runDeleteRetiredSkins", { testScope: scope, expectRetired: 5 });
  expect(wrong).toMatchObject({ aborted: true, retired: 1 });
  expect(docById("skins", R2), "nada borrado").toBeTruthy();
  const del = convexRun<{ aborted: boolean; deleted: number; skippedReferenced: number }>("skinMigration:runDeleteRetiredSkins", { testScope: scope, expectRetired: 1, batchSize: 3 });
  expect(del).toMatchObject({ aborted: false, deleted: 1, skippedReferenced: 0 });

  const snapshot = Object.fromEntries([V1, V2].map((id) => [id, docById("skins", id)!]));
  const styles = convexTableDocs("skinStyles").filter((s) => [V1, V2].includes(String(s.skinId))).map((s) => sha(s)).sort();

  const partial = convexRun<{ cleared: number; isDone: boolean }>("skins:clearLegacySkinFieldsBatch", { cursor: null, batchSize: 3, testScope: scope });
  const pending = status().withLegacyFields;
  console.log(`lote parcial: ${JSON.stringify(partial)} → pendientes del alcance: ${pending}`);
  expect(pending).toBe(2 - partial.cleared);

  const mismatch = convexRun<{ aborted: boolean }>("skins:runClearLegacySkinFields", { testScope: scope, expectCatalog: 2, expectWithLegacyFields: pending + 1 });
  expect(mismatch.aborted, "expect erróneo → aborta").toBe(true);
  const run1 = convexRun<{ aborted: boolean; ok: boolean; cleared: number; batches: number; finalStatus: Status }>("skins:runClearLegacySkinFields", {
    testScope: scope,
    expectCatalog: 2,
    expectWithLegacyFields: pending,
    batchSize: 3,
  });
  expect(run1).toMatchObject({ aborted: false, ok: true, cleared: pending });
  expect(run1.finalStatus.withLegacyFields).toBe(0);
  const run2 = convexRun<{ aborted: boolean; ok: boolean; cleared: number; alreadyClean: number }>("skins:runClearLegacySkinFields", {
    testScope: scope,
    expectCatalog: 2,
    expectWithLegacyFields: 0,
  });
  expect(run2).toMatchObject({ aborted: false, ok: true, cleared: 0, alreadyClean: 2 });

  for (const id of [V1, V2]) {
    const now = docById("skins", id)!;
    const was = { ...snapshot[id] };
    for (const field of ["background", "accent", "textColor", "textPill"]) {
      expect(now[field], `${field} quitado`).toBeUndefined();
      delete was[field];
    }
    expect(now, "mismo _id, _creationTime, key, name y description").toEqual(was);
  }
  expect(convexTableDocs("skinStyles").filter((s) => [V1, V2].includes(String(s.skinId))).map((s) => sha(s)).sort(), "skinStyles intactos").toEqual(styles);
});

test("5 · referencias válidas del alcance y auditoría limpia", () => {
  expect(status()).toMatchObject({ skins: 2, inCatalog: 2, retired: 0, withLegacyFields: 0, calendars: 2, calendarsOnRetired: 0, calendarsMissingSkin: 0 });
  const skinIds = new Set(convexTableDocs("skins").map((s) => s._id));
  for (const id of [C1, C2]) expect(skinIds.has(String(docById("calendars", id)!.skinId))).toBe(true);
  for (const style of convexTableDocs("skinStyles").filter((s) => [V1, V2].includes(String(s.skinId)))) expect(skinIds.has(String(style.skinId))).toBe(true);
  expect(convexRun("skinMigration:auditCalendarSkins", { testScope: scope })).toMatchObject({ total: 2, inCatalog: 2, legacy: 0, missingSkin: 0 });
});

test("6 · sin retirados, el log se vacía; la segunda vez es un no-op", () => {
  expect(convexRun("skinMigration:runClearSkinMigrationLog", { testScope: scope, expectRows: 2, batchSize: 3 })).toMatchObject({ aborted: false, ok: true, deleted: 2, remaining: 0 });
  expect(convexRun("skinMigration:runClearSkinMigrationLog", { testScope: scope, expectRows: 0 })).toMatchObject({ aborted: false, ok: true, deleted: 0, remaining: 0 });
});

test("7 · la URL del deployment llega al runtime (segunda condición de la barrera)", () => {
  const expected = new URL(process.env.NEXT_PUBLIC_CONVEX_URL!).hostname;
  expect(convexRun<{ host: string }>("testHelpers:whereAmIForTests").host).toBe(expected);
  expect(expected.endsWith(".convex.cloud")).toBe(true);
});
