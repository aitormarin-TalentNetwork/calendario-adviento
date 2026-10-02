// Evidencia de auditoría — TAL-62: PUERTA DE CONTRASTE de la parte visual
// (plan § 7, rondas 2 y 3). Para cada skin del catálogo 2026 evalúa cada
// texto de la pantalla del invitado contra su fondo EFECTIVO:
// - colores planos (ink / dim / weekend sobre bg, card y cell; todayInk
//   sobre today; tileInk sobre tile, icono ≥ 3:1);
// - degradados (hero de Noche y Nieve; "visto" seenA → seenB): extremos +
//   9 muestras intermedias interpoladas en sRGB (espacio por defecto de los
//   degradados CSS), peor caso;
// - Rojiblanco: textos del bloque sobre su píldora blanca (#ffffff).
// Reglas aprobadas por el PM (2026-10-01) tras el primer informe, ya
// normativas (mockup y app): el halo `glow` es decorativo y NUNCA queda bajo
// el texto (el contenido del bloque deja libre su esquina), así que no se
// compone bajo el texto; el número del "visto" va sobre una píldora oscura
// rgba(15,24,18,0.6); "Cuenta atrás" y "para …" van SIN opacidad y como
// TEXTO GRANDE (1.2rem/700 ≥ 18.66px en negrita), igual que el número.
// Umbrales WCAG: 4.5:1 texto normal, 3:1 texto grande y elementos gráficos
// (icono).
//
// Lee la paleta del catálogo SEMBRADO en el deployment de desarrollo
// (`skins.listCatalogPublic`), la misma que pinta la app.
//   set -a && source .env.local && source .env && set +a && node --no-warnings scripts/verify-tal62-skin-contrast.mjs
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
const secret = process.env.CONVEX_APP_SERVER_SECRET;
if (!url || !secret) {
  console.error("Faltan NEXT_PUBLIC_CONVEX_URL y/o CONVEX_APP_SERVER_SECRET en el entorno.");
  process.exit(1);
}

// --- color -----------------------------------------------------------------------------------
function parseColor(c) {
  c = c.trim().toLowerCase();
  let m = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (m) {
    let h = m[1];
    if (h.length === 3) h = h.split("").map((x) => x + x).join("");
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
  }
  m = c.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const [r, g, b, a = "1"] = m[1].split(",").map((s) => s.trim());
    return { r: +r, g: +g, b: +b, a: +a };
  }
  throw new Error(`Color no soportado: ${c}`);
}
const over = (top, bottom) => ({
  r: top.r * top.a + bottom.r * (1 - top.a),
  g: top.g * top.a + bottom.g * (1 - top.a),
  b: top.b * top.a + bottom.b * (1 - top.a),
  a: 1,
});
const withAlpha = (c, a) => ({ ...c, a });
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
function toHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h / 6, s, l };
}
function fromHsl({ h, s, l }) {
  const f = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  if (s === 0) return { r: l * 255, g: l * 255, b: l * 255, a: 1 };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  return { r: f(p, q, h + 1 / 3) * 255, g: f(p, q, h) * 255, b: f(p, q, h - 1 / 3) * 255, a: 1 };
}
/**
 * Propuesta de ajuste MÍNIMO: mueve la luminosidad (HSL) del color `move`
 * —manteniendo tono y saturación— en el sentido que aumenta el contraste
 * contra `fixed`, hasta llegar al umbral. Devuelve el hex propuesto o null.
 */
function minimalFix(move, fixed, min) {
  const base = toHsl(move);
  const dir = luminance(move) > luminance(fixed) ? 1 : -1;
  for (let step = 1; step <= 100; step++) {
    const l = Math.min(1, Math.max(0, base.l + dir * step / 100));
    const c = fromHsl({ ...base, l });
    if (ratio(c, fixed) >= min) return hex(c);
    if (l === 0 || l === 1) break;
  }
  return null;
}
const hex = ({ r, g, b }) => "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

/** Muestras de un fondo CSS: color plano → 1; linear-gradient → extremos + 9 intermedias (sRGB). */
function samples(background) {
  const g = background.match(/^linear-gradient\(([^)]*)\)$/i);
  if (!g) return [{ at: "plano", color: parseColor(background) }];
  const stops = g[1].split(",").map((s) => s.trim()).filter((s) => !/deg$|^to /.test(s)).map((s) => parseColor(s.split(/\s+/)[0]));
  if (stops.length !== 2) throw new Error(`Degradado con ${stops.length} paradas no soportado: ${background}`);
  const out = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const [a, b] = stops;
    out.push({ at: `${Math.round(t * 100)}%`, color: { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t, a: 1 } });
  }
  return out;
}

