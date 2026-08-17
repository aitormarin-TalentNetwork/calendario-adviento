"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

const TRIGGER_STYLE: React.CSSProperties = {
  background: "var(--berry)",
  border: "1px solid var(--berry)",
  color: "#fff5f0",
  borderRadius: "999px",
  padding: "0.6rem 1.25rem",
  fontWeight: 600,
  cursor: "pointer",
};

const CONFIRM_STYLE: React.CSSProperties = { ...TRIGGER_STYLE };

const CANCEL_STYLE: React.CSSProperties = {
  background: "transparent",
  border: "1px solid var(--border)",
  color: "var(--text)",
  borderRadius: "999px",
  padding: "0.6rem 1.25rem",
  fontWeight: 600,
  cursor: "pointer",
};

/**
 * Ajuste de Aitor sobre TAL-33 (ya Done): `ConfirmSubmitButton` usaba
 * `window.confirm()` — funciona, pero es un diálogo del propio sistema
 * operativo/navegador, desentona con el resto de la UI ya pulida (todos
 * los demás diálogos de esta pantalla — icono de portada, TAL-33; vídeo
 * del día, TAL-34 — son diálogos propios). Se sustituye SOLO aquí (borrar
 * calendario, la acción más destructiva de esta pantalla) por un diálogo
 * real, reutilizando el mismo patrón ya montado dos veces en este mismo
 * fichero/carpeta (`cover-icon-picker.tsx`, `days-grid-editor.tsx`): foco
 * inicial dentro del diálogo, Escape cierra, clic en el fondo cierra, foco
 * devuelto al disparador al cerrar.
 *
 * Deliberadamente un componente NUEVO y propio de esta pantalla, no un
 * cambio al `ConfirmSubmitButton` compartido — ese componente lo sigue
 * usando también `guests-section.tsx` ("Borrar por completo" de un
 * invitado), fuera del alcance de este ajuste; tocar su comportamiento
 * interno habría cambiado esa otra pantalla sin que nadie lo pidiera.
 *
 * El foco inicial va al botón "Cancelar" (la opción segura), no al botón
 * rojo — para una acción tan destructiva, que pulsar Intro por reflejo
 * justo al abrirse el diálogo no confirme el borrado por accidente.
 */
export function DeleteCalendarButton({ calendarName }: { calendarName: string }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  function openDialog() {
    setOpen(true);
  }

  function closeDialog() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    cancelButtonRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeDialog();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <>
      <button ref={triggerRef} type="button" onClick={openDialog} style={TRIGGER_STYLE}>
        Eliminar calendario
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Eliminar "${calendarName}"`}
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
              maxWidth: "420px",
              width: "100%",
              padding: "22px 24px",
            }}
          >
            <h4 style={{ fontFamily: "var(--font-display)", fontSize: "1.05rem", marginBottom: "8px" }}>
              ¿Eliminar &quot;{calendarName}&quot;?
            </h4>
            <p style={{ color: "var(--text-dim)", fontSize: "0.88rem" }}>
              Esto borra también sus días, vídeos e invitados — no se puede deshacer.
            </p>
            <div style={{ display: "flex", gap: "10px", marginTop: "20px" }}>
              <ConfirmDeleteButton />
              <button ref={cancelButtonRef} type="button" onClick={closeDialog} style={CANCEL_STYLE}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Componente aparte (no el `<button>` directo dentro de `DeleteCalendarButton`)
 * por el mismo motivo que `EditCalendarFields` se separó de `EditCalendarForm`
 * (TAL-20): `useFormStatus()` solo funciona en un descendiente del
 * `<form>`, nunca en el componente que contiene la propia etiqueta
 * `<form>` — aquí el `<form action={deleteCalendarAction...}>` vive en
 * `page.tsx`, un nivel por encima de `DeleteCalendarButton`, así que sí
 * puede leerse aquí dentro sin problema.
 */
function ConfirmDeleteButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} style={CONFIRM_STYLE}>
      {pending ? "…" : "Sí, eliminar calendario"}
    </button>
  );
}
