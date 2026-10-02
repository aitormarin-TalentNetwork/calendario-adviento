import { expect, test } from "@playwright/test";
import {
  detectImageType,
  fetchProviderThumbnail,
  guardedFetch,
  thumbnailSourceForVideo,
  type FetchImpl,
} from "../convex/dayFileGuards";

/**
 * TAL-67 — guardas anti-SSRF y de contenido, SIN red: `fetch` inyectado.
 * Cubre el análisis de SSRF del plan (lista cerrada de hosts y saltos,
 * https, timeout, abort a mitad del streaming, tope de bytes sin
 * `Content-Length`, tipo + bytes mágicos, host del `thumbnail_url` de oEmbed).
 */

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
const HTML = new TextEncoder().encode("<!doctype html><html>login</html>");

type Route = { status: number; headers?: Record<string, string>; body?: BodyInit | null };

/** `fetch` falso por URL exacta; registra las URLs pedidas. */
function fakeFetch(routes: Record<string, Route>): FetchImpl & { calls: string[] } {
  const calls: string[] = [];
  const impl = (async (input: string) => {
    calls.push(input);
    const route = routes[input];
    if (!route) throw new Error(`URL no esperada: ${input}`);
    return new Response(route.body ?? null, { status: route.status, headers: route.headers });
  }) as FetchImpl & { calls: string[] };
  impl.calls = calls;
  return impl;
}

const opts = (extra: Partial<Parameters<typeof guardedFetch>[2]> = {}) => ({
  allowedRedirectHosts: [] as string[],
  maxRedirects: 0,
  maxBytes: 1024,
  expect: "image" as const,
  deadline: Date.now() + 5_000,
  ...extra,
});

test.describe("detectImageType (bytes mágicos)", () => {
  test("JPEG, PNG y WebP reales", () => {
    expect(detectImageType(JPEG)).toBe("image/jpeg");
    expect(detectImageType(PNG)).toBe("image/png");
    expect(detectImageType(WEBP)).toBe("image/webp");
  });
  test("HTML, GIF y texto → null", () => {
    expect(detectImageType(HTML)).toBeNull();
    expect(detectImageType(new TextEncoder().encode("GIF89a\x01\x00"))).toBeNull();
    expect(detectImageType(new TextEncoder().encode("hola"))).toBeNull();
  });
});

