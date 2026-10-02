/**
 * `Day.videoUrl` es un link externo (YouTube/Vimeo/Google Drive/similar,
 * decisión de TAL-6) — no un archivo propio, así que el reproductor no
 * puede ser un `<video>` nativo. Reconoce los proveedores más previsibles
 * para este caso de uso (vídeo-regalo grabado por un compañero, no
 * contenido general) y los convierte a su URL de embed real: una URL de
 * "ver" normal (`youtube.com/watch?v=...`) casi nunca se deja incrustar en
 * un iframe (X-Frame-Options), hace falta la URL de embed específica de
 * cada proveedor.
 *
 * Cualquier otro host (o un link mal formado) no se intenta incrustar —
 * fallback a un enlace normal que abre en pestaña nueva, y aviso al Admin
 * al guardar (`NON_EMBEDDABLE_VIDEO_WARNING`, TAL-66). No hay forma fiable
 * de detectar en servidor si una URL arbitraria admite iframes sin pedirla
 * (y eso abriría un vector de SSRF, mismo razonamiento que TAL-5/6 con las
 * URLs de portada/vídeo), así que el criterio es una lista cerrada de
 * proveedores y formas conocidas, no una comprobación genérica. Mejor una
 * forma menos (cae al aviso) que un iframe roto sin aviso.
 *
 * `thumbnailUrl` solo se rellena para YouTube (URL de miniatura directa a
 * partir del id ya parseado, sin llamada extra). Vimeo exigiría su API de
 * oEmbed y Drive no tiene miniatura pública sin auth.
 *
 * TAL-66 — ver docs/dias.md § "Vídeos incrustables" para la tabla completa
 * de formatos aceptados y rechazados.
 */

/** TAL-66 — texto literal del PM para el aviso del editor al guardar un vídeo no incrustable. */
export const NON_EMBEDDABLE_VIDEO_WARNING =
  "Este enlace no se puede mostrar dentro del calendario; el invitado tendrá que abrirlo fuera. Usa un enlace normal de YouTube, Vimeo o Drive";

export type EmbeddableVideo = { embedUrl: string; thumbnailUrl: string | null };

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);
const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;
// Formas de ruta con el id como segundo segmento (`/embed/ID`, `/live/ID`...).
const YOUTUBE_PATH_ID_RE = /^\/(?:embed|shorts|live|v|e)\/([^/]+)\/?$/;
const MAX_START_SECONDS = 24 * 60 * 60;

/**
 * TAL-66 (decisión del PM) — tiempo de inicio de YouTube: `t`/`start` de la
 * query o `#t=` del fragmento, en `90`, `90s`, `1m30s`, `1h2m3s`. Un valor
 * no válido (texto, 0, negativo, > 24 h) se IGNORA — nunca invalida el
 * embed por culpa de `t`.
 */
export function parseYouTubeStartSeconds(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const value = raw.trim().toLowerCase();
  let seconds: number;
  if (/^\d+$/.test(value)) {
    seconds = Number(value);
  } else {
    const match = value.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
    if (!match || (!match[1] && !match[2] && !match[3])) return null;
    seconds = Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
  }
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > MAX_START_SECONDS) return null;
  return seconds;
}

function startFromUrl(url: URL): number | null {
  const fromQuery = parseYouTubeStartSeconds(url.searchParams.get("t") ?? url.searchParams.get("start"));
  if (fromQuery !== null) return fromQuery;
  const fragment = new URLSearchParams(url.hash.replace(/^#/, ""));
  return parseYouTubeStartSeconds(fragment.get("t") ?? fragment.get("start"));
}

function youtubeResult(id: string, url: URL): EmbeddableVideo | null {
  if (!YOUTUBE_ID_RE.test(id)) return null;
  const start = startFromUrl(url);
  return {
    embedUrl: `https://www.youtube.com/embed/${id}${start !== null ? `?start=${start}` : ""}`,
    thumbnailUrl: `https://img.youtube.com/vi/${id}/hqdefault.jpg`,
  };
}

/**
 * `attribution_link?u=<ruta>` (enlaces de "compartir" antiguos). `u` solo
 * se acepta como RUTA RELATIVA de youtube.com (empieza por `/`, no por
 * `//`), sin esquema, sin `\` ni caracteres de control, y sin codificación
 * doble (`%` tras la decodificación única de `URLSearchParams`). Se
 * resuelve contra `https://www.youtube.com` y el resultado pasa por las
 * MISMAS reglas que cualquier otra URL de YouTube, con una sola recursión
 * (`allowAttribution = false`).
 */
function parseAttributionLink(url: URL): EmbeddableVideo | null {
  const u = url.searchParams.get("u");
  if (!u) return null;
  if (!u.startsWith("/") || u.startsWith("//")) return null;
  if (/[\\%\u0000-\u001f\u007f]/.test(u)) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return null;
  let inner: URL;
  try {
    inner = new URL(u, "https://www.youtube.com");
  } catch {
    return null;
  }
  if (inner.protocol !== "https:" || inner.hostname !== "www.youtube.com") return null;
  return parseYouTube(inner, false);
}

function parseYouTube(url: URL, allowAttribution: boolean): EmbeddableVideo | null {
  if (url.hostname === "youtu.be") {
    const id = url.pathname.match(/^\/([^/]+)\/?$/)?.[1];
    return id ? youtubeResult(id, url) : null;
  }
  if (!YOUTUBE_HOSTS.has(url.hostname)) return null;

  if (url.pathname === "/watch" || url.pathname === "/watch/") {
    const id = url.searchParams.get("v");
    return id ? youtubeResult(id, url) : null;
  }
  if (url.pathname === "/attribution_link") {
    return allowAttribution ? parseAttributionLink(url) : null;
  }
  const id = url.pathname.match(YOUTUBE_PATH_ID_RE)?.[1];
  return id ? youtubeResult(id, url) : null;
}

/**
 * Vimeo — estrechado en TAL-66 a `vimeo.com/<id>` (con `/` final y query
 * opcionales). Antes `^\/(\d+)` aceptaba también `vimeo.com/<id>/<hash>`
 * (vídeo oculto) y generaba el embed SIN el `h=<hash>` que ese vídeo
 * necesita: un iframe roto sin aviso. Ahora cualquier otra ruta cae al
 * aviso (y el invitado ve "Ver vídeo ↗", que abre la URL completa).
 */
function parseVimeo(url: URL): EmbeddableVideo | null {
  if (url.hostname !== "vimeo.com" && url.hostname !== "www.vimeo.com") return null;
  const id = url.pathname.match(/^\/(\d+)\/?$/)?.[1];
  return id ? { embedUrl: `https://player.vimeo.com/video/${id}`, thumbnailUrl: null } : null;
}

/** Google Drive — sin cambios en TAL-66: `drive.google.com/file/d/<id>/…`. */
function parseDrive(url: URL): EmbeddableVideo | null {
  if (url.hostname !== "drive.google.com") return null;
  const id = url.pathname.match(/^\/file\/d\/([^/]+)/)?.[1];
  return id ? { embedUrl: `https://drive.google.com/file/d/${id}/preview`, thumbnailUrl: null } : null;
}

export function parseEmbeddableVideo(rawUrl: string): EmbeddableVideo | null {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return null;
  }
  // Solo http(s). Al guardar se exige https (`days-actions.ts::parseVideoUrl`);
  // http solo se tolera al LEER datos antiguos. La salida siempre es https.
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  return parseYouTube(url, true) ?? parseVimeo(url) ?? parseDrive(url);
}
