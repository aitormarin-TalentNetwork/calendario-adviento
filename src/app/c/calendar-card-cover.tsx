"use client";

import { CoverIcon } from "@/components/cover-icon";
import type { CoverIconName } from "../../../convex/coverIconCatalog";
import { useImageStatus } from "@/lib/use-image-status";
import type { CalendarStatus } from "@/lib/user-mode-calendars";

const STATUS_LABEL: Partial<Record<CalendarStatus, string>> = { live: "En marcha", upcoming: "Próximo" };

/**
 * TAL-85 — portada de la tarjeta de "Tus calendarios" (design-system.md §
 * "Foto de portada visible en todas partes", pantalla 1 del mockup
 * `design/propuesta-foto-portada-en-todas-partes.html`).
 *
 * - Capa base SIEMPRE la de antes de TAL-85, sin cambios (decisión del PM,
 *   opción A): el fondo que resuelve `c/page.tsx` (`backgroundImageUrl` con
 *   su capa oscura si existe; si no, el color del skin) y el icono.
 * - Con `coverImageUrl`, la foto encima (`.calendar-card-photo`), invisible
 *   hasta que carga de verdad (`useImageStatus`). Al cargar: degradado
 *   inferior y píldora de estado En marcha / Próximo arriba a la izquierda
 *   (`.status-pill`, la misma de "Mis calendarios"); terminado, sin píldora.
 *   Si no carga, queda la capa base.
 * - Con `coverImageUrl` la portada mide 130px desde el principio (no salta
 *   al cargar); sin ella, 110px como siempre.
 */
export function CalendarCardCover({
  cover,
  icon,
  coverImageUrl,
  status,
}: {
  cover: { className: string; skinKey: string; style: React.CSSProperties };
  icon: CoverIconName;
  coverImageUrl: string | null;
  status: CalendarStatus;
}) {
  const { imgRef, status: imageStatus, onLoad, onError } = useImageStatus();
  const showPhoto = coverImageUrl !== null && imageStatus === "loaded";
  const statusLabel = showPhoto ? STATUS_LABEL[status] : undefined;
  const className = [cover.className, coverImageUrl ? "calendar-card-cover--photo" : null, showPhoto ? "is-loaded" : null]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={className}
      aria-hidden="true"
      data-skin-style={cover.skinKey}
      data-cover-photo={coverImageUrl ? imageStatus : "none"}
      style={cover.style}
    >
      {/* TAL-60 — icono Lucide en su recuadro; TAL-62 — colores del skin (--icon-tile-*). */}
      <CoverIcon value={icon} size={26} box={52} />
      {coverImageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- URL externa arbitraria (https, validada al guardarla), no vale next/image sin dominios configurados.
        <img
          ref={imgRef}
          className="calendar-card-photo"
          src={coverImageUrl}
          alt=""
          decoding="async"
          onLoad={onLoad}
          onError={onError}
        />
      ) : null}
      {statusLabel ? <span className={`status-pill status-pill--${status} calendar-card-status`}>{statusLabel}</span> : null}
    </div>
  );
}
