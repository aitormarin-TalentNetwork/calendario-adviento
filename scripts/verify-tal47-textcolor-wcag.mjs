// Evidencia de auditoría — TAL-47 (textColor por skin), verificación
// matemática de contraste WCAG AA contra el DEPLOYMENT REAL, no solo
// contra los valores que Aitor/PM ya validaron a mano en Linear — mismo
// principio que TAL-24/TAL-43: "no basta con que se vea bien", el cálculo
// tiene que pasar de verdad, y verificarse contra lo que de verdad quedó
// sembrado (no contra el código fuente, que podría no coincidir tras un
// fallo de deploy).
//
// Para cada skin del catálogo:
// - Si NO lleva píldora (`textPill` ausente/false): extrae todos los
//   colores hex de `background` (puede tener varias paradas de
//   degradado/rayas) y calcula el contraste WCAG entre `textColor` y CADA
//   parada — el peor caso de todas tiene que pasar 4.5:1 (AA, texto
//   normal). Un degradado con una parada clara y otra oscura falla si
//   CUALQUIERA de las dos no alcanza el mínimo con el `textColor` fijo
//   elegido.
// - Si lleva píldora (`textPill: true`): el texto no se apoya en el
//   fondo crudo sino en la píldora semitransparente
//   (`rgba(15,24,18,0.6)`, mismo valor que ya usa la píldora de "visto"
//   del grid) — compone esa píldora sobre CADA parada del fondo
//   (composición alfa real, no solo el color de la píldora a secas) y
//   calcula el contraste del `textColor` contra ESE compuesto, peor caso
//   de todas las paradas.
//
// No forma parte de la aplicación — script de verificación puntual,
// guardado versionado (mismo criterio que
// scripts/verify-tal22-skin-schema-migration.mjs). Necesita
// NEXT_PUBLIC_CONVEX_URL y CONVEX_APP_SERVER_SECRET en el entorno (los
// mismos de .env.local) y el CLI de Convex ya autenticado contra el
// deployment de esta terminal. Solo LEE (además de sembrar, que es
// idempotente) — no escribe datos de prueba que necesiten limpieza.
//
//   set -a && source .env.local && set +a && node scripts/verify-tal47-textcolor-wcag.mjs
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

// rgba(15,24,18,0.7) — NO 0.6 (la píldora de "visto" del grid, la
// referencia original del brief). Subido de 0.6 a 0.7 tras un hallazgo
// real de esta misma verificación: "rojiblanco" (TAL-48, rayas
// verticales rojo/#ffffff puro) fallaba AA en la parada blanca con 0.6
// (4.20:1, por debajo de 4.5) — el 0.6 alpha no oscurece lo bastante un
// fondo blanco puro para que el texto claro tenga contraste suficiente.
// 0.7 da margen cómodo en el peor caso de los 6 skins con píldora
// (rojiblanco, blanco puro, 5.96:1) sin perjudicar a los otros 5 (todos
// mejoran su margen igual). Ver docs/skins.md § "textColor" para el
// detalle completo de este hallazgo.
const PILL_RGBA = { r: 15, g: 24, b: 18, a: 0.7 };
const AA_MIN = 4.5;

