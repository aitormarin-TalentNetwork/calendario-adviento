// TAL-67 — funciones PURAS de la imagen de la casilla "Visto": tipos de
// imagen por bytes mágicos, id del vídeo por proveedor y descarga de la
// miniatura con guardas anti-SSRF. Sin nada de `_generated/server` a
// propósito: las usan las actions de Convex (`dayFiles.ts`, `http.ts`), el
// Next (`days-actions.ts`) y los tests sin red (`fetch` inyectable). Ver
// docs/dias.md § "Imagen de la casilla Visto (TAL-67)" para el análisis de
// SSRF completo.
import { parseEmbeddableVideo } from "../src/lib/video-embed";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;
export const MAX_OEMBED_BYTES = 64 * 1024;
export const PER_REQUEST_TIMEOUT_MS = 5_000;
export const TOTAL_THUMBNAIL_TIMEOUT_MS = 8_000;

export type ImageType = "image/jpeg" | "image/png" | "image/webp";
export const ALLOWED_IMAGE_TYPES: readonly ImageType[] = ["image/jpeg", "image/png", "image/webp"];

/** Tipo real por bytes mágicos; el tipo declarado por quien sube no cuenta. */
export function detectImageType(bytes: Uint8Array): ImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 8 && png.every((b, i) => bytes[i] === b)) return "image/png";
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && // RIFF
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50 // WEBP
  ) {
    return "image/webp";
  }
  return null;
}

export type ThumbnailSource =
  | { provider: "youtube"; id: string }
  | { provider: "vimeo"; id: string }
  | { provider: "drive"; id: string };

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID = /^\d{1,12}$/;
const DRIVE_ID = /^[A-Za-z0-9_-]{10,128}$/;

/**
 * Proveedor + id validado a partir de la URL del vídeo. Reutiliza
 * `parseEmbeddableVideo` (TAL-66, que ya valida host y forma) y extrae el id
 * de la URL de embed que construye — nunca de la URL escrita por el Admin.
 * `null` → no hay miniatura automática posible (vídeo no incrustable).
 */
export function thumbnailSourceForVideo(videoUrl: string): ThumbnailSource | null {
  const embed = parseEmbeddableVideo(videoUrl);
  if (!embed) return null;
  let url: URL;
  try {
    url = new URL(embed.embedUrl);
  } catch {
    return null;
  }
  if (url.hostname === "www.youtube.com") {
    const id = url.pathname.match(/^\/embed\/([^/]+)$/)?.[1];
    return id && YOUTUBE_ID.test(id) ? { provider: "youtube", id } : null;
  }
  if (url.hostname === "player.vimeo.com") {
    const id = url.pathname.match(/^\/video\/([^/]+)$/)?.[1];
    return id && VIMEO_ID.test(id) ? { provider: "vimeo", id } : null;
  }
  if (url.hostname === "drive.google.com") {
    const id = url.pathname.match(/^\/file\/d\/([^/]+)\/preview$/)?.[1];
    return id && DRIVE_ID.test(id) ? { provider: "drive", id } : null;
  }
  return null;
}

export type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>;

export type GuardedResult =
  | { ok: true; bytes: Uint8Array<ArrayBuffer>; contentType: string; finalHost: string }
  | { ok: false; reason: string };

/**
 * Lee el cuerpo en streaming y aborta en cuanto pasa de `maxBytes` (no se
 * fía de `Content-Length`). Si `signal` se aborta a mitad (timeout), cancela
 * el `reader` y falla sin acumular el resto.
 */
