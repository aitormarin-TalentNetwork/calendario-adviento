"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { CoverIcon } from "@/components/cover-icon";
import { COVER_ICON_CATEGORIES, normalizeCoverIcon } from "@/lib/cover-icons";

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
 * hover/focus con borde `--primary` (TAL-61), mismo criterio ya establecido para el
 * resto de elementos clicables del sistema, p. ej. `.skin-swatch` TAL-37).
 * Fondo del icono ahora transparente (antes relleno de superficie hundida
 * ) — sin la casilla rellena, solo el borde de acento en hover/foco
 * indica que es clicable. Etiqueta del campo acortada dos veces seguidas
 * ("Icono de portada" → "Selecciona un icono" → simplemente "Icono",
 * `edit-calendar-form.tsx`) — se replica el texto final en `aria-label`/
 * `title` de este botón, no el intermedio.
 *
 * Patrón de diálogo (abrir/cerrar con Escape, foco inicial en el botón
 * de cerrar, foco devuelto al disparador al cerrar) — mismo ya
 * establecido en `door-grid.tsx` (modal de vídeo del Invitado), no un
 * mecanismo nuevo.
 *
 * TAL-60 — iconos Lucide en vez de emojis (design-system.md § "Estilo 2026 →
 * Iconos"): mismas categorías y mismo buscador en español (`searchTerms`),
 * casillas y disparador con `<CoverIcon>`, lupa (`Search`) dentro del
 * buscador y `X` para cerrar. `value` llega normalizado
 * (`edit-calendar-form.tsx`), pero se vuelve a normalizar aquí para marcar
 * bien la casilla seleccionada aunque llegara un emoji antiguo.
 */
export function CoverIconPicker({ value, onChange, disabled }: CoverIconPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const selectedName = normalizeCoverIcon(value);

  const filteredCategories = useMemo(() => {
    const query = search.trim().toLowerCase();
    return COVER_ICON_CATEGORIES.map((category) => ({
      label: category.label,
      icons: query
        ? category.icons.filter((icon) => icon.searchTerms.toLowerCase().includes(query))
        : category.icons,
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

  function selectIcon(name: string) {
    onChange(name);
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
        aria-label="Icono"
        title="Icono"
        style={{
          width: "52px",
          height: "52px",
          padding: 0,
          borderRadius: "16px",
          background: "transparent",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <CoverIcon value={selectedName} size={24} box={48} />
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
              background: "var(--surface)",
              border: "1px solid var(--line)",
              borderRadius: "16px",
              maxWidth: "460px",
              width: "100%",
              maxHeight: "82vh",
              overflowY: "auto",
              padding: "22px 24px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "4px" }}>
              <h4 style={{ fontWeight: 800, fontSize: "1.05rem" }}>Elegir icono de portada</h4>
              <button ref={closeButtonRef} type="button" onClick={closeDialog} aria-label="Cerrar" style={{ background: "none", border: "none", color: "var(--ink-dim)", cursor: "pointer", display: "flex", padding: "0.25rem" }}>
                <X size={20} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>

            <div style={{ position: "relative", margin: "12px 0 16px" }}>
              <Search
                size={16}
                strokeWidth={2}
                aria-hidden="true"
                style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "var(--ink-dim)", pointerEvents: "none" }}
              />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar icono…"
                aria-label="Buscar icono"
                style={{
                  width: "100%",
                  padding: "8px 12px 8px 34px",
                  borderRadius: "999px",
                  border: "1px solid var(--line)",
                  background: "var(--bg)",
                  color: "var(--ink)",
                  fontSize: "0.88rem",
                }}
              />
            </div>

            {filteredCategories.length === 0 && (
              <p style={{ fontSize: "0.85rem", color: "var(--ink-dim)" }}>Ningún icono coincide con la búsqueda.</p>
            )}

            {filteredCategories.map((category) => (
              <div key={category.label} style={{ marginBottom: "14px" }}>
                <div
                  style={{
                    fontSize: "0.72rem",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    color: "var(--ink-dim)",
                    marginBottom: "8px",
                  }}
                >
                  {category.label}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "6px" }}>
                  {category.icons.map(({ name, searchTerms }) => {
                    const selected = name === selectedName;
                    return (
                      <button
                        key={name}
                        type="button"
                        title={searchTerms}
                        aria-label={searchTerms}
                        aria-pressed={selected}
                        data-icon-name={name}
                        onClick={() => selectIcon(name)}
                        style={{
                          aspectRatio: "1",
                          borderRadius: "9px",
                          border: `1px solid ${selected ? "var(--primary)" : "transparent"}`,
                          // TAL-60 — token con tema: un icono de línea no trae
                          // color propio como el emoji, así que necesita el
                          // del tema para verse en claro y en oscuro.
                          background: "var(--surface-2)",
                          color: "var(--ink)",
                          boxShadow: selected ? "0 0 0 2px rgba(201,154,61,0.25)" : "none",
                          fontSize: "1.2rem",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <CoverIcon value={name} size={22} />
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