function hexToRgb(hex) {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

function srgbChannelToLinear(c8bit) {
  const c = c8bit / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance({ r, g, b }) {
  return 0.2126 * srgbChannelToLinear(r) + 0.7152 * srgbChannelToLinear(g) + 0.0722 * srgbChannelToLinear(b);
}

function contrastRatio(rgbA, rgbB) {
  const L1 = relativeLuminance(rgbA);
  const L2 = relativeLuminance(rgbB);
  const lighter = Math.max(L1, L2);
  const darker = Math.min(L1, L2);
  return (lighter + 0.05) / (darker + 0.05);
}

// Composición alfa simple (mismo criterio ya documentado en
// skin-appearance.ts): overlay*alpha + background*(1-alpha), canal a canal.
function compositeOver(overlayRgba, backgroundRgb) {
  return {
    r: overlayRgba.r * overlayRgba.a + backgroundRgb.r * (1 - overlayRgba.a),
    g: overlayRgba.g * overlayRgba.a + backgroundRgb.g * (1 - overlayRgba.a),
    b: overlayRgba.b * overlayRgba.a + backgroundRgb.b * (1 - overlayRgba.a),
  };
}

function extractHexStops(backgroundCss) {
  const matches = backgroundCss.match(/#[0-9a-fA-F]{3,6}/g);
  return matches ? [...new Set(matches)] : [];
}

async function convexRun(fn, argsObj) {
  const { stdout } = await run("npx", ["convex", "run", fn, JSON.stringify(argsObj)], { cwd: process.cwd() });
  return stdout;
}

async function convexDeploy(label) {
  console.log(`   -- npx convex dev --once (${label}) --`);
  const { stdout } = await run("npx", ["convex", "dev", "--once"], { cwd: process.cwd() });
  console.log(stdout);
}

async function main() {
  console.log("1. Desplegando el código actual (evita ejecutar una versión stale, ver memoria de proyecto)...");
  await convexDeploy("código actual de convex/skins.ts y convex/schema.ts");

  console.log("2. Sembrando/actualizando el catálogo real (seedSkinCatalog, idempotente)...");
  await convexRun("skins:seedSkinCatalog", {});

  console.log("3. Leyendo el catálogo real desde el deployment (listAllPublic)...");
  const allSkins = await client.query(api.skins.listAllPublic, { serverSecret: goodSecret });
  const catalogSkins = allSkins.filter((s) => s.background && s.accent);
  console.log(`   ${catalogSkins.length} filas con background/accent poblados encontradas.`);

  const missingTextColor = catalogSkins.filter((s) => !s.textColor);
  if (missingTextColor.length > 0) {
    throw new Error(
      `VIOLACION: ${missingTextColor.length} fila(s) del catálogo sin textColor: ${missingTextColor.map((s) => s.key).join(", ")}`
    );
  }
  console.log("   OK: todas las filas del catálogo tienen textColor poblado.");

  console.log("4. Verificando contraste WCAG AA (>= 4.5:1) real, peor caso por skin...\n");
  const results = [];
  for (const skin of catalogSkins) {
    const stops = extractHexStops(skin.background);
    if (stops.length === 0) {
      results.push({ key: skin.key, ok: false, worst: null, reason: "sin paradas hex extraíbles del background" });
      continue;
    }
    const textRgb = hexToRgb(skin.textColor);
    let worst = Infinity;
    for (const stopHex of stops) {
      const stopRgb = hexToRgb(stopHex);
      const effectiveBg = skin.textPill ? compositeOver(PILL_RGBA, stopRgb) : stopRgb;
      const cr = contrastRatio(textRgb, effectiveBg);
      if (cr < worst) worst = cr;
    }
    results.push({ key: skin.key, ok: worst >= AA_MIN, worst, pill: !!skin.textPill, stops: stops.length });
  }

  for (const r of results) {
    const status = r.ok ? "OK  " : "FAIL";
    const worstStr = r.worst === null ? "n/a" : r.worst.toFixed(2) + ":1";
    console.log(
      `   [${status}] ${r.key.padEnd(22)} peor caso ${worstStr.padEnd(8)} (${r.pill ? "píldora" : "plano"}, ${r.stops} parada(s))`
    );
  }

  const failures = results.filter((r) => !r.ok);
  if (failures.length > 0) {
    throw new Error(
      `VIOLACION: ${failures.length} skin(s) no alcanzan 4.5:1 en el peor caso: ${failures.map((f) => f.key).join(", ")}`
    );
  }

  console.log(`\n   OK: las ${results.length} filas verificadas pasan WCAG AA (>= 4.5:1) en el peor caso real de su degradado/rayas.`);
  console.log("\nDONE");
}

main().catch((err) => {
  console.error("ERROR:", err);
  process.exit(1);
});