test.describe("thumbnailSourceForVideo (id validado, nunca la URL del Admin)", () => {
  test("YouTube, Vimeo y Drive", () => {
    expect(thumbnailSourceForVideo("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toEqual({ provider: "youtube", id: "dQw4w9WgXcQ" });
    expect(thumbnailSourceForVideo("https://vimeo.com/1084537")).toEqual({ provider: "vimeo", id: "1084537" });
    expect(
      thumbnailSourceForVideo("https://drive.google.com/file/d/1Cp4lqVEdadmvOxUvpqR96KfOAeqcTFD4/view?usp=sharing")
    ).toEqual({ provider: "drive", id: "1Cp4lqVEdadmvOxUvpqR96KfOAeqcTFD4" });
  });
  test("no incrustable o host ajeno → null", () => {
    expect(thumbnailSourceForVideo("https://example.com/video.mp4")).toBeNull();
    expect(thumbnailSourceForVideo("https://evil.example/watch?v=dQw4w9WgXcQ")).toBeNull();
  });
});

test.describe("guardedFetch", () => {
  test("Drive: un salto exacto a lh3.googleusercontent.com → se sigue", async () => {
    const f = fakeFetch({
      "https://drive.google.com/thumbnail?id=ABCDEFGHIJ&sz=w640": { status: 302, headers: { location: "https://lh3.googleusercontent.com/x" } },
      "https://lh3.googleusercontent.com/x": { status: 200, headers: { "content-type": "image/jpeg" }, body: JPEG },
    });
    const r = await guardedFetch(f, "https://drive.google.com/thumbnail?id=ABCDEFGHIJ&sz=w640", opts({ allowedRedirectHosts: ["lh3.googleusercontent.com"], maxRedirects: 1 }));
    expect(r).toMatchObject({ ok: true, contentType: "image/jpeg", finalHost: "lh3.googleusercontent.com" });
  });

  for (const [label, location, reason] of [
    ["lh4.googleusercontent.com", "https://lh4.googleusercontent.com/x", "redirect-host-not-allowed"],
    ["host que imita el nombre", "https://evil.googleusercontent.com.example/x", "redirect-host-not-allowed"],
    ["accounts.google.com (Drive privado)", "https://accounts.google.com/login", "redirect-host-not-allowed"],
    ["http:// a lh3", "http://lh3.googleusercontent.com/x", "redirect-not-https"],
    ["location relativo", "/x", "bad-redirect"],
  ] as const) {
    test(`Drive: salto a ${label} → failed`, async () => {
      const f = fakeFetch({ "https://drive.google.com/t": { status: 302, headers: { location } } });
      const r = await guardedFetch(f, "https://drive.google.com/t", opts({ allowedRedirectHosts: ["lh3.googleusercontent.com"], maxRedirects: 1 }));
      expect(r).toEqual({ ok: false, reason });
      expect(f.calls).toEqual(["https://drive.google.com/t"]);
    });
  }

  test("Drive: un segundo salto (aunque sea al host permitido) → failed", async () => {
    const f = fakeFetch({
      "https://drive.google.com/t": { status: 302, headers: { location: "https://lh3.googleusercontent.com/a" } },
      "https://lh3.googleusercontent.com/a": { status: 302, headers: { location: "https://lh3.googleusercontent.com/b" } },
    });
    const r = await guardedFetch(f, "https://drive.google.com/t", opts({ allowedRedirectHosts: ["lh3.googleusercontent.com"], maxRedirects: 1 }));
    expect(r).toEqual({ ok: false, reason: "too-many-redirects" });
  });

  test("YouTube / Vimeo: cualquier 3xx → failed (cero saltos)", async () => {
    const f = fakeFetch({ "https://img.youtube.com/vi/x/hqdefault.jpg": { status: 301, headers: { location: "https://i.ytimg.com/vi/x/hqdefault.jpg" } } });
    expect(await guardedFetch(f, "https://img.youtube.com/vi/x/hqdefault.jpg", opts())).toEqual({ ok: false, reason: "too-many-redirects" });
  });

  test("HTML servido con Content-Type de imagen → failed (bytes mágicos)", async () => {
    const f = fakeFetch({ "https://img.youtube.com/a": { status: 200, headers: { "content-type": "image/jpeg" }, body: HTML } });
    expect(await guardedFetch(f, "https://img.youtube.com/a", opts())).toEqual({ ok: false, reason: "magic-mismatch" });
  });

  test("Content-Type que no es imagen → failed sin leer el cuerpo", async () => {
    const f = fakeFetch({ "https://img.youtube.com/a": { status: 200, headers: { "content-type": "text/html" }, body: HTML } });
    expect(await guardedFetch(f, "https://img.youtube.com/a", opts())).toEqual({ ok: false, reason: "not-image" });
  });

  test("URL de partida http:// → failed", async () => {
    const f = fakeFetch({});
    expect(await guardedFetch(f, "http://img.youtube.com/a", opts())).toEqual({ ok: false, reason: "not-https" });
    expect(f.calls).toEqual([]);
  });

  test("cuerpo infinito SIN Content-Length → abortado al pasar el tope", async () => {
    let pulls = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(pulls === 1 ? JPEG : new Uint8Array(512));
      },
    });
    const f = fakeFetch({ "https://img.youtube.com/a": { status: 200, headers: { "content-type": "image/jpeg" }, body: endless } });
    const r = await guardedFetch(f, "https://img.youtube.com/a", opts({ maxBytes: 2048 }));
    expect(r).toEqual({ ok: false, reason: "too-large" });
    expect(pulls).toBeLessThan(10);
  });

  test("abort a mitad del streaming de un cuerpo lento → failed por timeout, reader cancelado", async () => {
    let cancelled = false;
    let chunks = 0;
    const slow = new ReadableStream<Uint8Array>({
      async pull(controller) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        chunks += 1;
        controller.enqueue(chunks === 1 ? JPEG : new Uint8Array(8));
      },
      cancel() {
        cancelled = true;
      },
    });
    const f = fakeFetch({ "https://img.youtube.com/a": { status: 200, headers: { "content-type": "image/jpeg" }, body: slow } });
    const started = Date.now();
    const r = await guardedFetch(f, "https://img.youtube.com/a", opts({ deadline: Date.now() + 1_200, maxBytes: 1_000_000 }));
    expect(r).toEqual({ ok: false, reason: "timeout" });
    expect(Date.now() - started).toBeLessThan(2_500);
    expect(cancelled).toBe(true);
    expect(chunks).toBeLessThan(5);
  });
});

