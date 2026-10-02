import { expect, test } from "@playwright/test";
import type { LookupAddress } from "node:dns";
import { createImageCheckService, runImageCheck } from "../src/lib/image-check-service";
import { realImageChecker, selectImageChecker, stubImageChecker } from "../src/lib/image-checker";
import { checkImageUrl, classify, isAllowedAddress, type HttpHead, type HttpRequestFn } from "../src/lib/image-url-check";

/**
 * TAL-69 — tests SIN RED del comprobador de URLs de imagen: lista de
 * permitidos (una representación por caso), SSRF con IP literales, DNS y
 * redirecciones, cancelación real, clasificación, frontera del stub y
 * límites de abuso (caché, deduplicación, enfriamiento).
 */

const PUBLIC: LookupAddress[] = [{ address: "93.184.216.34", family: 4 }];
const resolveTo = (map: Record<string, LookupAddress[]>) => async (host: string) => map[host] ?? PUBLIC;

/** `request` simulado: registra cada apertura, su método/cabeceras y si acabó destruida (abort). */
function fakeRequest(respond: (url: URL, method: string, n: number) => HttpHead | Promise<HttpHead>, opts: { callLookup?: boolean } = {}) {
  const opened: { url: string; method: string; headers: Record<string, string>; destroyed: boolean }[] = [];
  const request: HttpRequestFn = async ({ url, method, headers, signal, lookup }) => {
    const entry = { url: url.toString(), method, headers, destroyed: false };
    opened.push(entry);
    signal.addEventListener("abort", () => (entry.destroyed = true), { once: true });
    if (opts.callLookup) {
      await new Promise<void>((resolve, reject) =>
        lookup(url.hostname, {}, (err) => (err ? reject(err) : resolve()))
      );
    }
    return await new Promise<HttpHead>((resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      Promise.resolve(respond(url, method, opened.length)).then(resolve, reject);
    });
  };
  return { request, opened };
}

const img: HttpHead = { status: 200, contentType: "image/jpeg", location: null };
const html: HttpHead = { status: 200, contentType: "text/html; charset=utf-8", location: null };
const redirect = (location: string): HttpHead => ({ status: 302, contentType: null, location });

test.describe("isAllowedAddress — lista de permitidos", () => {
  const blocked = [
    // IPv4 de uso especial
    "0.0.0.0", "10.0.0.1", "100.64.0.1", "127.0.0.1", "169.254.169.254", "172.16.0.1", "172.31.255.255",
    "192.0.0.1", "192.0.2.1", "192.88.99.1", "192.168.1.1", "198.18.0.1", "198.51.100.1", "203.0.113.1",
    "224.0.0.1", "240.0.0.1", "255.255.255.255",
    // IPv6 fuera de 2000::/3 o en rangos especiales enteros
    "::", "::1", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1",
    "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:8.8.8.8", "::127.0.0.1",
    "64:ff9b::7f00:1", "64:ff9b::808:808", "64:ff9b:1::1", "100::1",
    "2002:7f00:1::1", "2002:808:808::1", "2001:0:4136:e378::1", "2001:2::1", "2001:1ff::1",
    "2001:db8::1", "3fff::1",
    // no son IP
    "localhost", "", "999.1.1.1",
  ];
  for (const ip of blocked) {
    test(`bloqueada: ${ip || "(vacía)"}`, () => expect(isAllowedAddress(ip)).toBe(false));
  }
  for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "223.255.255.254", "2606:4700::1111", "2a00:1450:4001::200e", "2001:200::1"]) {
    test(`permitida: ${ip}`, () => expect(isAllowedAddress(ip)).toBe(true));
  }
});

