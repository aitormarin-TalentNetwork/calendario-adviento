import { createHash } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";

/**
 * TAL-79 — Plus Jakarta Sans autoalojada con next/font/local. Comprueba sobre
 * las RESPUESTAS REALES del servidor (sirve igual contra `next dev` que
 * contra `next build && next start` en E2E_PORT):
 *
 * 1. El CSS FINAL que carga cada respuesta (no el texto de globals.css):
 *    - exactamente 20 `@font-face` de "Plus Jakarta Sans" = 4 subsets × 5
 *      pesos (400–800), `font-style: normal`, `font-display: swap` y el
 *      `unicode-range` literal de Google para cada subset;
 *    - cada `src` sirve EXACTAMENTE los bytes del subset que dice su
 *      `unicode-range` (sha256 de src/app/fonts/plus-jakarta-sans/README.md);
 *    - una sola `@font-face` "Plus Jakarta Sans Fallback", con `local(Arial)`
 *      y las métricas literales que generaba next/font/google;
 *    - `--font-jakarta: "Plus Jakarta Sans", "Plus Jakarta Sans Fallback"`.
 * 2. Precarga (HTML y cabeceras `Link`): exactamente 2 URLs de fuente
 *    distintas (latin y latin-ext) en /login; nunca vietnamese ni
 *    cyrillic-ext. En el 404 de Next, NINGUNA: es lo que hace Next con
 *    next/font/google en main (63fd268), medido con curl en `next dev` y en
 *    `next start` (export de TAL-79); no depende de la fuente.
 * 3. Peticiones reales del navegador: cada subset se pide al pintar un
 *    carácter que SOLO pertenece a su `unicode-range` (vietnamese y
 *    cyrillic-ext no se piden antes).
 *
 * Rutas: una normal (/login) y una inexistente (404 de Next). La app no tiene
 * error.tsx, global-error, not-found.tsx propio ni layouts anidados: no hay
 * más plantillas que cubrir.
 */

const SUBSETS = {
  "cyrillic-ext": {
    sha256: "a16f29d7d2a21a4f9b3249a82eb2725ed5bdb91500dfb5c4758977de27477f20",
    unicodeRange: "U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F",
    // Ѡ (U+0460): solo en el rango de cyrillic-ext.
    probe: "Ѡ",
    preload: false,
  },
  vietnamese: {
    sha256: "5c913fc1b1f86f4b475e5df45a796aa480d1f7f0891ed6f1a5991d6d1be887c3",
    unicodeRange:
      "U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB",
    // ạ (U+1EA1): solo en el rango de vietnamese.
    probe: "ạ",
    preload: false,
  },
  "latin-ext": {
    sha256: "0303e02b53b0298fb26a0193941a2e8754f0f9a9fce50d90b178d8da3424873f",
    unicodeRange:
      "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF",
    // ł (U+0142): solo en el rango de latin-ext.
    probe: "ł",
    preload: true,
  },
  latin: {
    sha256: "cd8db90cd950e26bc8761f65d323588bd5cd112d326d6d322bc7c8ea86771215",
    unicodeRange:
      "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    // a (U+0061): solo en el rango de latin.
    probe: "a",
    preload: true,
  },
} as const;
type Subset = keyof typeof SUBSETS;
const SUBSET_NAMES = Object.keys(SUBSETS) as Subset[];
const SUBSET_BY_SHA = new Map<string, Subset>(SUBSET_NAMES.map((name) => [SUBSETS[name].sha256, name]));

/**
 * Rango Unicode → lista canónica de pares [inicio, fin]. Los minificadores
 * escriben `U+460` por `U+0460` y `U+??` (comodines) por `U+0000-00FF`.
 */
function parseRanges(value: string): string {
  return value
    .split(",")
    .map((part) => part.trim().replace(/^U\+/i, ""))
    .filter(Boolean)
    .map((part) => {
      if (part.includes("?")) return `${parseInt(part.replace(/\?/g, "0"), 16)}-${parseInt(part.replace(/\?/g, "F"), 16)}`;
      const [a, b = a] = part.split("-");
      return `${parseInt(a, 16)}-${parseInt(b, 16)}`;
    })
    .join(",");
}

