// Evidencia de auditoría — TAL-22 (Esquema de color de skins), ronda 1:
// demuestra que el schema nuevo de `skins` (background/accent
// OPCIONALES) es seguro de desplegar incluso cuando ya existen filas
// "legacy" sin esos campos — el problema exacto que el auditor señaló:
// si hubieran sido requeridos desde el principio, Convex habría
// rechazado el push ENTERO (valida TODOS los documentos existentes
// contra el schema nuevo antes de aceptarlo) antes de que
// `seedSkinCatalog` pudiera ejecutarse nunca para arreglarlas.
//
// Simula el estado real que puede tener un deployment con datos previos
// a esta tarea: inserta una fila "legacy" de skins sin background/accent
// (vía una mutation temporal que este mismo script escribe y borra, ver
// SCRATCH_SOURCE más abajo — no forma parte del código de aplicación),
// confirma que el schema actual despliega igual con esa fila presente,
// corre `seedSkinCatalog` (el backfill real), y verifica contra el
// deployment real que TODAS las filas del catálogo (22, key por key)
// terminan con background/accent poblados.
//
// No forma parte de la aplicación — script de verificación puntual,
// guardado versionado (mismo criterio que
// scripts/verify-tal12-delete-concurrency.mjs) para que la evidencia se
// pueda re-ejecutar, no solo leer en texto. Necesita
// NEXT_PUBLIC_CONVEX_URL y CONVEX_APP_SERVER_SECRET en el entorno (los
// mismos de `.env.local`) y el CLI de Convex ya autenticado contra el
// deployment de esta terminal. Ejecutar desde la raíz del worktree:
//
//   set -a && source .env.local && set +a && node scripts/verify-tal22-skin-schema-migration.mjs
//
// Escribe y borra un fichero temporal `convex/_scratch_tal22_verify.ts`
// y despliega varias veces (instala la mutation temporal, confirma el
// deploy con la fila legacy presente, y la quita al terminar) — deja el
// deployment en el mismo conjunto de funciones en el que lo encontró.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, unlink } from "node:fs/promises";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

const run = promisify(execFile);
const url = process.env.NEXT_PUBLIC_CONVEX_URL;
const goodSecret = process.env.CONVEX_APP_SERVER_SECRET;
if (!url || !goodSecret) {
  console.error("Faltan NEXT_PUBLIC_CONVEX_URL y/o CONVEX_APP_SERVER_SECRET en el entorno.");
  process.exit(1);
}
const client = new ConvexHttpClient(url);

const SCRATCH_PATH = "convex/_scratch_tal22_verify.ts";
const LEGACY_KEY = "verify-tal22-legacy-skin";

const SCRATCH_SOURCE = `// TEMPORAL — generado por scripts/verify-tal22-skin-schema-migration.mjs,
// se borra automáticamente al terminar el script. Simula una fila
// "legacy" de skins (sin background/accent) para probar que el schema
// actual (campos opcionales) la acepta sin romper el deploy.
import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

export const insertLegacySkin = internalMutation({
  args: { key: v.string(), name: v.string() },
  handler: async (ctx, args) => ctx.db.insert("skins", { key: args.key, name: args.name }),
});

export const deleteByKey = internalMutation({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("skins")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    if (existing) await ctx.db.delete(existing._id);
  },
});
`;

async function convexRun(fn, argsObj) {
  const { stdout } = await run("npx", ["convex", "run", fn, JSON.stringify(argsObj)], { cwd: process.cwd() });
  return stdout
    .split("\n")
    .filter((l) => l.trim() && !l.includes("Warning") && !l.includes("trace-warnings"))
    .join("\n")
    .trim();
}

// `npx convex dev --once` sale con código distinto de cero si el push
// falla de verdad — `run()` (promisify(execFile)) ya rechaza la promesa
// en ese caso, así que un fallo real de deploy siempre se propaga como
// excepción sin que este helper tenga que interpretar el texto de la
// salida (parsear "functions ready"/etc. resultó frágil en la práctica —
// el CLI no siempre repite esa frase exacta en un push sin cambios reales
// que sincronizar, lo que producía falsos positivos de "falló" en un
// deploy que en realidad había ido bien — corrección de auditoría, ronda
// 2 sobre la propia corrección de ronda 2, verificado en vivo).
async function convexDeploy(label) {
  console.log(`   -- npx convex dev --once (${label}) --`);
  const { stdout } = await run("npx", ["convex", "dev", "--once"], { cwd: process.cwd() });
  console.log(stdout);
  return stdout;
}