test.describe("SSRF — IP literal en la URL: ninguna petición", () => {
  const urls = [
    "https://127.0.0.1/a.jpg", "https://2130706433/a.jpg", "https://0177.0.0.1/a.jpg", "https://0x7f.1/a.jpg",
    "https://127.1/a.jpg", "https://169.254.169.254/latest/meta-data", "https://[::1]/a.jpg",
    "https://[0:0:0:0:0:0:0:1]/a.jpg", "https://[::ffff:127.0.0.1]/a.jpg", "https://[64:ff9b::7f00:1]/a.jpg",
    "https://[2002:7f00:1::1]/a.jpg", "https://[2001:db8::1]/a.jpg",
  ];
  for (const url of urls) {
    test(url, async () => {
      const { request, opened } = fakeRequest(() => img);
      expect(await checkImageUrl(url, { request, resolveAll: resolveTo({}) })).toBe("unknown");
      expect(opened).toHaveLength(0);
    });
  }
});

test.describe("SSRF — esquema, puerto, credenciales y DNS", () => {
  for (const url of ["http://example.com/a.jpg", "https://example.com:8443/a.jpg", "https://user:pw@example.com/a.jpg", "ftp://example.com/a.jpg", "no es una url"]) {
    test(`no se pide: ${url}`, async () => {
      const { request, opened } = fakeRequest(() => img);
      expect(await checkImageUrl(url, { request, resolveAll: resolveTo({}) })).toBe("unknown");
      expect(opened).toHaveLength(0);
    });
  }
  test("host que resuelve a privada → bloqueado sin petición", async () => {
    const { request, opened } = fakeRequest(() => img);
    const resolveAll = resolveTo({ "intranet.example": [{ address: "10.1.2.3", family: 4 }] });
    expect(await checkImageUrl("https://intranet.example/a.jpg", { request, resolveAll })).toBe("unknown");
    expect(opened).toHaveLength(0);
  });
  test("varias direcciones con UNA privada → bloqueado", async () => {
    const { request, opened } = fakeRequest(() => img);
    const resolveAll = resolveTo({ "mixed.example": [{ address: "8.8.8.8", family: 4 }, { address: "::1", family: 6 }] });
    expect(await checkImageUrl("https://mixed.example/a.jpg", { request, resolveAll })).toBe("unknown");
    expect(opened).toHaveLength(0);
  });
  test("DNS rebinding: pública al validar, privada al conectar → el lookup del socket lo bloquea", async () => {
    let calls = 0;
    const resolveAll = async () => (++calls === 1 ? PUBLIC : [{ address: "127.0.0.1", family: 4 } as LookupAddress]);
    const { request } = fakeRequest(() => img, { callLookup: true });
    expect(await checkImageUrl("https://rebind.example/a.jpg", { request, resolveAll })).toBe("unknown");
    expect(calls).toBe(2);
  });
  test("real (sin simular DNS): https://localhost/ se bloquea antes de conectar", async () => {
    const { request, opened } = fakeRequest(() => img);
    expect(await checkImageUrl("https://localhost/a.jpg", { request })).toBe("unknown");
    expect(opened).toHaveLength(0);
  });
});

test.describe("SSRF — redirecciones", () => {
  const cases: [string, string][] = [
    ["a IP privada", "https://10.0.0.5/a.jpg"],
    ["a metadata", "https://169.254.169.254/latest/meta-data"],
    ["a host privado", "https://intranet.example/a.jpg"],
    ["a http:", "http://example.com/a.jpg"],
    ["a otro puerto", "https://example.com:8443/a.jpg"],
  ];
  for (const [label, location] of cases) {
    test(`${label} → unknown sin seguirla`, async () => {
      const { request, opened } = fakeRequest(() => redirect(location));
      const resolveAll = resolveTo({ "intranet.example": [{ address: "192.168.0.10", family: 4 }] });
      expect(await checkImageUrl("https://example.com/start", { request, resolveAll })).toBe("unknown");
      expect(opened).toHaveLength(1);
    });
  }
  test("relativa y permitida → se sigue y se revalida", async () => {
    const { request, opened } = fakeRequest((url) => (url.pathname === "/start" ? redirect("/final.jpg") : img));
    expect(await checkImageUrl("https://example.com/start", { request, resolveAll: resolveTo({}) })).toBe("image");
    expect(opened.map((o) => o.url)).toEqual(["https://example.com/start", "https://example.com/final.jpg"]);
  });
  test("más de 3 redirecciones → unknown (inicial + 3 saltos, ninguno más)", async () => {
    const { request, opened } = fakeRequest((_url, _m, n) => redirect(`/r${n}`));
    expect(await checkImageUrl("https://example.com/r0", { request, resolveAll: resolveTo({}) })).toBe("unknown");
    expect(opened).toHaveLength(4);
  });
});

