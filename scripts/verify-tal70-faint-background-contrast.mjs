// Evidencia de auditoría — TAL-70: PUERTA DE CONTRASTE del fondo tenue
// (plan loop3 § 3). Misma puerta que TAL-62 (scripts/verify-tal62-skin-contrast.mjs,
// mismos umbrales WCAG y mismo catálogo sembrado), con el fondo EFECTIVO que
// deja la imagen de fondo del calendario tal como la pinta la app ahora:
// - página: fondo del skin + capa de la imagen al 10 % de opacidad
//   (`faintBackgroundLayer`, `saturate(0.7)`), con el PEOR caso de imagen:
//   blanca pura y negra pura (la saturación no cambia ninguna de las dos);
// - tarjeta del mes: `color-mix(in srgb, var(--skin-card) 85%, transparent)`
//   sobre esa página;
// - modal del vídeo: la misma tarjeta al 85 % sobre el telón
//   rgba(0,0,0,0.6) que tapa la página.
// Las casillas, el bloque de la cuenta atrás, el "hoy" y los avisos son
// opacos y no cambian: ya los cubre la puerta de TAL-62.
// La paleta del skin no depende del tema claro/oscuro de la app (las
// variables `--skin-*` se ponen en línea en el contenedor), así que los
// números valen para los dos; el E2E de TAL-70 lo comprueba en el navegador.
//   set -a && source .env.local && set +a && node --no-warnings scripts/verify-tal70-faint-background-contrast.mjs
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

export const FAINT_IMAGE_OPACITY = 0.1;
export const CARD_OPACITY = 0.85;
const MODAL_BACKDROP = { r: 0, g: 0, b: 0, a: 0.6 };

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
const secret = process.env.CONVEX_APP_SERVER_SECRET;
if (!url || !secret) {
  console.error("Faltan NEXT_PUBLIC_CONVEX_URL y/o CONVEX_APP_SERVER_SECRET en el entorno.");
  process.exit(1);
}

function parseColor(c) {
  const m = c.trim().toLowerCase().match(/^#([0-9a-f]{6})$/);
  if (!m) throw new Error(`Color no soportado: ${c}`);
  const h = m[1];
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
}
const withAlpha = (c, a) => ({ ...c, a });
const over = (top, bottom) => ({
  r: top.r * top.a + bottom.r * (1 - top.a),
  g: top.g * top.a + bottom.g * (1 - top.a),
  b: top.b * top.a + bottom.b * (1 - top.a),
  a: 1,
});
function luminance({ r, g, b }) {
  const ch = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}
function ratio(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}
const hex = ({ r, g, b }) => "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

const IMAGES = [
  ["imagen blanca", parseColor("#ffffff")],
  ["imagen negra", parseColor("#000000")],
];

const rows = [];
let failures = 0;
// `info: true` — par que se informa sin bloquear (decisión de la Directora,
// 2026-10-02): "dim sobre página" lo evalúa TAL-62 por paleta, pero ningún
// texto `--skin-dim` va sobre la página (todos están dentro de la tarjeta
// del mes, door-grid.tsx). Si algún día alguno sale fuera, el barrido de
// e2e/tal61-estilo-base.spec.ts exige una excepción de valor exacto con su
// fondo real.
function check(skin, what, fg, backgrounds, min, info = false) {
  let worst = null;
  for (const [at, bg] of backgrounds) {
    const r = ratio(fg, bg);
    if (!worst || r < worst.r) worst = { r, at, bg: hex(bg) };
  }
  const ok = worst.r >= min;
  if (!ok && !info) failures++;
  rows.push({ skin, what, min, fg: hex(fg), ...worst, ok, info });
}

const client = new ConvexHttpClient(url);
const catalog = await client.query(api.skins.listCatalogPublic, { serverSecret: secret });
if (catalog.length !== 8) {
  console.error(`El catálogo sembrado tiene ${catalog.length} skins, no 8. Siembra antes skins:seedSkinCatalog2026.`);
  process.exit(1);
}

for (const skin of catalog) {
  const p = skin.palette;
  const page = IMAGES.map(([at, img]) => [at, over(withAlpha(img, FAINT_IMAGE_OPACITY), parseColor(p.bg))]);
  const card = page.map(([at, bg]) => [at, over(withAlpha(parseColor(p.card), CARD_OPACITY), bg)]);
  const modal = page.map(([at, bg]) => [at, over(withAlpha(parseColor(p.card), CARD_OPACITY), over(MODAL_BACKDROP, bg))]);
  check(skin.name, "ink sobre página (bg + imagen 10 %)", parseColor(p.ink), page, 4.5);
  check(skin.name, "dim sobre página (bg + imagen 10 %) [dato]", parseColor(p.dim), page, 4.5, true);
  for (const key of ["ink", "dim", "weekend"]) check(skin.name, `${key} sobre tarjeta del mes (card 85 %)`, parseColor(p[key]), card, 4.5);
  check(skin.name, "ink sobre modal (card 85 % sobre telón 0.6)", parseColor(p.ink), modal, 4.5);
}

console.log(`Imagen al ${FAINT_IMAGE_OPACITY * 100} % · tarjetas al ${CARD_OPACITY * 100} % · umbral 4.5:1. Peor caso por par (imagen blanca o negra).\n`);
console.log("skin".padEnd(13) + "par".padEnd(48) + "mín  peor    texto    fondo    dónde");
for (const r of rows) {
  console.log(`${r.skin.padEnd(13)}${r.what.padEnd(48)}${String(r.min).padEnd(5)}${r.r.toFixed(2).padStart(5)}:1 ${r.fg} ${r.bg} ${r.at.padEnd(14)} ${r.ok ? "✓" : r.info ? "· (dato, sin texto real)" : "✗"}`);
}
console.log(failures === 0 ? `\nOK — los ${rows.filter((r) => !r.info).length} pares de textos reales cumplen (${rows.filter((r) => r.info).length} pares informativos aparte).` : `\n✗ ${failures} de ${rows.length} pares NO cumplen. Puerta de contraste CERRADA: avisar a la Directora con estos números.`);
process.exit(failures === 0 ? 0 : 1);
