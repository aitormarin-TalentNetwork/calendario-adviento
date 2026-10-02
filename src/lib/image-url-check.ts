import { promises as dns, type LookupAddress, type LookupOptions } from "node:dns";
import https from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";

/**
 * TAL-69 — ¿la URL de "Foto de portada" / "Imagen de fondo" es una imagen
 * directa? Petición del SERVIDOR a una URL que escribe el usuario, así que
 * todo va con guardas anti-SSRF (docs/calendarios.md § "TAL-69"):
 *
 * - solo `https:` en el puerto 443, sin credenciales en la URL;
 * - LISTA DE PERMITIDOS de direcciones (`isAllowedAddress`): IPv4 solo
 *   unicast global, IPv6 solo 2000::/3 menos los rangos especiales — con
 *   criterio conservador: un falso negativo solo significa "no se avisa";
 * - la IP literal se comprueba antes de pedir nada; un hostname se resuelve
 *   y se valida ANTES (salida rápida) y otra vez EN LA CONEXIÓN, con el
 *   `lookup` propio que usa el socket (sin ventana de DNS rebinding);
 * - redirecciones manuales (máx. 3), revalidando cada salto;
 * - `HEAD`, y solo si no sirve, `GET` con `Range: bytes=0-0`; en ambos casos
 *   se destruye la respuesta al llegar las cabeceras (no se lee el cuerpo);
 * - UN `AbortController` por comprobación (plazo global) compartido por
 *   DNS, petición, redirecciones y GET de respaldo: al vencer, se aborta,
 *   se destruye el socket y no se abre ningún salto nuevo.
 *
 * Resultado: "image" (2xx + `image/*`), "page" (2xx + HTML) o "unknown"
 * (todo lo demás, incluidos errores) — solo "page" produce aviso.
 */

export type ImageCheckResult = "image" | "page" | "unknown";

// --- Lista de permitidos -------------------------------------------------

// IPv4: solo 1.0.0.0–223.255.255.255 (fuera quedan 0/8, multicast 224/4,
// reservado 240/4 y broadcast) MENOS los rangos de uso especial.
const IPV4_SPECIAL = new BlockList();
for (const [net, prefix] of [
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, incluye la metadata 169.254.169.254
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.31.196.0", 24],
  ["192.52.193.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["192.175.48.0", 24],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
] as const) {
  IPV4_SPECIAL.addSubnet(net, prefix, "ipv4");
}

// IPv6: solo 2000::/3 …
const IPV6_GLOBAL = new BlockList();
IPV6_GLOBAL.addSubnet("2000::", 3, "ipv6");
// … menos estos rangos ENTEROS (las mapeadas ::ffff:0:0/96, las compatibles
// ::/96, ULA fc00::/7, link-local fe80::/10 y multicast ff00::/8 ya quedan
// fuera de 2000::/3; NAT64 y 100::/64 también, se listan por claridad).
const IPV6_SPECIAL = new BlockList();
for (const [net, prefix] of [
  ["2001::", 23], // asignaciones IETF, incluye Teredo 2001::/32
  ["2001:db8::", 32], // documentación
  ["3fff::", 20], // documentación
  ["2002::", 16], // 6to4
  ["64:ff9b::", 96], // NAT64
  ["64:ff9b:1::", 48], // NAT64 local
  ["100::", 64], // descarte
] as const) {
  IPV6_SPECIAL.addSubnet(net, prefix, "ipv6");
}

export function isAllowedAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) {
    const first = Number(ip.split(".")[0]);
    return first >= 1 && first <= 223 && !IPV4_SPECIAL.check(ip, "ipv4");
  }
  if (family === 6) {
    return IPV6_GLOBAL.check(ip, "ipv6") && !IPV6_SPECIAL.check(ip, "ipv6");
  }
  return false;
}

// --- Frontera inyectable ---------------------------------------------------

export type ResolveAllFn = (hostname: string) => Promise<LookupAddress[]>;

export type HttpHead = { status: number; contentType: string | null; location: string | null };

export type HttpRequestFn = (args: {
  url: URL;
  method: "HEAD" | "GET";
  headers: Record<string, string>;
  signal: AbortSignal;
  lookup: LookupFunction;
}) => Promise<HttpHead>;

export type ImageCheckDeps = {
  request?: HttpRequestFn;
  resolveAll?: ResolveAllFn;
  totalTimeoutMs?: number;
  perRequestTimeoutMs?: number;
  maxRedirects?: number;
};

const USER_AGENT = "CalendarioAdviento-ImageCheck/1.0";
export const IMAGE_CHECK_TOTAL_TIMEOUT_MS = 3_000;
const PER_REQUEST_TIMEOUT_MS = 2_500;
const MAX_REDIRECTS = 3;

const realResolveAll: ResolveAllFn = (hostname) => dns.lookup(hostname, { all: true, verbatim: true });

