"use client";

import { useMemo, useState } from "react";
import { COVER_ICON_CATEGORIES } from "@/lib/cover-icons";

// Valores hex exactos de design/design-system.md § "Tokens" (`--gold`,
// `--paper-2`) — hardcodeados aquí a propósito, NO como variables CSS
// compartidas: el resto de la app (`src/app/globals.css`) todavía no
// tiene el set de tokens del Design System, solo el esquema viejo del
// MVP (`--accent`/`--background`/`--foreground`). Migrar `globals.css` al
// set completo es más que esta tarea y afecta a TAL-21 (grid de días,
// mismo Design System) en paralelo — decisión de coordinación de la
// Directora, no mía (consultado con el PM, factory-e9). El resto del
// selector usa `var(--accent)` para quedar consistente con el resto de
// la app tal como está hoy.
const GOLD = "#c99a3d";
const PAPER_2 = "#efe7d4";

type CoverIconPickerProps = {
  value: string;
  onChange: (icon: string) => void;
  disabled?: boolean;
};

/**
 * Selector de icono de portada (TAL-23) — Design System
 * (`design/design-system.md` § "Selector de icono de portada (Admin)"),
 * fuente `design/propuesta-skins.html`. El mockup es un `<div>` estático
 * con placeholder "🔍 Buscar icono…" — sin JS real, así que el
 * comportamiento de filtrado (por `searchTerms` en español, no por el
 * emoji en sí) es una decisión de implementación, no de fidelidad visual
 * (ver `src/lib/cover-icons.ts`).
 */
export function CoverIconPicker({ value, onChange, disabled }: CoverIconPickerProps) {
  const [search, setSearch] = useState("");

  const filteredCategories = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return COVER_ICON_CATEGORIES;
    return COVER_ICON_CATEGORIES.map((category) => ({
      ...category,
      icons: category.icons.filter((icon) => icon.searchTerms.toLowerCase().includes(query)),
    })).filter((category) => category.icons.length > 0);
  }, [search]);

  return (
    <div style={{ marginTop: "16px", padding: "16px", border: "1px solid var(--accent)", borderRadius: "10px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          marginBottom: "14px",
          paddingBottom: "12px",
          borderBottom: "1px solid var(--accent)",
        }}
      >
        <div
          style={{
            width: "44px",
            height: "44px",
            borderRadius: "10px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "1.4rem",
            border: "1px solid var(--accent)",
          }}
        >
          {value}
        </div>
        <div style={{ fontSize: "0.78rem", color: "var(--accent)" }}>Icono de portada</div>
      </div>

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        disabled={disabled}
        placeholder="🔍 Buscar icono…"
        style={{
          width: "100%",
          padding: "9px 14px",
          marginBottom: "14px",
          borderRadius: "999px",
          border: "1px solid var(--accent)",
          background: "transparent",
          color: "inherit",
          fontSize: "0.85rem",
        }}
      />

      {filteredCategories.length === 0 && (
        <p style={{ fontSize: "0.85rem", color: "var(--accent)" }}>Ningún icono coincide con la búsqueda.</p>
      )}

      {filteredCategories.map((category) => (
        <div key={category.label} style={{ marginBottom: "14px" }}>
          <div
            style={{
              fontSize: "0.7rem",
              textTransform: "uppercase",
              letterSpacing: "0.07em",
              color: "var(--accent)",
              marginBottom: "6px",
            }}
          >
            {category.label}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(9, 1fr)", gap: "6px" }}>
            {category.icons.map(({ emoji, searchTerms }) => {
              const selected = emoji === value;
              return (
                <button
                  key={emoji}
                  type="button"
                  title={searchTerms}
                  aria-pressed={selected}
                  disabled={disabled}
                  onClick={() => onChange(emoji)}
                  style={{
                    aspectRatio: "1",
                    borderRadius: "8px",
                    border: `1px solid ${selected ? GOLD : "var(--accent)"}`,
                    background: selected ? PAPER_2 : "transparent",
                    fontSize: "1.2rem",
                    cursor: disabled ? "default" : "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {emoji}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
