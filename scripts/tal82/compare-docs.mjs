// TAL-82 — compara los documentos COMPLETOS (todos los campos, `_id` y `_creationTime`
// incluidos, JSON canonizado con claves ordenadas) de las tablas indicadas entre un ZIP de
// export y el deployment vivo (plan §5.4 / §4.1). Sale con 1 si hay cualquier diferencia.
// Uso: node scripts/tal82/compare-docs.mjs <zip> <slug> <tabla>…
// Solo imprime recuentos e ids discrepantes, nunca el contenido de los documentos.
import { execFileSync } from "node:child_process";
const [zip, slug, ...tables] = process.argv.slice(2);
if (!zip || !slug || tables.length === 0) throw new Error("uso: compare-docs.mjs <zip> <slug> <tabla>…");
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const parse = (text) => text.split("\n").filter((l) => l.trim().startsWith("{")).map((l) => JSON.parse(l));
const key = (docs) => new Map(docs.map((d) => [d._id, JSON.stringify(canon(d))]));
let ok = true;
for (const t of tables) {
  let fromZip = [];
  try { fromZip = parse(execFileSync("unzip", ["-p", zip, `${t}/documents.jsonl`], { encoding: "utf8", maxBuffer: 1 << 28 })); } catch { fromZip = []; }
  const live = parse(execFileSync("npx", ["convex", "data", t, "--limit", "10000", "--format", "jsonl", "--deployment", slug], { encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] }));
  if (live.length >= 10000) throw new Error(`${t}: lectura en el tope`);
  const a = key(fromZip), b = key(live);
  const missing = [...a.keys()].filter((id) => !b.has(id));
  const extra = [...b.keys()].filter((id) => !a.has(id));
  const changed = [...a.keys()].filter((id) => b.has(id) && a.get(id) !== b.get(id));
  const same = missing.length === 0 && extra.length === 0 && changed.length === 0;
  ok &&= same;
  console.log(`${t}: zip=${a.size} vivo=${b.size} faltan=${missing.length} sobran=${extra.length} distintos=${changed.length} → ${same ? "IGUALES (documentos completos)" : "DIFERENCIAS"}`);
  for (const id of [...missing, ...extra, ...changed].slice(0, 10)) console.log(`  id discrepante: ${id}`);
}
process.exit(ok ? 0 : 1);
