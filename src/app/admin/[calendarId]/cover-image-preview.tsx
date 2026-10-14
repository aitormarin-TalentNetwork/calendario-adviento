"use client";

import { useImageStatus } from "@/lib/use-image-status";

export const COVER_PREVIEW_OK = "✓ Imagen correcta. Se verá en la tarjeta, en la bienvenida y de fondo.";
export const COVER_PREVIEW_BROKEN = "No se puede mostrar: esta dirección es una página web, no una imagen";
export const COVER_PREVIEW_HELP =
  "Pega la dirección de la imagen. En el navegador: clic derecho sobre la foto → «Copiar dirección de imagen».";

/** Solo se previsualiza una URL `https://` bien formada; el resto lo rechaza el guardado de siempre. */
export function previewableImageUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed).protocol === "https:" ? trimmed : null;
  } catch {
    return null;
  }
}

/**
 * TAL-85 — vista previa del campo "Foto de portada" del editor
 * (design-system.md § "Foto de portada visible en todas partes", pantalla 4
 * del mockup). En vivo, con lo que hay escrito (sin esperar al guardado):
 * `edit-calendar-form.tsx` la monta con `key={url}`, así que cada URL
 * empieza de cero. Mismo criterio de "carga / no carga" que la tarjeta y la
 * bienvenida (`useImageStatus`). Sustituye al aviso de TAL-69 en este campo.
 */
export function CoverImagePreview({ url }: { url: string }) {
  const { imgRef, status: imageStatus, onLoad, onError } = useImageStatus();

  return (
    <div className="cover-preview" data-cover-preview={imageStatus}>
      {imageStatus === "error" ? (
        <>
          <div className="cover-preview-box cover-preview-broken">{COVER_PREVIEW_BROKEN}</div>
          <p role="status" className="cover-preview-help">
            {COVER_PREVIEW_HELP}
          </p>
        </>
      ) : (
        <>
          <div className="cover-preview-box">
            {/* eslint-disable-next-line @next/next/no-img-element -- URL externa arbitraria escrita por el Admin, no vale next/image sin dominios configurados. */}
            <img
              ref={imgRef}
              className="cover-preview-img"
              src={url}
              alt="Vista previa de la foto de portada"
              onLoad={onLoad}
              onError={onError}
            />
          </div>
          {imageStatus === "loaded" ? (
            <p role="status" className="cover-preview-ok">
              {COVER_PREVIEW_OK}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