test.describe("clasificación", () => {
  test("image/* → image; HTML → page; el resto → unknown", () => {
    expect(classify(img)).toBe("image");
    expect(classify({ status: 206, contentType: "image/webp", location: null })).toBe("image");
    expect(classify(html)).toBe("page");
    expect(classify({ status: 200, contentType: "application/xhtml+xml", location: null })).toBe("page");
    expect(classify({ status: 200, contentType: "application/octet-stream", location: null })).toBe("unknown");
    expect(classify({ status: 404, contentType: "text/html", location: null })).toBe("unknown");
    expect(classify({ status: 200, contentType: null, location: null })).toBe("unknown");
  });
  test("error de red → unknown", async () => {
    const { request } = fakeRequest(() => Promise.reject(new Error("ECONNRESET")));
    expect(await checkImageUrl("https://example.com/a.jpg", { request, resolveAll: resolveTo({}) })).toBe("unknown");
  });
  test("HEAD 405 → GET con Range: bytes=0-0", async () => {
    const { request, opened } = fakeRequest((_url, method) => (method === "HEAD" ? { status: 405, contentType: null, location: null } : { status: 206, contentType: "image/png", location: null }));
    expect(await checkImageUrl("https://example.com/a.png", { request, resolveAll: resolveTo({}) })).toBe("image");
    expect(opened.map((o) => o.method)).toEqual(["HEAD", "GET"]);
    expect(opened[1].headers.range).toBe("bytes=0-0");
  });
});

test.describe("cancelación real — plazo global compartido", () => {
  test("una redirección que llega tras el plazo: la petición activa se destruye y no se abre ninguna nueva", async () => {
    const { request, opened } = fakeRequest(() => new Promise((resolve) => setTimeout(() => resolve(redirect("/next.jpg")), 300)));
    const started = Date.now();
    expect(await checkImageUrl("https://example.com/slow", { request, resolveAll: resolveTo({}), totalTimeoutMs: 100 })).toBe("unknown");
    expect(Date.now() - started).toBeLessThan(250);
    await new Promise((r) => setTimeout(r, 400)); // la respuesta tardía ya habría llegado
    expect(opened).toHaveLength(1);
    expect(opened[0].destroyed).toBe(true);
  });
  test("un DNS lento que termina tras el plazo: ninguna petición", async () => {
    const { request, opened } = fakeRequest(() => img);
    const resolveAll = () => new Promise<LookupAddress[]>((resolve) => setTimeout(() => resolve(PUBLIC), 300));
    expect(await checkImageUrl("https://slow-dns.example/a.jpg", { request, resolveAll, totalTimeoutMs: 100 })).toBe("unknown");
    await new Promise((r) => setTimeout(r, 400));
    expect(opened).toHaveLength(0);
  });
});

test.describe("frontera del stub", () => {
  test("producción ignora la variable aunque esté definida", () => {
    expect(selectImageChecker({ NODE_ENV: "production", E2E_IMAGE_CHECK_STUB: "1" })).toBe(realImageChecker);
  });
  test("sin la variable → real; con la variable fuera de producción → stub", () => {
    expect(selectImageChecker({ NODE_ENV: "development" })).toBe(realImageChecker);
    expect(selectImageChecker({ NODE_ENV: "test", E2E_IMAGE_CHECK_STUB: "0" })).toBe(realImageChecker);
    expect(selectImageChecker({ NODE_ENV: "development", E2E_IMAGE_CHECK_STUB: "1" })).toBe(stubImageChecker);
  });
});