export async function readBodyCapped(
  response: Response,
  maxBytes: number,
  signal: AbortSignal
): Promise<{ ok: true; bytes: Uint8Array<ArrayBuffer> } | { ok: false; reason: string }> {
  if (!response.body) return { ok: false, reason: "no-body" };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const onAbort = () => {
    reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", onAbort);
  try {
    for (;;) {
      if (signal.aborted) return { ok: false, reason: "timeout" };
      let step: ReadableStreamReadResult<Uint8Array>;
      try {
        step = await reader.read();
      } catch {
        return { ok: false, reason: signal.aborted ? "timeout" : "read-error" };
      }
      if (signal.aborted) return { ok: false, reason: "timeout" };
      if (step.done) break;
      total += step.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return { ok: false, reason: "too-large" };
      }
      chunks.push(step.value);
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}

export type GuardedFetchOptions = {
  /** Hosts EXACTOS a los que se permite saltar (comparación literal de `hostname`). */
  allowedRedirectHosts: readonly string[];
  maxRedirects: number;
  maxBytes: number;
  expect: "image" | "json";
  /** Instante (ms, reloj de `now`) a partir del cual se aborta todo. */
  deadline: number;
  now?: () => number;
};

/**
 * `fetch` con lista cerrada: solo `https:`, redirecciones manuales a hosts
 * exactos de la lista y como mucho `maxRedirects`, timeout por petición y
 * total, tope de bytes en streaming y, para imágenes, `Content-Type`
 * permitido + bytes mágicos coherentes. Cualquier otra cosa → `{ok:false}`.
 */
export async function guardedFetch(fetchImpl: FetchImpl, startUrl: string, opts: GuardedFetchOptions): Promise<GuardedResult> {
  const now = opts.now ?? Date.now;
  let current: URL;
  try {
    current = new URL(startUrl);
  } catch {
    return { ok: false, reason: "bad-url" };
  }
  for (let hop = 0; ; hop++) {
    if (current.protocol !== "https:") return { ok: false, reason: "not-https" };
    const remaining = opts.deadline - now();
    if (remaining <= 0) return { ok: false, reason: "timeout" };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(PER_REQUEST_TIMEOUT_MS, remaining));
    try {
      let response: Response;
      try {
        response = await fetchImpl(current.toString(), {
          redirect: "manual",
          signal: controller.signal,
          headers: { accept: opts.expect === "json" ? "application/json" : "image/*" },
        });
      } catch {
        return { ok: false, reason: controller.signal.aborted ? "timeout" : "network" };
      }
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel().catch(() => {});
        if (hop >= opts.maxRedirects) return { ok: false, reason: "too-many-redirects" };
        const location = response.headers.get("location");
        if (!location || !/^https?:\/\//i.test(location)) return { ok: false, reason: "bad-redirect" };
        let next: URL;
        try {
          next = new URL(location);
        } catch {
          return { ok: false, reason: "bad-redirect" };
        }
        if (next.protocol !== "https:") return { ok: false, reason: "redirect-not-https" };
        if (!opts.allowedRedirectHosts.includes(next.hostname)) return { ok: false, reason: "redirect-host-not-allowed" };
        current = next;
        continue;
      }
      if (response.status !== 200) {
        await response.body?.cancel().catch(() => {});
        return { ok: false, reason: `status-${response.status}` };
      }
      const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      if (opts.expect === "image" && !ALLOWED_IMAGE_TYPES.includes(contentType as ImageType)) {
        await response.body?.cancel().catch(() => {});
        return { ok: false, reason: "not-image" };
      }
      if (opts.expect === "json" && contentType !== "application/json") {
        await response.body?.cancel().catch(() => {});
        return { ok: false, reason: "not-json" };
      }
      const body = await readBodyCapped(response, opts.maxBytes, controller.signal);
      if (!body.ok) return body;
      if (opts.expect === "image" && detectImageType(body.bytes) !== contentType) {
        return { ok: false, reason: "magic-mismatch" };
      }
      return { ok: true, bytes: body.bytes, contentType, finalHost: current.hostname };
    } finally {
      clearTimeout(timer);
    }
  }
}

export type ThumbnailDownload =
  | { ok: true; bytes: Uint8Array<ArrayBuffer>; contentType: ImageType }
  | { ok: false; reason: string };

/**
 * Descarga la miniatura del proveedor a partir de URLs construidas aquí,
 * con hosts fijos (nunca la URL del Admin):
 * - YouTube: `img.youtube.com/vi/<id>/hqdefault.jpg`, sin redirecciones.
 * - Vimeo: oEmbed oficial (JSON ≤ 64 KB) → `thumbnail_url` solo si es https
 *   y su host es exactamente `i.vimeocdn.com`; sin redirecciones.
 * - Drive: `drive.google.com/thumbnail?id=<id>&sz=w640`, exactamente un salto
 *   y solo a `lh3.googleusercontent.com`.
 */
export async function fetchProviderThumbnail(
  fetchImpl: FetchImpl,
  source: ThumbnailSource,
  opts: { now?: () => number; totalTimeoutMs?: number } = {}
): Promise<ThumbnailDownload> {
  const now = opts.now ?? Date.now;
  const deadline = now() + (opts.totalTimeoutMs ?? TOTAL_THUMBNAIL_TIMEOUT_MS);
  const image = (url: string, allowedRedirectHosts: readonly string[], maxRedirects: number) =>
    guardedFetch(fetchImpl, url, { allowedRedirectHosts, maxRedirects, maxBytes: MAX_THUMBNAIL_BYTES, expect: "image", deadline, now });

  let result: GuardedResult;
  if (source.provider === "youtube") {
    result = await image(`https://img.youtube.com/vi/${source.id}/hqdefault.jpg`, [], 0);
  } else if (source.provider === "drive") {
    result = await image(`https://drive.google.com/thumbnail?id=${source.id}&sz=w640`, ["lh3.googleusercontent.com"], 1);
  } else {
    const oembedUrl = `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(`https://vimeo.com/${source.id}`)}`;
    const json = await guardedFetch(fetchImpl, oembedUrl, {
      allowedRedirectHosts: [],
      maxRedirects: 0,
      maxBytes: MAX_OEMBED_BYTES,
      expect: "json",
      deadline,
      now,
    });
    if (!json.ok) return json;
    let thumbnailUrl: unknown;
    try {
      thumbnailUrl = (JSON.parse(new TextDecoder().decode(json.bytes)) as { thumbnail_url?: unknown }).thumbnail_url;
    } catch {
      return { ok: false, reason: "bad-oembed" };
    }
    if (typeof thumbnailUrl !== "string") return { ok: false, reason: "no-thumbnail-url" };
    let parsed: URL;
    try {
      parsed = new URL(thumbnailUrl);
    } catch {
      return { ok: false, reason: "bad-thumbnail-url" };
    }
    if (parsed.protocol !== "https:" || parsed.hostname !== "i.vimeocdn.com") {
      return { ok: false, reason: "thumbnail-host-not-allowed" };
    }
    result = await image(parsed.toString(), [], 0);
  }
  if (!result.ok) return result;
  return { ok: true, bytes: result.bytes, contentType: result.contentType as ImageType };
}