/** Petición real: `https.request` con el `lookup` guardado; destruye la respuesta al llegar las cabeceras. */
export const realHttpRequest: HttpRequestFn = ({ url, method, headers, signal, lookup }) =>
  new Promise((resolve, reject) => {
    const req = https.request(
      {
        protocol: "https:",
        hostname: url.hostname.replace(/^\[|\]$/g, ""),
        port: 443,
        path: `${url.pathname}${url.search}`,
        method,
        headers,
        signal,
        lookup,
        agent: false,
      },
      (res) => {
        const contentType = res.headers["content-type"];
        const location = res.headers.location;
        const head: HttpHead = {
          status: res.statusCode ?? 0,
          contentType: typeof contentType === "string" ? contentType : null,
          location: typeof location === "string" ? location : null,
        };
        res.destroy();
        req.destroy();
        resolve(head);
      }
    );
    req.on("error", reject);
    signal.addEventListener("abort", () => req.destroy(), { once: true });
    req.end();
  });

function abortError(): Error {
  return Object.assign(new Error("Comprobación abortada"), { name: "AbortError" });
}

/** Resuelve con aborto: si el plazo vence durante el DNS, falla ya y el resultado tardío se ignora. */
function resolveWithSignal(resolveAll: ResolveAllFn, hostname: string, signal: AbortSignal): Promise<LookupAddress[]> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    resolveAll(hostname).then(
      (addresses) => {
        signal.removeEventListener("abort", onAbort);
        if (signal.aborted) reject(abortError());
        else resolve(addresses);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
}

/** `lookup` para el socket: solo conecta si TODAS las direcciones están permitidas. */
export function guardedLookup(resolveAll: ResolveAllFn, signal: AbortSignal): LookupFunction {
  return ((hostname: string, options: LookupOptions, callback: (...args: unknown[]) => void) => {
    resolveWithSignal(resolveAll, hostname, signal).then(
      (addresses) => {
        if (addresses.length === 0 || !addresses.every((a) => isAllowedAddress(a.address))) {
          callback(new Error("Destino no permitido"), "", 0);
        } else if (options?.all) {
          callback(null, addresses);
        } else {
          callback(null, addresses[0].address, addresses[0].family);
        }
      },
      (error) => callback(error, "", 0)
    );
  }) as LookupFunction;
}

/** ¿Se puede pedir esta URL? Esquema, puerto, credenciales, IP literal o resolución previa. */
async function isUrlAllowed(url: URL, resolveAll: ResolveAllFn, signal: AbortSignal): Promise<boolean> {
  if (url.protocol !== "https:") return false;
  if (url.port !== "" && url.port !== "443") return false;
  if (url.username || url.password) return false;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return isAllowedAddress(host);
  const addresses = await resolveWithSignal(resolveAll, host, signal);
  return addresses.length > 0 && addresses.every((a) => isAllowedAddress(a.address));
}

export function classify(head: HttpHead): ImageCheckResult {
  if (head.status < 200 || head.status > 299 || !head.contentType) return "unknown";
  const type = head.contentType.split(";")[0].trim().toLowerCase();
  if (type.startsWith("image/")) return "image";
  if (type === "text/html" || type === "application/xhtml+xml") return "page";
  return "unknown";
}

export async function checkImageUrl(rawUrl: string, deps: ImageCheckDeps = {}): Promise<ImageCheckResult> {
  const request = deps.request ?? realHttpRequest;
  const resolveAll = deps.resolveAll ?? realResolveAll;
  const maxRedirects = deps.maxRedirects ?? MAX_REDIRECTS;
  const perRequestTimeoutMs = deps.perRequestTimeoutMs ?? PER_REQUEST_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.totalTimeoutMs ?? IMAGE_CHECK_TOTAL_TIMEOUT_MS);
  const signal = controller.signal;
  const lookup = guardedLookup(resolveAll, signal);

  const send = async (url: URL, method: "HEAD" | "GET"): Promise<HttpHead> => {
    if (signal.aborted) throw abortError();
    const headers: Record<string, string> = { "user-agent": USER_AGENT, accept: "image/*,*/*;q=0.1" };
    if (method === "GET") headers.range = "bytes=0-0";
    return await request({ url, method, headers, signal: AbortSignal.any([signal, AbortSignal.timeout(perRequestTimeoutMs)]), lookup });
  };

  try {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return "unknown";
    }
    for (let hop = 0; hop <= maxRedirects; hop++) {
      if (signal.aborted) return "unknown";
      if (!(await isUrlAllowed(url, resolveAll, signal))) return "unknown";
      let head = await send(url, "HEAD");
      if (head.status === 405 || head.status === 501 || (head.status >= 200 && head.status <= 299 && !head.contentType)) {
        head = await send(url, "GET");
      }
      if (head.status >= 300 && head.status <= 399) {
        if (!head.location) return "unknown";
        try {
          url = new URL(head.location, url);
        } catch {
          return "unknown";
        }
        continue;
      }
      return classify(head);
    }
    return "unknown";
  } catch {
    return "unknown";
  } finally {
    clearTimeout(timer);
    // Nada queda vivo detrás: aborta la cadena (sin efecto si ya terminó).
    controller.abort();
  }
}