// Corrección de auditoría, ronda 2: la versión anterior atrapaba CUALQUIER
// error de esta función en un solo `catch {}` mudo, incluido un fallo real
// del `npx convex dev --once` de cierre — que dejaría el deployment con la
// mutation temporal todavía instalada, sin que nadie se enterara. Ahora
// solo se ignora lo que de verdad es "ya no había nada que limpiar"
// (`unlink` sobre un fichero que ya no existe); un fallo real de deploy
// (código de salida distinto de cero) se reporta explícitamente. Y en vez
// de fiarse del texto de esa salida (frágil, ver comentario de
// `convexDeploy`), la limpieza se verifica comprobando el ESTADO real
// después: intentar llamar a la mutation temporal debe fallar con "no
// encontrada" — si eso pasa, el deploy de limpieza funcionó de verdad,
// haya dicho lo que haya dicho por stdout.
async function cleanup() {
  let ok = true;
  try {
    await convexRun("_scratch_tal22_verify:deleteByKey", { key: LEGACY_KEY });
  } catch (err) {
    // Puede fallar porque la fila/función ya no exista (limpieza previa
    // parcial) — no es necesariamente un problema, se confirma el estado
    // real más abajo.
    console.log("   (borrado de la fila legacy no confirmado aquí, se verifica el estado real más abajo):", err.message.split("\n")[0]);
  }
  try {
    await unlink(SCRATCH_PATH);
  } catch (err) {
    if (err.code !== "ENOENT") {
      ok = false;
      console.error(`   AVISO DE LIMPIEZA: no se pudo borrar ${SCRATCH_PATH}:`, err.message);
    }
  }
  try {
    await convexDeploy("limpieza final — quita la mutation temporal");
  } catch (err) {
    ok = false;
    console.error(
      "   ERROR DE LIMPIEZA: el deploy final falló (código de salida distinto de cero) — el deployment puede haber quedado con la mutation temporal instalada. Revisar manualmente (`npx convex dev --once`):",
      err.message
    );
    return ok;
  }
  // Verificación de estado real, no de texto: si la mutation temporal
  // sigue desplegada, esta llamada tendría éxito (o fallaría por otro
  // motivo distinto a "no encontrada") — eso SÍ sería la señal real de
  // que la limpieza no terminó de aplicarse.
  try {
    await convexRun("_scratch_tal22_verify:deleteByKey", { key: LEGACY_KEY });
    ok = false;
    console.error(
      "   ERROR DE LIMPIEZA: la mutation temporal sigue respondiendo tras el deploy de limpieza — no se retiró de verdad."
    );
  } catch (err) {
    if (!/Could not find function/i.test(err.message)) {
      ok = false;
      console.error("   AVISO DE LIMPIEZA: fallo inesperado al confirmar que la mutation temporal ya no existe:", err.message);
    } else {
      console.log("   OK: confirmado que la mutation temporal ya no está desplegada (deployment devuelto al estado original).");
    }
  }
  return ok;
}

async function main() {
  console.log("1. Escribiendo mutation temporal para simular una fila legacy...");
  await writeFile(SCRATCH_PATH, SCRATCH_SOURCE);

  await convexDeploy("instala la mutation temporal");

  console.log("2. Insertando fila legacy sin background/accent (simula estado pre-TAL-22)...");
  const legacyId = await convexRun("_scratch_tal22_verify:insertLegacySkin", {
    key: LEGACY_KEY,
    name: "Legacy de prueba",
  });
  console.log("   fila legacy insertada:", legacyId);

  console.log(
    "3. Confirmando que el schema ACTUAL (background/accent OPCIONALES) despliega limpio con esa fila presente..."
  );
  await convexDeploy("re-despliega el schema real de esta tarea con la fila legacy ya presente");
  console.log(
    "   OK: deploy limpio con la fila legacy presente — el escenario exacto que habría roto el push entero si background/accent fueran requeridos."
  );

  console.log("4. Corriendo el backfill real (seedSkinCatalog)...");
  const seedResult = await convexRun("skins:seedSkinCatalog", {});
  console.log("   ids devueltos:", seedResult);

  console.log("5. Verificando contra el deployment real que las 22 filas del catálogo tienen background/accent...");
  const allSkins = await client.query(api.skins.listAllPublic, { serverSecret: goodSecret });
  const catalogKeys = new Set([
    "dorado", "grosella", "medianoche", "pino",
    "nochebuena", "nieve", "confeti", "dorado-real", "bosque-nordico", "neon-fiesta",
    "historieta", "enamorados", "oficina", "superheroe", "bebe", "adolescente",
    "memorias-de-familia", "amigas", "kpop", "gotico", "baloncesto", "futbol",
  ]);
  const catalogRows = allSkins.filter((s) => catalogKeys.has(s.key));
  console.log(`   ${catalogRows.length}/22 filas del catálogo encontradas.`);
  if (catalogRows.length !== 22) {
    throw new Error(`VIOLACION: se esperaban 22 filas del catálogo, se encontraron ${catalogRows.length}`);
  }
  const missingColor = catalogRows.filter((s) => !s.background || !s.accent);
  if (missingColor.length > 0) {
    throw new Error(
      `VIOLACION: ${missingColor.length} fila(s) del catálogo sin background/accent tras el backfill: ${missingColor.map((s) => s.key).join(", ")}`
    );
  }
  console.log("   OK: las 22 filas del catálogo tienen background Y accent poblados.");

  const legacyRow = allSkins.find((s) => s.key === LEGACY_KEY);
  console.log(
    `   Fila legacy de prueba (fuera del catálogo, a propósito NO tocada por el backfill): background=${legacyRow?.background ?? "undefined"}, accent=${legacyRow?.accent ?? "undefined"} — confirma que el schema opcional convive sin error con una fila real sin esos campos.`
  );

  console.log("6. Limpieza — borrando la fila legacy de prueba y la mutation temporal...");
  const cleanupOk = await cleanup();
  if (!cleanupOk) {
    throw new Error(
      "Las comprobaciones principales pasaron, pero la limpieza falló — ver avisos arriba. Revisar el deployment a mano antes de darlo por cerrado."
    );
  }

  console.log("DONE");
}

main().catch(async (err) => {
  console.error("ERROR:", err);
  await cleanup();
  process.exit(1);
});
