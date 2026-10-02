// TAL-61 — renombra los tokens CSS semánticos al vocabulario del Design
// System "Estilo 2026" (design/design-system.md § "Estilo 2026 → Color").
// Solo hace los renombrados 1:1; los tokens de paleta cruda que tienen más
// de un destino (--gold → --primary/--primary-ink/--sun, --berry →
// --coral/--coral-ink…) se resuelven a mano, uso por uso.
//
// Pensado para reaplicarse al rebasar otras ramas (TAL-60, TAL-62…) sobre
// TAL-61: es determinista e idempotente. Recorre src/ (.ts, .tsx, .css).
//
//   node scripts/tal61-rename-tokens.mjs          # aplica y lista cambios
//   node scripts/tal61-rename-tokens.mjs --check  # solo informa; exit 1 si queda algo
//
// No toca las DEFINICIONES de globals.css de forma especial: tras aplicarlo
// sobre una rama propia, revisar el bloque :root a mano.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RENAMES = [
  // El orden importa: los nombres largos antes que sus prefijos.
  [/--bg-raised(?![-\w])/g, "--surface"],
  [/--bg-sunken(?![-\w])/g, "--surface-2"],
  [/--text-dim(?![-\w])/g, "--ink-dim"],
  [/--text(?![-\w])/g, "--ink"],
  [/--border(?![-\w])/g, "--line"],
];

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
const check = process.argv.includes("--check");

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(tsx?|css)$/.test(entry)) yield full;
  }
}

let total = 0;
for (const file of walk(root)) {
  const before = readFileSync(file, "utf8");
  let after = before;
  let count = 0;
  for (const [pattern, replacement] of RENAMES) {
    after = after.replace(pattern, () => {
      count++;
      return replacement;
    });
  }
  if (count > 0) {
    total += count;
    console.log(`${check ? "pendiente" : "renombrado"}: ${path.relative(path.dirname(root), file)} (${count})`);
    if (!check) writeFileSync(file, after);
  }
}
console.log(`${check ? "Pendientes" : "Renombrados"}: ${total}`);
if (check && total > 0) process.exit(1);
