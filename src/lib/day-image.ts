import { parseEmbeddableVideo } from "@/lib/video-embed";

/**
 * TAL-67 — imagen de fondo de la casilla "Visto" (y de la casilla con vídeo
 * del editor), en el orden del DS § "Imagen de la casilla Visto":
 * 1. imagen subida por el Admin y 2. copia propia de la miniatura (las dos
 *    llegan ya resueltas de Convex como `imageUrl`);
 * 3. solo si no hay copia y el vídeo es de YouTube: la miniatura directa de
 *    `img.youtube.com`, como antes de TAL-67 (decisión del PM: sin regresión
 *    entre el despliegue y la migración, ni si la copia falló);
 * 4. si no, `null` → la casilla pinta el fondo "visto" del skin.
 * Vimeo y Drive NUNCA se piden directamente desde el navegador.
 */
export function dayCellImageUrl(imageUrl: string | null, videoUrl: string | null): string | null {
  if (imageUrl) return imageUrl;
  if (!videoUrl) return null;
  return parseEmbeddableVideo(videoUrl)?.thumbnailUrl ?? null;
}

/**
 * Fondo en capas de la casilla: capa oscura (la misma que antes; T2 calcula
 * con ella el contraste del número), la imagen y, debajo, el fondo "visto"
 * del skin (`--skin-seen-bg`, TAL-62; respaldo `--primary`, TAL-61). Si la
 * imagen no carga (404, red), esa capa queda vacía y se ve la de debajo:
 * nunca una casilla rota.
 */
export function dayCellBackground(imageUrl: string | null): string {
  const shade = "linear-gradient(to top, rgba(10,16,12,0.55), transparent 60%)";
  // Contrato con TAL-61/TAL-62: `--skin-seen-bg` lo define TAL-62 por skin;
  // `--primary` (TAL-61, ya en main) es el respaldo mientras no exista.
  const fallback = "var(--skin-seen-bg, var(--primary))";
  return imageUrl ? `${shade}, url("${imageUrl}") center / cover no-repeat, ${fallback}` : `${shade}, ${fallback}`;
}
