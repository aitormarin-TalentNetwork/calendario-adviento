/**
 * TAL-69 — texto del aviso (literal del issue) y forma de la respuesta de
 * `checkImageUrlsAction`. Sin imports de servidor: lo usa el formulario.
 */
export const IMAGE_URL_WARNING =
  "Este enlace no es una imagen, es una página web, y no se podrá mostrar. Usa la dirección directa de la imagen (en el navegador: clic derecho sobre la foto → «Copiar dirección de la imagen»).";

/** `true` = mostrar el aviso en ese campo. Ausente = sin aviso. */
export type ImageUrlWarnings = { coverImageUrl?: true; backgroundImageUrl?: true };
