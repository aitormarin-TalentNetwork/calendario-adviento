// Evidencia de auditoría — TAL-60: contraste del icono de portada dentro de
// su recuadro pastel (WCAG 1.4.11, elementos gráficos ≥ 3:1).
//
// Para cada skin del catálogo del deployment de esta terminal calcula, en
// claro y en oscuro, qué color usa `resolveCoverIconColors` (el accent del
// skin si da ≥ 3:1 contra `--icon-tile-bg`; si no, el token
// `--icon-tile-fg`) y el contraste resultante. Comprueba el token de
// respaldo con su valor PROVISIONAL de TAL-60 (la tinta del tema) y con el
// DEFINITIVO acordado con TAL-61 (`--primary`), porque la que publique
// segunda tiene que volver a pasar este script (docs/iconos.md).
//
// Importa directamente `src/lib/cover-icon-colors.ts` (Node ≥ 22 quita los
// tipos al importar .ts), así que mide la MISMA función que usa la app.
//
//   set -a && source .env.local && source .env && set +a && node scripts/verify-tal60-icon-contrast.mjs
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import { ICON_TILE_BG, MIN_ICON_CONTRAST, contrastRatio, resolveCoverIconColors } from "../src/lib/cover-icon-colors.ts";

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
const secret = process.env.CONVEX_APP_SERVER_SECRET;
if (!url || !secret) {
  console.error("Faltan NEXT_PUBLIC_CONVEX_URL y/o CONVEX_APP_SERVER_SECRET en el entorno.");
  process.exit(1);
}

const FALLBACK_TOKENS = {
  "provisional TAL-60 (tinta)": { light: "#16211c", dark: "#ece6d6" },
  "definitivo TAL-61 (--primary)": { light: "#7b61ff", dark: "#8f7bff" },
};

let failures = 0;
const fmt = (n) => n.toFixed(2).padStart(5);

console.log(`Fondo del recuadro (--icon-tile-bg): claro ${ICON_TILE_BG.light} · oscuro ${ICON_TILE_BG.dark} · mínimo ${MIN_ICON_CONTRAST}:1\n`);
for (const [label, fg] of Object.entries(FALLBACK_TOKENS)) {
  const light = contrastRatio(fg.light, ICON_TILE_BG.light);
  const dark = contrastRatio(fg.dark, ICON_TILE_BG.dark);
  const ok = light >= MIN_ICON_CONTRAST && dark >= MIN_ICON_CONTRAST;
  if (!ok) failures++;
  console.log(`--icon-tile-fg ${label}: claro ${fmt(light)}:1 · oscuro ${fmt(dark)}:1 ${ok ? "✓" : "✗"}`);
}

const client = new ConvexHttpClient(url);
const skins = await client.query(api.skins.listAllPublic, { serverSecret: secret });
// Login (sin skin, `<CoverIcon>` sin accent) y skins sin accent hex → token.
const cases = [...skins.map((s) => ({ name: s.name, accent: s.accent ?? null })), { name: "(login, sin skin)", accent: null }];

for (const [tokenLabel, fg] of Object.entries(FALLBACK_TOKENS)) {
  console.log(`\nCon --icon-tile-fg ${tokenLabel}:`);
  console.log("skin".padEnd(28) + "accent    claro (color · contraste)     oscuro (color · contraste)");
  for (const c of cases) {
    const colors = resolveCoverIconColors(c.accent);
    const lightColor = colors.light ?? fg.light;
    const darkColor = colors.dark ?? fg.dark;
    const light = contrastRatio(lightColor, ICON_TILE_BG.light);
    const dark = contrastRatio(darkColor, ICON_TILE_BG.dark);
    const ok = light >= MIN_ICON_CONTRAST && dark >= MIN_ICON_CONTRAST;
    if (!ok) failures++;
    const tag = (resolved) => (resolved ? "skin " : "token");
    console.log(
      `${c.name.slice(0, 27).padEnd(28)}${String(c.accent).padEnd(10)}${tag(colors.light)} ${lightColor} ${fmt(light)}:1     ${tag(colors.dark)} ${darkColor} ${fmt(dark)}:1  ${ok ? "✓" : "✗"}`
    );
  }
}

console.log(failures === 0 ? "\nOK — todos los casos ≥ 3:1." : `\n✗ ${failures} caso(s) por debajo de 3:1.`);
process.exit(failures === 0 ? 0 : 1);
