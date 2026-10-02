"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { signOutAction, switchModeAction } from "@/app/account-actions";
import type { AccountMode } from "@/lib/account-modes";
import { CoverIcon } from "@/components/cover-icon";

const AVATAR_SIZE = 40;

export type AccountMenuCalendar = { id: string; label: string; icon: string; href: string };

type AccountMenuProps = {
  email: string;
  image: string | null;
  mode: AccountMode;
  /**
   * TAL-68 — modos que puede usar (`allowedModes`, calculado en servidor
   * con `isSuperAdmin` en fresco): la sección "Modo" solo se pinta si hay
   * más de uno; "Super Admin" solo aparece para el Super Admin.
   */
  modes: AccountMode[];
  /** Ya filtrada por el servidor: vacía si en el modo actual hay 0 o 1 calendarios. */
  calendars: AccountMenuCalendar[];
  currentCalendarId?: string;
};

const ITEM_SELECTOR = '[role="menuitem"], [role="menuitemradio"]';

/**
 * Menú de la cuenta (TAL-59, design/design-system.md § "Menú de la cuenta
 * (avatar)"). Patrón WAI-ARIA "menu button", sin librerías:
 *
 * - Disparador: la foto de Google (o la inicial sobre `--primary-btn` como
 *   respaldo). Enter/Espacio/↓ abren y enfocan el primer item; ↑ abre y
 *   enfoca el último.
 * - Dentro: ↓/↑ en círculo, Home/End, Escape cierra y devuelve el foco al
 *   disparador, Tab cierra. Roving focus por `ref` (todos los items con
 *   `tabIndex={-1}`).
 * - Se cierra al pulsar fuera (`pointerdown` en `document`, mismo patrón de
 *   listener con limpieza que `delete-calendar-button.tsx`) y al navegar.
 *
 * El cambio de modo y el logout son Server Actions (`account-actions.ts`)
 * en `<form>`s normales: funcionan igual con teclado que con ratón.
 */