function inRanges(codePoint: number, value: string): boolean {
  return parseRanges(value)
    .split(",")
    .some((pair) => {
      const [a, b] = pair.split("-").map(Number);
      return codePoint >= a && codePoint <= b;
    });
}

test("los caracteres de prueba solo pertenecen al unicode-range de su subset", () => {
  for (const name of SUBSET_NAMES) {
    const cp = SUBSETS[name].probe.codePointAt(0)!;
    for (const other of SUBSET_NAMES) {
      expect(inRanges(cp, SUBSETS[other].unicodeRange), `${name} U+${cp.toString(16)} en ${other}`).toBe(other === name);
    }
  }
});

type FontFace = Record<string, string>;

function unquote(value: string): string {
  return value.trim().replace(/^["']|["']$/g, "");
}

/** Bloques `@font-face { … }` del CSS → mapa propiedad → valor. */
function fontFaces(css: string): FontFace[] {
  return [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => {
    const decls: FontFace = {};
    for (const decl of m[1].split(";")) {
      const i = decl.indexOf(":");
      if (i < 0) continue;
      decls[decl.slice(0, i).trim().toLowerCase()] = decl.slice(i + 1).trim();
    }
    return decls;
  });
}

function srcUrl(src: string): string {
  return unquote(/url\(([^)]*)\)/.exec(src)![1]);
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

async function fetchText(request: APIRequestContext, url: string) {
  const res = await request.get(url);
  return { status: res.status(), headers: res.headers(), body: await res.text() };
}

async function subsetOf(request: APIRequestContext, url: string): Promise<Subset | undefined> {
  const res = await request.get(url);
  expect(res.status(), url).toBe(200);
  return SUBSET_BY_SHA.get(sha256(await res.body()));
}

const ROUTES = [
  { path: "/login", status: 200, preloads: ["latin", "latin-ext"] },
  { path: "/tal79-ruta-que-no-existe", status: 404, preloads: [] },
];

for (const route of ROUTES) {
  test(`CSS final y precarga de la respuesta real: ${route.path} (${route.status})`, async ({ request, baseURL }) => {
    const html = await fetchText(request, route.path);
    expect(html.status).toBe(route.status);

    // --- CSS que carga esta respuesta ---
    const cssUrls = [...html.body.matchAll(/<link[^>]+rel="stylesheet"[^>]*>/g)]
      .map((m) => /href="([^"]+)"/.exec(m[0])?.[1])
      .filter((href): href is string => Boolean(href));
    expect(cssUrls.length, "hojas de estilo en el HTML").toBeGreaterThan(0);
    // Cada `src` es relativo a SU hoja: se resuelve contra ella.
    let css = "";
    const faces: (FontFace & { __base: string })[] = [];
    for (const href of cssUrls) {
      const sheetUrl = new URL(href, baseURL).toString();
      const sheet = (await fetchText(request, sheetUrl)).body;
      css += sheet + "\n";
      for (const face of fontFaces(sheet)) faces.push({ ...face, __base: sheetUrl });
    }

    const jakarta = faces.filter((f) => unquote(f["font-family"] ?? "") === "Plus Jakarta Sans");
    expect(jakarta, "@font-face de Plus Jakarta Sans").toHaveLength(20);

    const bySubset = new Map<Subset, string[]>();
    for (const face of jakarta) {
      const url = new URL(srcUrl(face.src), face.__base).toString();
      expect(face.src, "formato").toMatch(/format\(["']?woff2["']?\)/);
      const subset = await subsetOf(request, url);
      expect(subset, `bytes de ${url} = un subset conocido`).toBeTruthy();
      expect(parseRanges(face["unicode-range"]), `unicode-range de ${subset}`).toBe(parseRanges(SUBSETS[subset!].unicodeRange));
      expect(face["font-style"]).toBe("normal");
      expect(face["font-display"]).toBe("swap");
      bySubset.set(subset!, [...(bySubset.get(subset!) ?? []), face["font-weight"]]);
    }
    for (const name of SUBSET_NAMES) {
      expect((bySubset.get(name) ?? []).sort(), `pesos de ${name}`).toEqual(["400", "500", "600", "700", "800"]);
    }

    // --- Respaldo: una sola regla, valores literales de next/font/google ---
    const fallback = faces.filter((f) => unquote(f["font-family"] ?? "") === "Plus Jakarta Sans Fallback");
    expect(fallback, "@font-face del respaldo (sin duplicados)").toHaveLength(1);
    expect(fallback[0].src.replace(/["'\s]/g, "")).toBe("local(Arial)");
    expect(parseFloat(fallback[0]["ascent-override"])).toBe(98.88);
    expect(parseFloat(fallback[0]["descent-override"])).toBe(21.15);
    expect(parseFloat(fallback[0]["line-gap-override"])).toBe(0);
    expect(parseFloat(fallback[0]["size-adjust"])).toBe(104.98);
    for (const prop of ["ascent-override", "descent-override", "line-gap-override", "size-adjust"]) {
      expect(fallback[0][prop], prop).toMatch(/%$/);
    }

    // --- Variable que usa --font ---
    const vars = [...css.matchAll(/--font-jakarta\s*:\s*([^;}]+)/g)].map((m) => m[1].replace(/\s+/g, " ").trim());
    expect(vars, "--font-jakarta").toEqual(['"Plus Jakarta Sans", "Plus Jakarta Sans Fallback"']);

    // --- Precarga: HTML y cabeceras Link ---
    const htmlPreloads = [...html.body.matchAll(/<link[^>]+rel="preload"[^>]*>/g)]
      .map((m) => m[0])
      .filter((tag) => /as="font"/.test(tag))
      .map((tag) => new URL(/href="([^"]+)"/.exec(tag)![1], baseURL).toString());
    const linkHeader = html.headers["link"] ?? "";
    const headerPreloads = [...linkHeader.matchAll(/<([^>]+)>;[^,]*rel=preload[^,]*as="?font/g)].map((m) => new URL(m[1], baseURL).toString());
    const preloads = [...new Set([...htmlPreloads, ...headerPreloads])];
    console.log(`${route.path}: preload HTML=${JSON.stringify(htmlPreloads)} Link=${JSON.stringify(headerPreloads)}`);
    expect(preloads, "URLs de fuente precargadas distintas").toHaveLength(route.preloads.length);
    const preloaded = new Set<Subset>();
    for (const url of preloads) preloaded.add((await subsetOf(request, url))!);
    expect([...preloaded].sort()).toEqual(route.preloads);
  });
}

test("peticiones reales: cada subset se pide al pintar un carácter de su unicode-range", async ({ page }) => {
  const requested = new Map<string, Subset | undefined>();
  page.on("response", async (res) => {
    if (!/\.woff2(\?|$)/.test(res.url())) return;
    try {
      requested.set(res.url(), SUBSET_BY_SHA.get(sha256(await res.body())));
    } catch {
      requested.set(res.url(), undefined);
    }
  });
  const loadedSubsets = () => new Set([...requested.values()].filter(Boolean));

  await page.goto("/login");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState("networkidle");
  const before = loadedSubsets();
  console.log(`antes de pintar: ${JSON.stringify([...before].sort())}`);
  expect(before.has("vietnamese"), "vietnamese no se pide sin un carácter suyo").toBe(false);
  expect(before.has("cyrillic-ext"), "cyrillic-ext no se pide sin un carácter suyo").toBe(false);

  for (const name of SUBSET_NAMES) {
    const probe = SUBSETS[name].probe;
    await page.evaluate(async (text) => {
      const span = document.createElement("span");
      span.textContent = text;
      span.style.fontFamily = "var(--font)";
      document.body.append(span);
      await document.fonts.load('400 16px "Plus Jakarta Sans"', text);
      await document.fonts.ready;
    }, probe);
    await page.waitForLoadState("networkidle");
    await expect.poll(() => loadedSubsets().has(name), { message: `se pidió ${name} al pintar U+${probe.codePointAt(0)!.toString(16)}` }).toBe(true);
  }

  // Las caras del navegador: las 4 (por unicode-range) cargadas.
  const statuses = await page.evaluate(() =>
    [...document.fonts]
      .filter((f) => f.family.replace(/["']/g, "") === "Plus Jakarta Sans" && f.weight === "400")
      .map((f) => ({ range: f.unicodeRange, status: f.status }))
  );
  console.log(`caras 400: ${JSON.stringify(statuses)}`);
  expect(statuses).toHaveLength(4);
  for (const face of statuses) expect(face.status, face.range).toBe("loaded");
});
