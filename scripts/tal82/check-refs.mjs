// TAL-82 — referencias tras restaurar o limpiar (plan §5.4): todo `calendars.skinId` y todo
// `skinStyles.skinId` existen en `skins`. Solo lectura; imprime recuentos.
// Uso: node scripts/tal82/check-refs.mjs <slug>
import { execFileSync } from "node:child_process";
const slug = process.argv[2];
if (!slug) throw new Error("uso: check-refs.mjs <slug>");
const read = (t) => {
  const docs = execFileSync("npx", ["convex", "data", t, "--limit", "10000", "--format", "jsonl", "--deployment", slug], { encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] })
    .split("\n").filter((l) => l.trim().startsWith("{")).map((l) => JSON.parse(l));
  if (docs.length >= 10000) throw new Error(`${t}: lectura en el tope`);
  return docs;
};
const skins = new Set(read("skins").map((s) => s._id));
const cals = read("calendars"), styles = read("skinStyles");
const badCals = cals.filter((c) => !skins.has(c.skinId)).length;
const badStyles = styles.filter((s) => !skins.has(s.skinId)).length;
console.log(`skins=${skins.size} calendars=${cals.length} (skinId inexistente: ${badCals}) skinStyles=${styles.length} (skinId inexistente: ${badStyles})`);
process.exit(badCals === 0 && badStyles === 0 ? 0 : 1);
