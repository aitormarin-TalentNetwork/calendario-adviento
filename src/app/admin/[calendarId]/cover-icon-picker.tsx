"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { COVER_ICON_CATEGORIES } from "@/lib/cover-icons";

type CoverIconPickerProps = {
  value: string;
  onChange: (icon: string) => void;
  disabled?: boolean;
};

/**
 * Selector de icono de portada (TAL-23; diálogo TAL-33) — Design System
 * (`design/design-system.md` § "Selector de icono de portada (Admin)"),
 * fuente `design/propuesta-skins.html` (contenido de la galería) +
 * `design/propuesta-editor-calendario.html` (dónde vive: ya NO va
 * siempre visible en la página — solo el icono elegido, que abre un
 * diálogo con la galería completa).
 *
 * Ajustes de Aitor (post-TAL-33, ya con Done): el propio icono pasa a ser
 * el elemento clicable — se quita el botón de texto "Cambiar icono" aparte
 * (redundante: dos disparadores para la misma acción). El icono ya era un
 * `<div>` con las medidas/fondo del "swatch"; ahora es directamente el
 * `<button>` que abre el diálogo (`.cover-icon-trigger`, `globals.css` —
 * hover/focus con borde `--gold`, mismo criterio ya establecido para el
 * resto de elementos clicables del sistema, p. ej. `.skin-swatch` TAL-37).
 * Fondo del icono ahora transparente (antes `--paper-2`/`--pine-2`
 * relleno) — sin la casilla rellena, solo el borde `--gold` en hover/foco
 * indica que es clicable.
 *
 * Patrón de diálogo (abrir/cerrar con Escape, foco inicial en el botón
 * de cerrar, foco devuelto al disparador al cerrar) — mismo ya
 * establecido en `door-grid.tsx` (modal de vídeo del Invitado), no un
 * mecanismo nuevo.
 */
export function CoverIconPicker({ value, onChange, disabled }: CoverIconPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const filteredCategories = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return COVER_ICON_CATEGORIES;
    return COVER_ICON_CATEGORIES.map((category) => ({
      ...category,
      icons: category.icons.filter((icon) => icon.searchTerms.toLowerCase().includes(query)),
    })).filter((category) => category.icons.length > 0);
  }, [search]);

  function openDialog() {
    setSearch("");
    setOpen(true);
  }

  function closeDialog() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function selectIcon(emoji: string) {
    onChange(emoji);
    // Design System: "Al elegir un icono, el diálogo se cierra y el icono
    // elegido pasa a mostrarse en la casilla de la página" — no hace
    // falta un botón "Guardar" aparte dentro del diálogo.
    closeDialog();
  }

  useEffect(() => {
    if (!open) return;
    closeButtonRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeDialog();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="cover-icon-trigger"
        onClick={openDialog}
        disabled={disabled}
        aria-label="Selecciona un icono"
        title="Selecciona un icono"
        style={{
          width: "44px",
          height: "44px",
          borderRadius: "11px",
          background: "transparent",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "1.4rem",
          flexShrink: 0,
        }}
      >
        {value}
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Elegir icono de portada"
          onClick={closeDialog}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "1.5rem",
            zIndex: 50,
          }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{
              background: "var(--bg-raised)",
              border: "1px solid var(--border)",
              borderRadius: "16px",
              maxWidth: "460px",
              width: "100%",
              maxHeight: "82vh",
              overflowY: "auto",
              padding: "22px 24px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "4px" }}>
              <h4 style={{ fontFamily: "var(--font-display)", fontSize: "1.05rem" }}>Elegir icono de portada</h4>
              <button ref={closeButtonRef} type="button" onClick={closeDialog} aria-label="Cerrar" style={{ background: "none", border: "none", color: "var(--text-dim)", fontSize: "1.1rem", cursor: "pointer" }}>
                ✕
              </button>
            </div>

            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="🔍 Buscar icono…"
              style={{
                width: "100%",
                padding: "8px 12px",
                margin: "12px 0 16px",
                borderRadius: "999px",
                border: "1px solid var(--border)",
                background: "var(--bg)",
                color: "var(--text)",
                fontFamily: "var(--font-body)",
                fontSize: "0.88rem",
              }}
            />

            {filteredCategories.length === 0 && (
              <p style={{ fontSize: "0.85rem", color: "var(--text-dim)" }}>Ningún icono coincide con la búsqueda.</p>
            )}

            {filteredCategories.map((category) => (
              <div key={category.label} style={{ marginBottom: "14px" }}>
                <div
                  style={{
                    fontSize: "0.72rem",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    color: "var(--text-dim)",
                    marginBottom: "8px",
                  }}
                >
                  {category.label}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "6px" }}>
                  {category.icons.map(({ emoji, searchTerms }) => {
                    const selected = emoji === value;
                    return (
                      <button
                        key={emoji}
                        type="button"
                        title={searchTerms}
                        aria-pressed={selected}
                        onClick={() => selectIcon(emoji)}
                        style={{
                          aspectRatio: "1",
                          borderRadius: "9px",
                          border: `1px solid ${selected ? "var(--gold)" : "transparent"}`,
                          background: "var(--paper-2)",
                          boxShadow: selected ? "0 0 0 2px rgba(201,154,61,0.25)" : "none",
                          fontSize: "1.2rem",
                          cursor: "pointer",
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
        </div>
      )}
    </>
  );
}