test.describe("fetchProviderThumbnail", () => {
  test("Vimeo: thumbnail_url con host ajeno → failed sin pedirlo", async () => {
    const f = fakeFetch({
      "https://vimeo.com/api/oembed.json?url=https%3A%2F%2Fvimeo.com%2F1084537": {
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ thumbnail_url: "https://evil.example/thumb.jpg" }),
      },
    });
    expect(await fetchProviderThumbnail(f, { provider: "vimeo", id: "1084537" })).toEqual({ ok: false, reason: "thumbnail-host-not-allowed" });
    expect(f.calls).toHaveLength(1);
  });

  test("Vimeo: thumbnail_url http:// en i.vimeocdn.com → failed", async () => {
    const f = fakeFetch({
      "https://vimeo.com/api/oembed.json?url=https%3A%2F%2Fvimeo.com%2F1": {
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ thumbnail_url: "http://i.vimeocdn.com/video/1.jpg" }),
      },
    });
    expect(await fetchProviderThumbnail(f, { provider: "vimeo", id: "1" })).toEqual({ ok: false, reason: "thumbnail-host-not-allowed" });
  });

  test("Vimeo: oEmbed que no es JSON → failed", async () => {
    const f = fakeFetch({
      "https://vimeo.com/api/oembed.json?url=https%3A%2F%2Fvimeo.com%2F1": { status: 200, headers: { "content-type": "text/html" }, body: HTML },
    });
    expect(await fetchProviderThumbnail(f, { provider: "vimeo", id: "1" })).toEqual({ ok: false, reason: "not-json" });
  });

  test("Vimeo: camino feliz (oEmbed → i.vimeocdn.com)", async () => {
    const f = fakeFetch({
      "https://vimeo.com/api/oembed.json?url=https%3A%2F%2Fvimeo.com%2F1": {
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ thumbnail_url: "https://i.vimeocdn.com/video/1.jpg" }),
      },
      "https://i.vimeocdn.com/video/1.jpg": { status: 200, headers: { "content-type": "image/png" }, body: PNG },
    });
    expect(await fetchProviderThumbnail(f, { provider: "vimeo", id: "1" })).toMatchObject({ ok: true, contentType: "image/png" });
  });

  test("YouTube y Drive construyen la URL con host fijo", async () => {
    const f = fakeFetch({
      "https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg": { status: 200, headers: { "content-type": "image/jpeg" }, body: JPEG },
      "https://drive.google.com/thumbnail?id=ABCDEFGHIJ&sz=w640": { status: 302, headers: { location: "https://lh3.googleusercontent.com/z" } },
      "https://lh3.googleusercontent.com/z": { status: 200, headers: { "content-type": "image/webp" }, body: WEBP },
    });
    expect(await fetchProviderThumbnail(f, { provider: "youtube", id: "dQw4w9WgXcQ" })).toMatchObject({ ok: true });
    expect(await fetchProviderThumbnail(f, { provider: "drive", id: "ABCDEFGHIJ" })).toMatchObject({ ok: true, contentType: "image/webp" });
  });
});