// --- evaluación ------------------------------------------------------------------------------
const rows = [];
let failures = 0;
function check(skin, what, fg, backgrounds, min) {
  let worst = null;
  for (const bg of backgrounds) {
    const effectiveFg = fg.a < 1 ? over(fg, bg.color) : fg;
    const r = ratio(effectiveFg, bg.color);
    if (!worst || r < worst.r) worst = { r, at: bg.at, fg: hex(effectiveFg), bg: hex(bg.color) };
  }
  const ok = worst.r >= min;
  if (!ok) failures++;
  let fix = "";
  if (!ok) {
    const fgFix = minimalFix(parseColor(worst.fg), parseColor(worst.bg), min);
    const bgFix = minimalFix(parseColor(worst.bg), parseColor(worst.fg), min);
    fix = `propuesta: texto ${worst.fg}→${fgFix ?? "—"} o fondo ${worst.bg}→${bgFix ?? "—"}`;
  }
  rows.push({ skin, what, min, ...worst, ok, fix });
}

const client = new ConvexHttpClient(url);
const catalog = await client.query(api.skins.listCatalogPublic, { serverSecret: secret });
if (catalog.length !== 8) {
  console.error(`El catálogo sembrado tiene ${catalog.length} skins, no 8. Siembra antes skins:seedSkinCatalog2026.`);
  process.exit(1);
}

for (const skin of catalog) {
  const p = skin.palette;
  const name = skin.name;
  const flat = (c) => [{ at: "plano", color: parseColor(c) }];
  // Texto sobre fondos planos de la pantalla.
  for (const [label, bg] of [["bg", p.bg], ["card", p.card], ["cell", p.cell]]) check(name, `ink sobre ${label}`, parseColor(p.ink), flat(bg), 4.5);
  for (const [label, bg] of [["bg", p.bg], ["card", p.card]]) check(name, `dim sobre ${label}`, parseColor(p.dim), flat(bg), 4.5);
  for (const [label, bg] of [["card", p.card], ["cell", p.cell]]) check(name, `weekend sobre ${label}`, parseColor(p.weekend), flat(bg), 4.5);
  check(name, "todayInk sobre today", parseColor(p.todayInk), flat(p.today), 4.5);
  check(name, "icono tileInk sobre tile", parseColor(p.tileInk), flat(p.tile), 3);
  // "Visto": número blanco sobre su píldora oscura, compuesta sobre cada muestra de seenA → seenB.
  const seen = samples(`linear-gradient(140deg,${p.seenA},${p.seenB})`);
  check(name, "blanco sobre píldora del visto (seenA→seenB)", parseColor("#ffffff"), seen.map((s) => ({ at: s.at, color: over(parseColor("rgba(15,24,18,0.6)"), s.color) })), 4.5);

  // Bloque de la cuenta atrás.
  if (skin.treatment === "stripes-pill") {
    const pill = flat("#ffffff");
    check(name, "heroInk sobre píldora blanca", parseColor(p.heroInk), pill, 4.5);
    void withAlpha;
    check(name, "heroNum (grande) sobre píldora blanca", parseColor(p.heroNum), pill, 3);
  } else {
    const heroSamples = samples(p.hero);
    check(name, "heroInk (grande: 'Cuenta atrás', 'para …') sobre bloque", parseColor(p.heroInk), heroSamples, 3);
    check(name, "heroNum (grande) sobre bloque", parseColor(p.heroNum), heroSamples, 3);
  }
}

console.log("Umbrales: 4.5:1 texto normal · 3:1 texto grande e icono. Peor caso por par.\n");
console.log("skin".padEnd(13) + "par".padEnd(44) + "mín  peor    texto    fondo    dónde");
for (const r of rows) {
  console.log(`${r.skin.padEnd(13)}${r.what.padEnd(44)}${String(r.min).padEnd(5)}${r.r.toFixed(2).padStart(5)}:1 ${r.fg} ${r.bg} ${r.at.padEnd(10)} ${r.ok ? "✓" : "✗"} ${r.fix}`);
}
console.log(failures === 0 ? `\nOK — los ${rows.length} pares cumplen.` : `\n✗ ${failures} de ${rows.length} pares NO cumplen. Puerta de contraste CERRADA: informe al PM antes de publicar la parte visual.`);
process.exit(failures === 0 ? 0 : 1);
