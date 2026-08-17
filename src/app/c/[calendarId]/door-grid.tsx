"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { markDayViewedAction } from "@/app/c/[calendarId]/actions";
import { groupIntoMonths, isWeekendUTC, parseDateOnlyUTC, todayDateStrInTimeZone } from "@/lib/calendar-grid";
import { createConfettiEngine, type ConfettiEngine } from "@/lib/confetti-canvas";
import { daysUntil } from "@/lib/countdown";
import { playRewardSound } from "@/lib/reward-sound";
import { parseEmbeddableVideo } from "@/lib/video-embed";
import type { DoorInfo } from "@/lib/guest-calendar";
import { resolveCoverTextTreatment, skinBackgroundStyle, type CoverTextTreatment } from "@/lib/skin-appearance";
import { CoverText } from "@/components/cover-text";

const WEEKDAY_INITIALS = ["L", "M", "X", "J", "V", "S", "D"];

function cellStyle(door: DoorInfo): React.CSSProperties {
  const base: React.CSSProperties = {
    aspectRatio: "1",
    background: "var(--bg)",
    position: "relative",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    border: "none",
    padding: 0,
    fontFamily: "inherit",
    color: "inherit",
  };
  if (door.isToday) {
    // Ajuste 2026-08-17 (design-system.md § "Grid de días"): "hoy" tiene
    // que notarse claramente de un vistazo, no solo al fijarse — borde
    // más grueso (2px, antes 1.5px) + fondo sutil en --gold al 10% de
    // opacidad (token fijo, no --accent: "hoy" es una marca universal,
    // no depende del skin elegido). `boxShadow` inset con spread grande
    // en vez de `background`/`backgroundImage`: esta celda puede
    // combinar "hoy" con cualquier otro estado (abierto, bloqueado,
    // visto-con-miniatura) que ya ocupa esas dos propiedades más abajo —
    // el box-shadow se pinta como una capa aparte encima, sin pisarlas.
    base.border = "2px dashed var(--accent)";
    base.boxShadow = "inset 0 0 0 999px color-mix(in srgb, var(--gold) 10%, transparent)";
  }
  if (door.state === "locked") {
    // TAL-41 — antes `cursor: "default"` (día bloqueado = no interactivo);
    // ahora el clic SÍ tiene reacción (pulso + letrero de "impaciencia",
    // ver `triggerImpatienceEffect`), aunque el vídeo en sí siga sin
    // desbloquearse — `cursor: "pointer"` para que se note que responde.
    return { ...base, opacity: 0.4, cursor: "pointer" };
  }
  if (door.state === "watched") {
    return { ...base, cursor: "pointer" };
  }
  // unseen ("abierto, sin ver")
  return { ...base, cursor: "pointer", background: "var(--day-open-bg)" };
}

/**
 * TAL-31 — día real del mes pero fuera de [startDate, endDate] del
 * calendario (p. ej. el calendario empieza el 12 de un mes que arranca en
 * lunes 1: los días 1-11 existen en el mes pero no en el calendario).
 * Antes esta celda quedaba en blanco, indistinguible del relleno de
 * alineación de semana (fuera del propio mes) — Aitor pidió que el mes se
 * vea siempre completo: número grande estilo "marca de agua" (opacity
 * baja), sin candado, sin fondo de estado, sin click — no es un día
 * "bloqueado" (ese sí es interactivo, dentro del rango pero en el
 * futuro), es un día que no pertenece a este calendario en absoluto.
 *
 * TAL-44 — segunda vuelta, pedido explícito de Aitor: el fondo pasa de
 * `--bg` (bloque propio, destacaba) a `--bg-raised` — el mismo que usa el
 * relleno de alineación de semana (`padding`, más abajo) — para que se
 * funda con la tarjeta en vez de marcar un bloque aparte. El tachado
 * diagonal (`.dg-out-of-range::after`, en el `<style jsx>` de más abajo)
 * es un `::after` — no se puede expresar en un objeto de estilos inline
 * como este, por eso vive en la hoja de estilos scoped en vez de aquí.
 */
