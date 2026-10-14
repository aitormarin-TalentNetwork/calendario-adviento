import { execFileSync } from "node:child_process";
import path from "node:path";
import "./env";

/**
 * TAL-82 — CLI de Convex para los specs que llaman a funciones INTERNAS
 * (`npx convex run`) o cambian variables del deployment de dev (mismo patrón
 * que `tal67-files-lifecycle.spec.ts`). Nunca contra producción: cada
 * llamada exige `CONVEX_DEPLOYMENT=dev:` y nunca usa `--prod`.
 */
const ROOT = path.resolve(__dirname, "..", "..");

export function assertDev(): void {
  if (!(process.env.CONVEX_DEPLOYMENT ?? "").startsWith("dev:")) {
    throw new Error(`Solo contra un deployment de dev (CONVEX_DEPLOYMENT=${process.env.CONVEX_DEPLOYMENT}).`);
  }
}

function convexCli(args: string[]): string {
  assertDev();
  if (args.includes("--prod")) throw new Error("Prohibido --prod.");
  return execFileSync("npx", ["convex", ...args], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
}

/** `npx convex run <fn> '<args>'` de una función interna; devuelve el JSON del resultado. */
export function convexRun<T = unknown>(fn: string, args: object = {}): T {
  const text = convexCli(["run", fn, JSON.stringify(args)]).trim();
  return (text === "" ? null : JSON.parse(text)) as T;
}

/** Como `convexRun`, pero devuelve el mensaje de error si la función lanza (y `null` si no lanza). */
export function convexRunError(fn: string, args: object = {}): string | null {
  try {
    convexRun(fn, args);
    return null;
  } catch (error) {
    const e = error as { stderr?: string; message?: string };
    return `${e.stderr ?? ""}${e.message ?? ""}`;
  }
}

export function convexEnvSet(name: string, value: string): void {
  convexCli(["env", "set", name, value]);
}

export function convexEnvRemove(name: string): void {
  try {
    convexCli(["env", "remove", name]);
  } catch {
    // ya no existía
  }
}

/** Tope de `npx convex data --limit` (el CLI rechaza 100001). */
const MAX_TABLE_DOCS = 10000;

/** Documentos completos de una tabla del deployment de dev (`npx convex data … --format jsonl`). */
export function convexTableDocs(table: string): Record<string, unknown>[] {
  const out = convexCli(["data", table, "--limit", String(MAX_TABLE_DOCS), "--format", "jsonl"]);
  const docs = out
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  // Nunca una lectura truncada en silencio: si la tabla llega al tope, no sirve como huella.
  if (docs.length >= MAX_TABLE_DOCS) throw new Error(`La tabla ${table} tiene ${MAX_TABLE_DOCS} o más documentos: la lectura podría estar truncada.`);
  return docs;
}
