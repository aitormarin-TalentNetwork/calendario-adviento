"use client";

import Link from "next/link";
import { useState } from "react";
import { CoverIcon } from "@/components/cover-icon";
import { startsInText, type CalendarStatus, type UserModeCard } from "@/lib/user-mode-calendars";

/**
 * TAL-73 — lista de "Tus calendarios" con barra de progreso (vistos/total
 * de esa persona) y chips de filtro Todos / En marcha / Próximos
 * (design/design-system.md § "Estilo 2026 → Progreso, filtros y etiquetas
 * de estado"). Los chips solo salen con más de un calendario; los
 * terminados solo en "Todos". Filtro de cliente, sin recordarlo.
 *
 * La portada de cada tarjeta llega ya resuelta del servidor (`cover`:
 * estilo del skin del catálogo, TAL-62).
 */
export type UserCalendarItem = UserModeCard & {
  cover: { className: string; skinKey: string; style: React.CSSProperties };
};

type Filter = "all" | "live" | "upcoming";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "Todos" },
  { key: "live", label: "En marcha" },
  { key: "upcoming", label: "Próximos" },
];

function matches(filter: Filter, status: CalendarStatus): boolean {
  return filter === "all" || filter === status;
}

export function UserCalendarsList({ calendars }: { calendars: UserCalendarItem[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const visible = calendars.filter((calendar) => matches(filter, calendar.status));

  return (
    <>
      {calendars.length > 1 ? (
        <div className="user-calendars-chips" role="group" aria-label="Filtrar calendarios">
          {FILTERS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              className="user-calendars-chip"
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}

      {visible.length === 0 ? (
        <p className="user-calendars-sub">No hay calendarios en este estado.</p>
      ) : (
        <ul className="user-calendars-grid">
          {visible.map((calendar) => (
            <li key={calendar.id} data-calendar-status={calendar.status}>
              <Link href={`/c/${calendar.id}`} className="calendar-card">
                <div className={calendar.cover.className} aria-hidden="true" data-skin-style={calendar.cover.skinKey} style={calendar.cover.style}>
                  {/* TAL-60 — icono Lucide en su recuadro; TAL-62 — colores del skin (--icon-tile-*). */}
                  <CoverIcon value={calendar.icon} size={26} box={52} />
                </div>
                <div className="calendar-card-body">
                  <span className="calendar-card-name">{calendar.title}</span>
                  <span className="calendar-card-meta num">{calendar.subtitle}</span>
                  {calendar.isAdmin && <span className="calendar-card-tag">Admin</span>}
                  {calendar.startsInDays !== null ? (
                    <span className="calendar-card-starts num">{startsInText(calendar.startsInDays)}</span>
                  ) : calendar.progress ? (
                    <span className="calendar-card-progress" data-progress={`${calendar.progress.viewed}/${calendar.progress.total}`}>
                      <span
                        className="calendar-card-progress-track"
                        role="progressbar"
                        aria-label="Días vistos"
                        aria-valuemin={0}
                        aria-valuemax={calendar.progress.total}
                        aria-valuenow={calendar.progress.viewed}
                      >
                        <span
                          className="calendar-card-progress-fill"
                          style={{ width: `${(calendar.progress.viewed / calendar.progress.total) * 100}%` }}
                        />
                      </span>
                      <span className="calendar-card-progress-text num" aria-hidden="true">
                        {calendar.progress.viewed}/{calendar.progress.total}
                      </span>
                    </span>
                  ) : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