const outOfRangeCellStyle: React.CSSProperties = {
  aspectRatio: "1",
  background: "var(--bg-raised)",
  position: "relative",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const outOfRangeNumStyle: React.CSSProperties = {
  fontFamily: "var(--font-body)",
  fontWeight: 800,
  color: "var(--text)",
  // Ajustado a 0.15 para encajar con el borrador en vivo de
  // design-system.md § "Responsive / Mobile" (opacity baja, ejemplo
  // explícito 0.15) confirmado por la Directora — no venía de ningún
  // documento commiteado en el momento en que se escribió este valor,
  // así que se corrige aquí en cuanto se conoció el número exacto.
  opacity: 0.15,
};

/**
 * `fontSize` deliberadamente FUERA de estos objetos (antes vivía aquí) —
 * un `style` inline gana siempre a cualquier regla de una hoja de
 * estilos, con o sin `@media`, así que si el tamaño de fuente se fija
 * aquí no hay forma de que la regla `@media (max-width: ...)` del
 * `<style jsx>` de más abajo la reduzca en mobile. El tamaño ahora lo
 * pone `className` (`.dg-num`/`.dg-num-locked`/`.dg-num-pill`) — este
 * objeto solo controla lo que SÍ varía por estado/día (posición, color,
 * fondo), no el tamaño.
 */
function numStyle(door: DoorInfo, isWeekend: boolean): React.CSSProperties {
  if (door.state === "watched") {
    return {
      position: "absolute",
      bottom: "5px",
      right: "8px",
      fontWeight: 600,
      background: "rgba(15,24,18,0.6)",
      // Hallazgo de auditoría, ronda 1: el color de "hoy" (--accent) tiene
      // que aplicarse SIEMPRE, se combine con el estado que se combine —
      // antes esta rama ignoraba `isToday` por completo, así que abrir el
      // vídeo de hoy mismo (unseen → watched, cambio optimista) apagaba el
      // número dorado a --paper en el propio clic.
      color: door.isToday ? "var(--accent)" : "var(--paper)",
      borderRadius: "999px",
      fontFamily: "var(--font-mono)",
    };
  }
  return {
    fontFamily: "var(--font-body)",
    fontWeight: 800,
    color: door.isToday ? "var(--accent)" : isWeekend ? "var(--weekend-text)" : "var(--text)",
  };
}

/**
 * Rejilla de puertas + modal — mismo patrón que
 * `days-grid-editor.tsx` (TAL-6): componente cliente porque necesita
 * estado (qué puerta está abierta), pero el contenido (vídeo/mensaje de
 * cada puerta desbloqueada) ya viene resuelto en `doors` desde el
 * servidor, sin una segunda petición al abrir el modal.
 *
 * TAL-21 — grid rediseñado como "calendario de pared" real (design/
 * design-system.md § "Grid de días"): filas de 7 (lunes a domingo)
 * agrupadas por mes, cabecera de mes sticky, número grande sans-serif
 * (`--font-body`, nunca `--font-display` — decisión explícita del Design
 * System), fin de semana en `--berry`.
 *
 * TAL-24 — `background` (el `background` real del skin del calendario,
 * `src/lib/skin-appearance.ts`) se aplica SOLO a la cabecera sticky de
 * cada mes (antes un `--pine` fijo) — decisión deliberada de NO tocar el
 * fondo de las casillas individuales (`cellStyle`, más abajo): esas ya
 * codifican los 4 estados (bloqueado/abierto/visto/hoy) que TAL-21 acaba
 * de auditar, y aplicar un degradado arbitrario del skin ahí arriesgaba
 * romper ese contraste ya validado. El acento (`--accent`, heredado desde
 * `page.tsx` — las custom properties CSS heredan por el árbol del DOM sin
 * importar límites de componente) ya tiñe el borde de "hoy" sin tocar
 * nada aquí. El modal SÍ gana un borde de acento (más abajo, TAL-24) y
 * ahora también un fondo (TAL-39, ver el comentario siguiente) — el
 * iframe en sí no se toca en ningún caso, como pide el brief.
 *
 * TAL-39 — `backgroundImageUrl`, si el calendario tiene uno, sustituye el
 * `background` del skin en los dos sitios que ya usaban
 * `coverBackgroundCss(background)`: la cabecera de mes de aquí abajo Y el
 * modal de vídeo (antes con un fondo fijo `var(--background)`, sin
 * relación con el skin) — ver `coverBackgroundStyle`, `skin-appearance.ts`.
 */
export function DoorGrid({
  calendarId,
  doors: initialDoors,
  background,
  backgroundImageUrl,
  textColor,
  textPill,
}: {
  calendarId: string;
  doors: DoorInfo[];
  background: string;
  backgroundImageUrl: string | null;
  textColor: string;
  textPill: boolean;
}) {
  const textTreatment = resolveCoverTextTreatment({ textColor, textPill }, !!backgroundImageUrl);
  const [doors, setDoors] = useState(initialDoors);
  const [openDate, setOpenDate] = useState<string | null>(null);
  const [markError, setMarkError] = useState(false);
  const [, startTransition] = useTransition();
  const openDoor = doors.find((door) => door.dateStr === openDate);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const lastTriggerRef = useRef<HTMLButtonElement | null>(null);

  // TAL-40 — el motor de confeti vive en un <canvas> propio, fuera del
  // árbol de React (ver `confetti-canvas.ts`): se crea una sola vez
  // cuando el canvas se monta, no en cada `burst()`.
  const confettiCanvasRef = useRef<HTMLCanvasElement>(null);
  const confettiEngineRef = useRef<ConfettiEngine | null>(null);
  const [burstingDate, setBurstingDate] = useState<string | null>(null);
  const burstTimeoutsRef = useRef<number[]>([]);

  useEffect(() => {
    if (!confettiCanvasRef.current) return;
    const engine = createConfettiEngine(confettiCanvasRef.current);
    confettiEngineRef.current = engine;
    return () => {
      engine.destroy();
      confettiEngineRef.current = null;
    };
  }, []);

  // Si el componente se desmonta a mitad del efecto (~0.62s), cancela los
  // timeouts pendientes — sin esto, un `setState` tardío sobre un
  // componente ya desmontado sería un fallo silencioso real, no solo
  // teórico (basta con pinchar un día y navegar fuera muy rápido).
  useEffect(() => {
    const timeouts = burstTimeoutsRef.current;
    return () => {
      timeouts.forEach((id) => window.clearTimeout(id));
    };
  }, []);

  // TAL-41 — efecto de "impaciencia" (día bloqueado). `patienceInfo`
  // guarda el contenido del letrero (se queda con el último valor
  // aunque se oculte, igual que el prototipo de referencia: el propio
  // nodo del letrero está SIEMPRE montado, solo se le da o quita
  // visibilidad — así el texto no desaparece de golpe a mitad del
  // desvanecimiento de 0.25s). `patienceVisible` controla esa
  // visibilidad por separado.
  const [patienceInfo, setPatienceInfo] = useState<{ days: number } | null>(null);
  const [patienceVisible, setPatienceVisible] = useState(false);
  const patienceHideTimeoutRef = useRef<number | null>(null);
  // Timeout que quita `dg-pulsing`, por día — un `Map` (no un único ref)
  // porque dos días bloqueados distintos pueden estar pulsando a la vez;
  // hallazgo de auditoría, ronda 1: sin cancelar el timeout anterior de
  // ESE MISMO día, pinchar la misma casilla dos veces antes de los
  // 460ms dejaba el timeout del primer clic quitando la clase antes de
  // que terminara la animación reiniciada por el segundo.
  const pulseTimeoutsRef = useRef<Map<string, number>>(new Map());
  // Hallazgo de auditoría, ronda 1: un `window.addEventListener("click",
  // dismiss)` (con o sin `setTimeout(…, 0)` para retrasar el registro)
  // no basta para distinguir "clic genuinamente fuera" de "clic en OTRA
  // casilla bloqueada mientras el letrero ya estaba visible" — en ese
  // segundo caso `patienceVisible` no cambia (ya era `true`), así que el
  // efecto de abajo no se vuelve a ejecutar y el listener QUE YA ESTABA
  // puesto desde el primer clic sigue vivo y cierra el letrero justo
  // después de que su contenido se actualice. Este ref actúa de
  // "silenciador de una sola vez": `triggerImpatienceEffect` lo pone a
  // `true` de forma síncrona, ANTES de que el propio clic termine de
  // burbujear hasta `window` (React resuelve el `onClick` del botón,
  // más arriba en el árbol, antes de que el evento nativo siga
  // subiendo) — así que el `dismiss` de más abajo siempre ve `true` para
  // el clic que abre/actualiza el letrero, y `false` para cualquier
  // clic posterior genuinamente distinto.
  const suppressNextDismissRef = useRef(false);

  useEffect(() => {
    const pulseTimeouts = pulseTimeoutsRef.current;
    return () => {
      if (patienceHideTimeoutRef.current !== null) window.clearTimeout(patienceHideTimeoutRef.current);
      pulseTimeouts.forEach((id) => window.clearTimeout(id));
    };
  }, []);

  // Clic en cualquier parte de la pantalla (dentro o fuera del letrero)
  // lo cierra antes de los ~2.5s — brief: "se desvanece solo... o al
  // pinchar fuera/encima" — salvo que sea el propio clic que lo abrió o
  // actualizó (ver `suppressNextDismissRef` arriba).
  //
  // Hallazgo de auditoría, ronda 2: este efecto NO puede depender de
  // `patienceVisible` (como en la ronda anterior) — en la apertura
  // INICIAL (`false` → `true`), el efecto que monta este listener corre
  // DESPUÉS de que el propio clic de apertura ya haya terminado de
  // burbujear hasta `window` (los efectos siempre corren tras el commit
  // del render, nunca durante el mismo evento nativo) — así que
  // `suppressNextDismissRef` se pone a `true` sin que nadie lo consuma
  // todavía, y queda ahí atascado. El siguiente clic GENUINO para
  // cerrar es el que se encuentra el listener recién montado con el ref
  // aún en `true` — y se ignora por error, justo el intento real de
  // cerrar que debía funcionar. Solución: el listener se monta UNA sola
  // vez, de forma permanente (dependencias vacías), así que siempre
  // existe desde antes de que cualquier clic (incluida la primerísima
  // apertura) llegue a burbujear hasta `window`.
  useEffect(() => {
    function dismiss() {
      if (suppressNextDismissRef.current) {
        suppressNextDismissRef.current = false;
        return;
      }
      setPatienceVisible(false);
    }
    window.addEventListener("click", dismiss);
    return () => window.removeEventListener("click", dismiss);
  }, []);

  function closeModal() {
    setOpenDate(null);
    // Devuelve el foco a la puerta que abrió el modal — sin esto, tras
    // cerrar con Escape o con el botón "✕" el foco del teclado se queda
    // "colgado" en un elemento que ya no está en pantalla.
    lastTriggerRef.current?.focus();
  }

  // Cierre con Escape (además del click en el fondo y el botón "✕") y foco
  // inicial en el botón de cerrar al abrir — comportamiento estándar de
  // diálogo modal, hallazgo de auditoría (no bloqueante, ronda 1).
  useEffect(() => {
    if (!openDoor) return;
    closeButtonRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeModal();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openDoor]);

  function completeOpen(door: DoorInfo) {
    setOpenDate(door.dateStr);

    // Solo hay algo que marcar como visto si el día tiene vídeo asignado
    // y todavía no se había visto — abrir un día sin vídeo (Admin no llegó
    // a asignarlo) no cuenta como "visto". `door.dayId` implica
    // `door.videoUrl` en la práctica (Day.videoUrl no es nullable en el
    // schema), pero se comprueba explícito para que la condición diga
    // literalmente lo mismo que este comentario, sin depender de esa
    // invariante externa.
    if (door.dayId && door.videoUrl && door.state === "unseen") {
      startTransition(async () => {
        const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const result = await markDayViewedAction(calendarId, door.dayId!, timeZone);
        if (result.ok) {
          setDoors((prev) =>
            prev.map((d) => (d.dateStr === door.dateStr ? { ...d, state: "watched" as const } : d))
          );
        } else {
          setMarkError(true);
        }
      });
    }
  }

  /**
   * TAL-40 — efecto de "primera apertura" (design-system.md § "Grid de
   * días"): solo para "abierto, sin ver" (nunca "bloqueado" — no llega
   * aquí, `handleOpen` corta antes — ni "visto", que reabre directo sin
   * repetir el efecto cada vez). Pop dorado en la casilla + confeti por
   * toda la pantalla + sonido sintetizado, y solo AL TERMINAR (~0.62s) se
   * abre el reproductor — `completeOpen` (que marca "visto" en el
   * servidor Y abre el modal) se llama al final del timeout, no antes.
   *
   * `prefers-reduced-motion`: salta confeti/pop Y sonido (el brief deja el
   * sonido "a discreción" por no ser visual, pero un fanfarria sin ningún
   * acompañamiento visual puede sentirse igual de "ruido inesperado" para
   * alguien que pidió explícitamente menos movimiento/estímulo — más
   * simple y más seguro tratar el ajuste como "todo o nada").
   */
  function triggerFirstOpenEffect(door: DoorInfo, trigger: HTMLButtonElement) {
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) {
      completeOpen(door);
      return;
    }

    const rect = trigger.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    setBurstingDate(door.dateStr);
    confettiEngineRef.current?.burst(cx, cy);
    try {
      playRewardSound();
    } catch {
      // Web Audio puede fallar/estar bloqueado en algún navegador — no
      // debe impedir que el día se abra igualmente, el sonido es
      // decorativo, no parte del flujo funcional.
    }

    // Segunda oleada de confeti a mitad de la animación, para que se
    // sienta "más grande" — portado tal cual del prototipo de referencia
    // (`design/propuesta-grid-calendario.html`).
    burstTimeoutsRef.current.push(
      window.setTimeout(() => confettiEngineRef.current?.burst(cx, cy), 260)
    );
    burstTimeoutsRef.current.push(
      window.setTimeout(() => {
        setBurstingDate(null);
        completeOpen(door);
      }, 620)
    );
  }

  /**
   * TAL-41 — efecto de "impaciencia" (design-system.md § "Grid de días"):
   * al pinchar un día bloqueado (futuro, dentro del rango, todavía sin
   * abrir) no pasa nada funcionalmente (el vídeo sigue bloqueado), pero
   * la casilla da un pulso corto en `--berry` (nunca `--gold` — a
   * propósito distinto del pop dorado de TAL-40, "primera apertura") y
   * aparece un letrero centrado con la cuenta atrás real hasta ese día
   * concreto.
   *
   * El pulso se aplica con `classList` directamente sobre el propio
   * botón (`trigger`), no vía `className` de React — es el mismo truco
   * que el prototipo de referencia (quitar la clase, forzar un reflow
   * con `offsetWidth`, volver a añadirla) para que la animación se
   * REINICIE si se pincha el mismo día bloqueado varias veces seguidas;
   * como React nunca gestiona `className` en el botón bloqueado (no se
   * le pasa ese prop), tocarlo así no choca con ningún re-render.
   */
  function triggerImpatienceEffect(door: DoorInfo, trigger: HTMLButtonElement) {
    // Ver el comentario completo junto a la declaración de este ref —
    // tiene que ponerse a `true` de forma SÍNCRONA, antes de que este
    // mismo clic termine de burbujear hasta `window`, para que el
    // listener de "clic fuera" (más arriba) sepa ignorar este clic en
    // vez de cerrar el letrero que este mismo clic acaba de abrir o
    // actualizar.
    suppressNextDismissRef.current = true;

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!prefersReducedMotion) {
      // Hallazgo de auditoría, ronda 1: cancelar el timeout pendiente de
      // ESTE MISMO día antes de programar uno nuevo — si no, pinchar la
      // misma casilla dos veces antes de los 460ms dejaba el timeout del
      // primer clic quitando `dg-pulsing` a mitad de la animación
      // reiniciada por el segundo.
      const pendingTimeout = pulseTimeoutsRef.current.get(door.dateStr);
      if (pendingTimeout !== undefined) window.clearTimeout(pendingTimeout);

      trigger.classList.remove("dg-pulsing");
      void trigger.offsetWidth;
      trigger.classList.add("dg-pulsing");
      const pulseTimeoutId = window.setTimeout(() => {
        trigger.classList.remove("dg-pulsing");
        pulseTimeoutsRef.current.delete(door.dateStr);
      }, 460);
      pulseTimeoutsRef.current.set(door.dateStr, pulseTimeoutId);
    }

    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const today = parseDateOnlyUTC(todayDateStrInTimeZone(timeZone));
    const doorDate = parseDateOnlyUTC(door.dateStr);
    const days = daysUntil(today, doorDate);

    setPatienceInfo({ days });
    setPatienceVisible(true);
    if (patienceHideTimeoutRef.current !== null) window.clearTimeout(patienceHideTimeoutRef.current);
    patienceHideTimeoutRef.current = window.setTimeout(() => setPatienceVisible(false), 2500);
  }

  function handleOpen(door: DoorInfo, trigger: HTMLButtonElement) {
    if (door.state === "locked") {
      triggerImpatienceEffect(door, trigger);
      return;
    }
    lastTriggerRef.current = trigger;
    setMarkError(false);

    if (door.state === "unseen") {
      triggerFirstOpenEffect(door, trigger);
      return;
    }

    completeOpen(door);
  }

  const months = groupIntoMonths(doors);

  return (
    <>
      {/*
        Responsive del grid de días (design-system.md § "Responsive /
        Mobile", ajuste 2026-08-17, pedido explícito de Aitor): "mantiene
        siempre 7 columnas en cualquier ancho — nunca colapsa a menos
        columnas. Lo que se reduce es tipografía/padding de cada
        casilla, no la estructura" — antes el grid usaba
        `minmax(64px, 1fr)` + scroll horizontal como salida de emergencia
        en estrecho; con eso, el mes deja de leerse "de un vistazo" (hay
        que desplazar para ver la semana completa), justo lo que el PM no
        quiere. Ahora las columnas son `1fr` sin suelo mínimo (se
        reparten el ancho disponible siempre, nunca desbordan) y en su
        lugar se reduce tipografía/padding vía las clases de abajo — el
        único breakpoint que pide el documento normativo es 640px; se
        añade uno más estrecho (380px) porque a 640px, en un móvil
        realmente angosto (~320-375px de viewport), la reducción de un
        solo escalón no basta para que el número de día quepa cómodo en
        una casilla de ~45-50px — sugerencia de implementación del PM
        (dos escalones), no una desviación silenciosa.
      */}
      <style jsx>{`
        .dg-month-header {
          font-size: 1.15rem;
          padding: 10px 20px;
        }
        .dg-weekday-row {
          font-size: 0.68rem;
        }
        .dg-num {
          font-size: 1.9rem;
        }
        .dg-num-locked {
          font-size: 1.45rem;
        }
        .dg-num-pill {
          font-size: 0.82rem;
          padding: 1px 6px;
        }
        .dg-lock-icon {
          font-size: 0.7rem;
        }
        /* TAL-44 — tachado fino sobre los días "fuera de rango", portado
           1:1 de design/propuesta-grid-calendario.html (.day.out-of-range::after).
           ::after no se puede expresar como estilo inline de React, por
           eso vive aquí en vez de en outOfRangeCellStyle. */
        .dg-out-of-range::after {
          content: "";
          position: absolute;
          left: 14%;
          right: 14%;
          top: 50%;
          height: 1px;
          background: var(--text-dim);
          opacity: 0.4;
          transform: rotate(-18deg);
          pointer-events: none;
        }
        /* TAL-40 — efecto de "primera apertura": pop de escala + destello
           dorado en la casilla, portado de design/propuesta-grid-calendario.html
           (misma curva/tiempos). El número se oculta durante el pop — el
           confeti/sonido ya comunican "premio", un número reduciéndose de
           tamaño a la vez sería ruido visual de más. */
        @keyframes dg-reveal-pop {
          0% {
            transform: scale(1);
            filter: brightness(1);
          }
          18% {
            transform: scale(0.88);
            filter: brightness(1.3);
          }
          42% {
            transform: scale(1.22);
            filter: brightness(1.6);
          }
          65% {
            transform: scale(0.97);
            filter: brightness(1.15);
          }
          100% {
            transform: scale(1);
            filter: brightness(1);
          }
        }
        .dg-bursting {
          animation: dg-reveal-pop 0.62s cubic-bezier(0.34, 1.56, 0.64, 1) both;
          z-index: 3;
          box-shadow: 0 0 0 3px var(--gold), 0 8px 26px rgba(201, 154, 61, 0.55);
        }
        .dg-bursting .dg-num {
          opacity: 0;
          transition: opacity 0.15s;
        }
        /* TAL-41 — efecto de "impaciencia": pulso corto en --berry al
           pinchar un día bloqueado, portado de
           design/propuesta-grid-calendario.html — deliberadamente en
           --berry, nunca --gold, para que se note de un vistazo que es
           un "todavía no" distinto del pop dorado de "primera apertura"
           (TAL-40). */
        @keyframes dg-impatience-pulse {
          0% {
            transform: scale(1);
          }
          25% {
            transform: scale(0.9);
          }
          50% {
            transform: scale(1.08);
          }
          75% {
            transform: scale(0.96);
          }
          100% {
            transform: scale(1);
          }
        }
        .dg-pulsing {
          animation: dg-impatience-pulse 0.45s ease both;
          z-index: 3;
          box-shadow: 0 0 0 3px var(--berry), 0 6px 18px rgba(140, 47, 57, 0.4);
        }
        @media (max-width: 640px) {
          .dg-month-header {
            font-size: 0.95rem;
            padding: 8px 12px;
          }
          .dg-weekday-row {
            font-size: 0.62rem;
          }
          .dg-num {
            font-size: 1.5rem;
          }
          .dg-num-locked {
            font-size: 1.15rem;
          }
          .dg-num-pill {
            font-size: 0.7rem;
            padding: 1px 4px;
          }
        }
        @media (max-width: 380px) {
          .dg-month-header {
            font-size: 0.85rem;
            padding: 6px 10px;
          }
          .dg-weekday-row {
            font-size: 0.56rem;
          }
          .dg-num {
            font-size: 1.15rem;
          }
          .dg-num-locked {
            font-size: 0.9rem;
          }
          .dg-num-pill {
            font-size: 0.6rem;
            padding: 1px 3px;
          }
          .dg-lock-icon {
            font-size: 0.6rem;
          }
        }
      `}</style>
      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: "16px",
          boxShadow: "var(--shadow)",
          background: "var(--bg-raised)",
          overflow: "hidden",
        }}
      >
        <div style={{ maxHeight: "70vh", overflowY: "auto" }}>
          {months.map((month) => (
            <div key={month.key}>
              <div
                className="dg-month-header"
                style={{
                  position: "sticky",
                  top: 0,
                  zIndex: 2,
                  // TAL-47 — `skinBackgroundStyle` (sin la capa de
                  // oscurecimiento cuando no hay `backgroundImageUrl`; el
                  // contraste ya lo garantiza `textColor`/`textPill` vía
                  // `resolveCoverTextTreatment`/`CoverText`, más abajo).
                  // Ver `src/lib/skin-appearance.ts`.
                  ...skinBackgroundStyle(background, backgroundImageUrl),
                  fontFamily: "var(--font-display)",
                }}
              >
                <CoverText treatment={textTreatment}>{month.label}</CoverText>
              </div>
              <div
                className="dg-weekday-row"
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(7, 1fr)",
                  gap: "1px",
                  background: "var(--border)",
                  fontFamily: "var(--font-mono)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  color: "var(--text-dim)",
                }}
              >
                {WEEKDAY_INITIALS.map((initial, i) => (
                  <span
                    key={initial}
                    style={{
                      background: "var(--bg-raised)",
                      textAlign: "center",
                      padding: "6px 0",
                      color: i >= 5 ? "var(--weekend-text)" : undefined,
                      fontWeight: i >= 5 ? 700 : undefined,
                    }}
                  >
                    {initial}
                  </span>
                ))}
              </div>
              {month.weeks.map((week, weekIdx) => (
                <div
                  key={weekIdx}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(7, 1fr)",
                    gap: "1px",
                    background: "var(--border)",
                  }}
                >
                  {week.map((cell, dayIdx) => {
                    if (cell.kind === "padding") {
                      return <div key={dayIdx} style={{ aspectRatio: "1", background: "var(--bg-raised)" }} />;
                    }
                    if (cell.kind === "out-of-range") {
                      return (
                        <div key={cell.dateStr} aria-hidden="true" className="dg-out-of-range" style={outOfRangeCellStyle}>
                          <span className="dg-num" style={outOfRangeNumStyle}>
                            {cell.dayNum}
                          </span>
                        </div>
                      );
                    }
                    const door = cell.item;
                    const date = parseDateOnlyUTC(door.dateStr);
                    const isWeekend = isWeekendUTC(date);
                    const dayNum = date.getUTCDate();
                    const thumbnailUrl =
                      door.state === "watched" && door.videoUrl
                        ? parseEmbeddableVideo(door.videoUrl)?.thumbnailUrl ?? null
                        : null;
                    const style = cellStyle(door);
                    if (door.state === "watched") {
                      style.backgroundImage = thumbnailUrl
                        ? `linear-gradient(to top, rgba(10,16,12,0.55), transparent 60%), url("${thumbnailUrl}")`
                        : "linear-gradient(to top, rgba(10,16,12,0.55), transparent 60%), var(--pine)";
                      style.backgroundSize = "cover";
                      style.backgroundPosition = "center";
                    }
                    const numClassName =
                      door.state === "watched" ? "dg-num-pill" : door.state === "locked" ? "dg-num-locked" : "dg-num";
                    return (
                      <button
                        key={door.dateStr}
                        type="button"
                        aria-label={`${door.label}${door.state === "locked" ? " — bloqueado, todavía no puedes abrirlo" : door.state === "watched" ? " — ya visto" : ""}`}
                        onClick={(event) => handleOpen(door, event.currentTarget)}
                        className={burstingDate === door.dateStr ? "dg-bursting" : undefined}
                        style={style}
                      >
                        <span className={numClassName} style={numStyle(door, isWeekend)}>
                          {dayNum}
                        </span>
                        {door.state === "locked" && (
                          <span
                            aria-hidden="true"
                            className="dg-lock-icon"
                            style={{ position: "absolute", bottom: "6px", right: "8px" }}
                          >
                            🔒
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* TAL-40 — un único <canvas> full-screen para el confeti, fuera del
          flujo del grid (position: fixed) — el motor que lo dibuja vive en
          `confetti-canvas.ts`, ver el efecto arriba en `useEffect`. */}
      <canvas
        ref={confettiCanvasRef}
        aria-hidden="true"
        style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 60 }}
      />

      {/* TAL-41 — letrero de "impaciencia". SIEMPRE montado (no
          condicional): el desvanecimiento de 0.25s necesita que el
          contenido siga presente mientras `patienceVisible` pasa a
          `false` — si el texto desapareciera de golpe con el estado, no
          habría nada que desvanecer. El cierre (clic dentro o fuera) lo
          gestiona el `useEffect` de arriba sobre `window`, no un
          `onClick` propio aquí. */}
      <div
        role="status"
        aria-live="polite"
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          zIndex: 70,
          background: "var(--pine)",
          color: "var(--paper)",
          padding: "18px 26px",
          borderRadius: "14px",
          boxShadow: "0 20px 50px rgba(10,16,12,0.45)",
          maxWidth: "min(360px, 84vw)",
          textAlign: "center",
          fontFamily: "var(--font-display)",
          fontSize: "1.08rem",
          lineHeight: 1.4,
          opacity: patienceVisible ? 1 : 0,
          transform: `translate(-50%, -50%) scale(${patienceVisible ? 1 : 0.85})`,
          pointerEvents: patienceVisible ? "auto" : "none",
          transition: "opacity 0.25s ease, transform 0.25s ease",
        }}
      >
        {patienceInfo && (
          <>
            ¡Respira!
            <br />
            Te {patienceInfo.days === 1 ? "queda" : "quedan"}{" "}
            <strong style={{ color: "var(--gold-2)" }}>{patienceInfo.days}</strong>{" "}
            {patienceInfo.days === 1 ? "día" : "días"} para abrir este regalo.
          </>
        )}
      </div>

      {openDoor && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={openDoor.label}
          onClick={closeModal}
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
              // TAL-24 — brief: "aplica el acento del skin de forma
              // consistente (borde, o algún detalle visual — el iframe en
              // sí no se toca)". `--accent` ya está heredado desde
              // `page.tsx`, así que no hace falta pasar el skin explícito
              // aquí también.
              border: "2px solid var(--accent)",
              // TAL-47 — `skinBackgroundStyle` (mismo mecanismo que la
              // cabecera de mes de arriba y la cabecera de portada,
              // `page.tsx`) en vez del antiguo `coverBackgroundStyle`.
              ...skinBackgroundStyle(background, backgroundImageUrl),
              borderRadius: "1rem",
              maxWidth: "480px",
              width: "100%",
              padding: "1.25rem",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <h3 style={{ margin: 0 }}>
                <CoverText treatment={textTreatment}>{openDoor.label}</CoverText>
              </h3>
              <button ref={closeButtonRef} type="button" onClick={closeModal} aria-label="Cerrar" style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}>
                <CoverText treatment={textTreatment}>✕</CoverText>
              </button>
            </div>
            {openDoor.videoUrl ? (
              <VideoPlayer url={openDoor.videoUrl} label={openDoor.label} treatment={textTreatment} />
            ) : (
              <p style={{ marginTop: "0.75rem" }}>
                <CoverText treatment={textTreatment}>Todavía no hay vídeo para este día.</CoverText>
              </p>
            )}
            {openDoor.message && (
              <p style={{ marginTop: "0.75rem" }}>
                <CoverText treatment={textTreatment}>{openDoor.message}</CoverText>
              </p>
            )}
            {markError && (
              // TAL-47 — mismo hallazgo de auditoría de TAL-39 ronda 2
              // (contraste real del rojo original insuficiente sobre este
              // fondo): sigue sin color propio, `fontWeight` distingue el
              // aviso urgente en vez de un rojo que no puede garantizar su
              // contraste aquí — ahora contra `textTreatment`, no el blanco
              // fijo de antes.
              <p role="alert" style={{ marginTop: "0.75rem", fontSize: "0.85rem" }}>
                <CoverText treatment={textTreatment} style={{ fontWeight: 700 }}>
                  No se ha podido guardar que has visto este día. Ciérralo y vuelve a intentarlo.
                </CoverText>
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function VideoPlayer({ url, label, treatment }: { url: string; label: string; treatment: CoverTextTreatment }) {
  const embed = parseEmbeddableVideo(url);
  if (embed) {
    return (
      <div style={{ aspectRatio: "16/9", marginTop: "0.75rem" }}>
        <iframe
          title={`Vídeo del ${label}`}
          src={embed.embedUrl}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          style={{ width: "100%", height: "100%", border: "none", borderRadius: "0.5rem" }}
        />
      </div>
    );
  }
  return (
    <p style={{ marginTop: "0.75rem" }}>
      <a href={url} target="_blank" rel="noopener noreferrer">
        <CoverText treatment={treatment}>Ver vídeo ↗</CoverText>
      </a>
    </p>
  );
}
