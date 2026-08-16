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
 * fallback a un enlace normal que abre en pestaña nueva. No hay forma
 * fiable de detectar en servidor si una URL arbitraria admite iframes sin
 * pedirla (y eso abriría un vector de SSRF, mismo razonamiento que TAL-5/6
 * con las URLs de portada/vídeo), así que el criterio es una lista
 * cerrada de proveedores conocidos, no una comprobación genérica.
 *
 * `thumbnailUrl` solo se rellena para YouTube (URL de miniatura directa a
 * partir del id ya parseado, sin llamada extra). Para el fondo del estado
 * "visto" del brief de TAL-8 (door-grid.tsx): decisión de Directora, el
 * mockup ya usa gradientes como placeholder de "fotograma real", así que
 * Vimeo/Drive se quedan con ese placeholder — Vimeo exigiría una llamada a
 * su API de oEmbed y Drive no tiene URL de miniatura pública sin auth, no
 * compensa para un bonus.
 */
export function parseEmbeddableVideo(rawUrl: string): { embedUrl: string; thumbnailUrl: string | null } | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "");

  if (host === "youtube.com" || host === "m.youtube.com") {
    const id = url.pathname === "/watch" ? url.searchParams.get("v") : url.pathname.match(/^\/(?:embed|shorts)\/([^/]+)/)?.[1];
    if (id) return { embedUrl: `https://www.youtube.com/embed/${id}`, thumbnailUrl: `https://img.youtube.com/vi/${id}/hqdefault.jpg` };
    return null;
  }

  if (host === "youtu.be") {
    const id = url.pathname.slice(1);
    if (id) return { embedUrl: `https://www.youtube.com/embed/${id}`, thumbnailUrl: `https://img.youtube.com/vi/${id}/hqdefault.jpg` };
    return null;
  }

  if (host === "vimeo.com") {
    const id = url.pathname.match(/^\/(\d+)/)?.[1];
    if (id) return { embedUrl: `https://player.vimeo.com/video/${id}`, thumbnailUrl: null };
    return null;
  }

  if (host === "drive.google.com") {
    const id = url.pathname.match(/^\/file\/d\/([^/]+)/)?.[1];
    if (id) return { embedUrl: `https://drive.google.com/file/d/${id}/preview`, thumbnailUrl: null };
    return null;
  }

  return null;
}
