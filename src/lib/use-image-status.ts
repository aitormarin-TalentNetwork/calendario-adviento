"use client";

import { useCallback, useEffect, useState } from "react";

export type ImageStatus = "loading" | "loaded" | "error";

/**
 * TAL-85 — "¿la foto carga?", mismo criterio en la tarjeta de "Tus
 * calendarios", la bienvenida y la vista previa del editor: carga si el
 * `<img>` del navegador dispara `load` con `naturalWidth > 0`; no carga si
 * dispara `error` (404, una página web en vez de una imagen, DNS…) o, con
 * `timeoutMs`, si sigue cargando pasado ese plazo.
 *
 * La imagen puede terminar (bien o mal) antes de que React hidrate, y
 * entonces `onLoad`/`onError` ya no llegan: la ref de callback (`imgRef`)
 * mira `img.complete` en cuanto React engancha el `<img>` (mismo truco que
 * tenía la bienvenida de TAL-70).
 *
 * El estado no se reinicia al cambiar la URL: quien lo usa monta el
 * componente con `key={url}` (o lo reinicia entero).
 */
export function useImageStatus({ timeoutMs }: { timeoutMs?: number } = {}) {
  const [status, setStatus] = useState<ImageStatus>("loading");

  const onLoad = useCallback(() => {
    setStatus((current) => (current === "loading" ? "loaded" : current));
  }, []);
  const onError = useCallback(() => {
    setStatus((current) => (current === "loading" ? "error" : current));
  }, []);
  const imgRef = useCallback(
    (img: HTMLImageElement | null) => {
      if (!img?.complete) return;
      if (img.naturalWidth > 0) onLoad();
      // Sin `currentSrc` aún no se ha pedido nada (p. ej. `loading="lazy"`
      // fuera de pantalla): no es un error, se espera a `load`/`error`.
      else if (img.currentSrc) onError();
    },
    [onLoad, onError]
  );

  useEffect(() => {
    if (timeoutMs === undefined) return;
    const timer = window.setTimeout(onError, timeoutMs);
    return () => window.clearTimeout(timer);
  }, [onError, timeoutMs]);

  return { imgRef, status, onLoad, onError };
}
