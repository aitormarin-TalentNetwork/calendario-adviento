// Evidencia de auditoría — TAL-22 (Esquema de color de skins), ronda 1:
// verifica con concurrencia/estado real (no solo narración) que
// `seedSkinCatalog` converge al mismo estado final sin importar el punto
// de partida — en concreto, el escenario que motivó cambiar `createSkin`
// de "inserta si no existe, si no ignora" a un upsert de verdad (inserta
// o `patch`): una fila ya existente con datos desactualizados/corruptos
// debe recuperar los valores canónicos del catálogo al re-sembrar, sin
// duplicar la fila.
//
// No forma parte de la aplicación — script de verificación puntual,
// guardado versionado (mismo criterio que
// scripts/verify-tal12-delete-concurrency.mjs) para que la evidencia se
// pueda re-ejecutar, no solo leer en texto. Necesita
// NEXT_PUBLIC_CONVEX_URL y CONVEX_APP_SERVER_SECRET en el entorno (los
// mismos de `.env.local`). Ejecutar desde la raíz del worktree:
//
//   set -a && source .env.local && set +a && node scripts/verify-tal22-skin-seed-idempotency.mjs
//
// Corrompe y recupera la fila real `dorado` del catálogo — al terminar
// queda con sus valores canónicos correctos (mismo estado que antes de
// correr el script), no con datos de prueba colgando.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
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

async function convexRun(fn, argsObj) {
  const { stdout } = await run("npx", ["convex", "run", fn, JSON.stringify(argsObj)], { cwd: process.cwd() });
  return stdout
    .split("\n")
    .filter((l) => l.trim() && !l.includes("Warning") && !l.includes("trace-warnings"))
    .join("\n")
    .trim();
}

const CANONICAL_DORADO = {
  key: "dorado",
  name: "Dorado",
  description: "El clásico del MVP — degradado cálido de oro, elegante y luminoso.",
  background: "linear-gradient(160deg, #c99a3d 0%, #e3bb63 100%)",
  accent: "#1b3a2f",
};

async function main() {
  console.log("0. Estado inicial de la tabla — cuántas filas hay antes de tocar nada...");
  const before = await client.query(api.skins.listAllPublic, { serverSecret: goodSecret });
  console.log(`   ${before.length} filas.`);
  const doradoBefore = before.find((s) => s.key === "dorado");
  if (!doradoBefore) {
    throw new Error(
      "No existe la fila 'dorado' — corre primero `npx convex run skins:seedSkinCatalog '{}'` para poblar el catálogo."
    );
  }
  const doradoId = doradoBefore._id;
  console.log(`   'dorado' ya existe con _id=${doradoId} — se usa esa misma fila para la prueba.`);

  // Corrección de auditoría, ronda 2: corromper y verificar viven en un
  // `try` cuyo `finally` SIEMPRE vuelve a sembrar el catálogo — antes, si
  // cualquiera de las comprobaciones de la corrupción (líneas de abajo)
  // lanzaba, el script terminaba sin haber llegado nunca a
  // `seedSkinCatalog`, dejando 'dorado' corrompido de verdad en el
  // deployment sin ningún camino de recuperación automático.
  console.log("1. Corrompiendo 'dorado' a propósito (nombre/descripción/color incorrectos)...");
  try {
    await convexRun("skins:createSkin", {
      key: "dorado",
      name: "Dorado (drift de prueba)",
      description: "valor incorrecto de prueba",
      background: "red",
      accent: "#000000",
    });
    const afterCorrupt = await client.query(api.skins.listAllPublic, { serverSecret: goodSecret });
    const doradoCorrupt = afterCorrupt.find((s) => s.key === "dorado");
    console.log(`   ahora: name=${doradoCorrupt.name}, background=${doradoCorrupt.background}, accent=${doradoCorrupt.accent}`);
    if (doradoCorrupt.name !== "Dorado (drift de prueba)") {
      throw new Error("La corrupción de prueba no se aplicó — el arnés de prueba no está probando lo que dice probar.");
    }
    if (doradoCorrupt._id !== doradoId) {
      throw new Error("VIOLACION: 'createSkin' sobre una key existente creó una fila NUEVA en vez de tocar la misma.");
    }
  } finally {
    console.log(
      "2. Re-sembrando el catálogo completo (recuperación — se ejecuta SIEMPRE, incluso si algo de arriba falló)..."
    );
    await convexRun("skins:seedSkinCatalog", {});
  }

  console.log("3. Verificando que 'dorado' recuperó los valores canónicos, con el MISMO _id...");
  const afterReseed = await client.query(api.skins.listAllPublic, { serverSecret: goodSecret });
  const doradoRecovered = afterReseed.find((s) => s.key === "dorado");
  console.log(
    `   ahora: _id=${doradoRecovered._id}, name=${doradoRecovered.name}, background=${doradoRecovered.background}, accent=${doradoRecovered.accent}`
  );

  if (doradoRecovered._id !== doradoId) {
    throw new Error("VIOLACION: re-sembrar creó una fila NUEVA para 'dorado' en vez de recuperar la existente (duplicado).");
  }
  if (doradoRecovered.name !== CANONICAL_DORADO.name) {
    throw new Error(`VIOLACION: name no se recuperó — esperado "${CANONICAL_DORADO.name}", fue "${doradoRecovered.name}"`);
  }
  if (doradoRecovered.description !== CANONICAL_DORADO.description) {
    throw new Error("VIOLACION: description no se recuperó al valor canónico.");
  }
  if (doradoRecovered.background !== CANONICAL_DORADO.background) {
    throw new Error(`VIOLACION: background no se recuperó — esperado "${CANONICAL_DORADO.background}", fue "${doradoRecovered.background}"`);
  }
  if (doradoRecovered.accent !== CANONICAL_DORADO.accent) {
    throw new Error(`VIOLACION: accent no se recuperó — esperado "${CANONICAL_DORADO.accent}", fue "${doradoRecovered.accent}"`);
  }

  console.log("4. Confirmando que el número total de filas no cambió (sin duplicados)...");
  console.log(`   ${afterReseed.length} filas (antes: ${before.length}).`);
  if (afterReseed.length !== before.length) {
    throw new Error(`VIOLACION: el número de filas cambió (${before.length} -> ${afterReseed.length}) — re-sembrar duplicó algo.`);
  }

  console.log(
    "OK: 'dorado' se corrompió y se recuperó a sus valores canónicos exactos, con el mismo _id, sin duplicar ninguna fila — createSkin/seedSkinCatalog convergen de verdad, no solo 'no fallan'."
  );
  console.log("DONE");
}

main().catch((err) => {
  console.error("ERROR:", err);
  process.exit(1);
});