export function AccountMenu({ email, image, mode, modes, calendars, currentCalendarId }: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<"first" | "last" | null>(null);
  const menuId = useId();
  const pathname = usePathname();

  const items = useCallback(
    () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? []),
    []
  );

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  // Al abrirse, enfoca el item pedido (primero/último) una vez montado.
  useEffect(() => {
    if (!open || !pendingFocus.current) return;
    const list = items();
    (pendingFocus.current === "last" ? list[list.length - 1] : list[0])?.focus();
    pendingFocus.current = null;
  }, [open, items]);

  // Clic/toque fuera del menú → cerrar (sin robar el foco a lo pulsado).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, close]);

  // Navegar (fila de calendario, cambio de modo) → cerrar.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sincroniza con un sistema externo (la ruta del router), que es justo el caso que admite esta regla.
    setOpen(false);
  }, [pathname]);

  function openWith(focus: "first" | "last") {
    pendingFocus.current = focus;
    setOpen(true);
  }

  function onTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openWith("first");
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      openWith("last");
    }
  }

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const list = items();
    if (list.length === 0) return;
    const index = list.indexOf(document.activeElement as HTMLElement);
    const focusAt = (i: number) => list[(i + list.length) % list.length].focus();

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusAt(index + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusAt(index - 1);
        break;
      case "Home":
        event.preventDefault();
        focusAt(0);
        break;
      case "End":
        event.preventDefault();
        focusAt(list.length - 1);
        break;
      case "Escape":
        event.preventDefault();
        close(true);
        break;
      case "Tab":
        close(false);
        break;
    }
  }

  return (
    <div ref={rootRef} className="account-menu">
      <button
        ref={triggerRef}
        type="button"
        className="account-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label="Menú de la cuenta"
        title={email}
        onClick={() => (open ? close(false) : openWith("first"))}
        onKeyDown={onTriggerKeyDown}
      >
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element -- URL externa (perfil OAuth de Google), no vale next/image sin configurar dominios remotos — mismo criterio que TAL-28/TAL-5.
          <img
            src={image}
            alt=""
            width={AVATAR_SIZE}
            height={AVATAR_SIZE}
            style={{ width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: "50%", objectFit: "cover" }}
          />
        ) : (
          <span aria-hidden="true" className="account-menu-initial">
            {email.charAt(0).toUpperCase()}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="Menú de la cuenta"
          className="account-menu-panel"
          onKeyDown={onMenuKeyDown}
        >
          <div role="presentation" className="account-menu-email">
            {email}
          </div>

          {modes.length > 1 && (
            <>
              <div role="separator" className="account-menu-divider" />
              <div role="group" aria-labelledby={`${menuId}-mode`}>
                <div id={`${menuId}-mode`} role="presentation" className="account-menu-label">
                  Modo
                </div>
                {modes.map((value) => (
                  <ModeItem key={value} value={value} label={MODE_LABEL[value]} active={mode === value} onActive={() => close(true)} />
                ))}
              </div>
            </>
          )}

          {calendars.length > 0 && (
            <>
              <div role="separator" className="account-menu-divider" />
              <div role="group" aria-labelledby={`${menuId}-calendars`}>
                <div id={`${menuId}-calendars`} role="presentation" className="account-menu-label">
                  {mode === "admin" ? "Administrar" : "Ir a calendario"}
                </div>
                {calendars.map((calendar) => {
                  const current = calendar.id === currentCalendarId;
                  return (
                    <Link
                      key={calendar.id}
                      href={calendar.href}
                      role="menuitem"
                      tabIndex={-1}
                      aria-current={current ? "page" : undefined}
                      className={`account-menu-item account-menu-calendar${current ? " is-current" : ""}`}
                    >
                      <CalendarRowIcon icon={calendar.icon} />
                      <span className="account-menu-calendar-name">{calendar.label}</span>
                    </Link>
                  );
                })}
              </div>
            </>
          )}

          <div role="separator" className="account-menu-divider" />
          <form action={signOutAction}>
            <button type="submit" role="menuitem" tabIndex={-1} className="account-menu-item account-menu-logout">
              {/* Icono "log-out" (Feather Icons, MIT) — el mismo de TAL-28. */}
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              Cerrar sesión
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

/**
 * Una opción de "Modo". La activa no envía nada (ya se está en ese modo):
 * solo cierra el menú. La otra es un `<form>` con la Server Action.
 */
const MODE_LABEL: Record<AccountMode, string> = { user: "Usuario", admin: "Admin", superadmin: "Super Admin" };

function ModeItem({
  value,
  label,
  active,
  onActive,
}: {
  value: AccountMode;
  label: string;
  active: boolean;
  onActive: () => void;
}) {
  const className = `account-menu-item account-menu-mode${active ? " is-active" : ""}`;
  if (active) {
    return (
      <button type="button" role="menuitemradio" aria-checked="true" tabIndex={-1} className={className} onClick={onActive}>
        {label}
        <span aria-hidden="true" className="account-menu-mode-dot" />
      </button>
    );
  }
  return (
    <form action={switchModeAction}>
      <input type="hidden" name="mode" value={value} />
      <button type="submit" role="menuitemradio" aria-checked="false" tabIndex={-1} className={className}>
        {label}
      </button>
    </form>
  );
}

/**
 * Icono de una fila de calendario — el ÚNICO sitio del menú que lo pinta.
 * TAL-60 — icono Lucide en su recuadro pastel (`<CoverIcon>`, que normaliza
 * tanto nombres nuevos como emojis antiguos sin migrar). Conserva la clase
 * `account-menu-calendar-icon` para el tamaño de la fila; el fondo y el
 * radio los pone `.cover-icon-box` (bloque "TAL-60 — iconos" de globals.css).
 */
function CalendarRowIcon({ icon }: { icon: string }) {
  return <CoverIcon value={icon} size={16} box={28} className="account-menu-calendar-icon" />;
}