test.describe("abuso — caché, deduplicación, enfriamiento", () => {
  function setup() {
    let clock = 0;
    const calls: string[] = [];
    let result: "image" | "page" | "unknown" = "page";
    const checker = async (url: string) => {
      calls.push(url);
      await new Promise((r) => setTimeout(r, 20));
      return result;
    };
    const service = createImageCheckService({ checker, now: () => clock });
    return { service, calls, advance: (ms: number) => (clock += ms), setResult: (r: typeof result) => (result = r) };
  }
  const URL_A = "https://example.com/a.jpg";

  test("N llamadas repetidas del mismo calendario → 1 petición por URL", async () => {
    const { service, calls, advance } = setup();
    for (let i = 0; i < 5; i++) {
      expect(await service.checkCalendar("cal1", { coverImageUrl: URL_A })).toEqual({ coverImageUrl: "page" });
      advance(11_000); // fuera del enfriamiento: se sirve de la caché
    }
    expect(calls).toEqual([URL_A]);
  });
  test("N llamadas concurrentes (calendarios distintos, misma URL) → 1 petición", async () => {
    const { service, calls } = setup();
    const results = await Promise.all(["c1", "c2", "c3", "c4", "c5"].map((c) => service.checkCalendar(c, { backgroundImageUrl: URL_A })));
    expect(results.every((r) => r.backgroundImageUrl === "page")).toBe(true);
    expect(calls).toEqual([URL_A]);
  });
  test("dentro del enfriamiento: 0 peticiones nuevas (caché o sin aviso)", async () => {
    const { service, calls } = setup();
    await service.checkCalendar("cal1", { coverImageUrl: URL_A });
    expect(await service.checkCalendar("cal1", { coverImageUrl: URL_A, backgroundImageUrl: "https://example.com/b.jpg" })).toEqual({ coverImageUrl: "page", backgroundImageUrl: "unknown" });
    expect(calls).toEqual([URL_A]);
  });
  test("vencido el TTL de 10 min → se vuelve a comprobar; un unknown no se fija", async () => {
    const { service, calls, advance, setResult } = setup();
    await service.checkCalendar("cal1", { coverImageUrl: URL_A });
    advance(10 * 60_000 + 1);
    await service.checkCalendar("cal1", { coverImageUrl: URL_A });
    expect(calls).toHaveLength(2);
    setResult("unknown");
    advance(10 * 60_000 + 1);
    await service.checkCalendar("cal1", { coverImageUrl: URL_A });
    advance(11_000);
    await service.checkCalendar("cal1", { coverImageUrl: URL_A });
    expect(calls).toHaveLength(4);
  });
  test("un no-Admin nunca llega al comprobador (spy)", async () => {
    const checkCalendar: unknown[] = []; // spy del comprobador
    let loaded = false;
    const warnings = await runImageCheck({
      calendarId: "cal1",
      isAdmin: async () => false,
      loadSavedUrls: async () => {
        loaded = true;
        return { coverImageUrl: URL_A };
      },
      service: { checkCalendar: async (...args) => (checkCalendar.push(args), {}) },
    });
    expect(warnings).toEqual({});
    expect(checkCalendar).toHaveLength(0);
    expect(loaded).toBe(false);
  });
  test("Admin con portada que es página → aviso solo en ese campo", async () => {
    const { service } = setup();
    const warnings = await runImageCheck({ calendarId: "cal9", isAdmin: async () => true, loadSavedUrls: async () => ({ coverImageUrl: URL_A, backgroundImageUrl: null }), service });
    expect(warnings).toEqual({ coverImageUrl: true });
  });
});
