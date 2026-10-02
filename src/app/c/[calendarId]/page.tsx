import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { fetchQuery } from "convex/nextjs";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { DoorGrid } from "@/app/c/[calendarId]/door-grid";
import { DoorGridLoader } from "@/app/c/[calendarId]/door-grid-loader";
import { SessionIndicator } from "@/components/session-indicator";
import { parseUtcDateOnly, todayInTimeZone } from "@/lib/calendars";
import { convexAppServerSecret } from "@/lib/convex-server";
import { DEFAULT_COUNTDOWN_LABEL, daysUntil } from "@/lib/countdown";
import { CoverIcon } from "@/components/cover-icon";
import { getAuthorizedUser } from "@/lib/current-user";
import { resolveDoors } from "@/lib/guest-calendar";
import { resolveCalendarAccess } from "@/lib/roles";
import { skinBackgroundStyle } from "@/lib/skin-appearance";
import { loadSkinCatalog } from "@/lib/skin-catalog";
import { resolveSkinStyle, skinStyleVars, skinTreatmentClass, type SkinStyle } from "@/lib/skin-style";
import { CalendarCoverHeader } from "@/components/calendar-cover-header";
import { CountdownHero } from "@/components/countdown-hero";

/**
 * TAL-14 — reconectada contra Convex (`calendars.getPublic`, TAL-12, ya
 * existente — no hacía falta nada nuevo). `null` es "este calendario no
 * existe de verdad" (`notFound()` más abajo) — un fallo genuino de Convex
 * se deja propagar, mismo criterio que el resto de lecturas reconectadas
 * de TAL-12 (no hay ningún estado parcial honesto que fingir).
 *
 * TAL-24 — pide también `skins.listAllPublic` en paralelo (mismo patrón
 * que ya usaba `admin/[calendarId]/page.tsx` desde TAL-12) para resolver
 * el `background`/`accent` reales del skin del calendario — ver
 * `src/lib/skin-appearance.ts`.
 *
 * TAL-27 — también `endDate`/`countdownLabel`, para el marcador "Faltan X
 * días para Y" (ver más abajo). Mismo respaldo de lectura que `coverIcon`
 * para `countdownLabel` — convex/schema.ts § countdownLabel.
 */
async function getCalendarForGuestPage(
  calendarId: string
): Promise<{
  coverTitle: string;
  coverIcon: string | null;
  endDate: Date;
  countdownLabel: string;
  skinStyle: SkinStyle;
  backgroundImageUrl: string | null;
} | null> {
  const serverSecret = convexAppServerSecret();
  // TAL-62 — catálogo 2026 (`loadSkinCatalog`, con modo degradado si el
  // Convex desplegado es anterior a TAL-62): el estilo del skin del
  // calendario, o el respaldo Alegre si su skin no está en el catálogo.
  const [calendar, skinCatalog] = await Promise.all([
    fetchQuery(api.calendars.getPublic, { serverSecret, calendarId: calendarId as Id<"calendars"> }),
    loadSkinCatalog(),
  ]);
  if (!calendar) return null;
  return {
    coverTitle: calendar.coverTitle,
    // TAL-60 — valor crudo; `<CoverIcon>` aplica el respaldo y normaliza
    // emojis antiguos sin migrar (`normalizeCoverIcon`).
    coverIcon: calendar.coverIcon ?? null,
    endDate: parseUtcDateOnly(calendar.endDate)!,
    // Respaldo para calendarios creados antes de TAL-27 — ver
    // convex/schema.ts § countdownLabel.
    countdownLabel: calendar.countdownLabel ?? DEFAULT_COUNTDOWN_LABEL,
    skinStyle: resolveSkinStyle(calendar.skinId, skinCatalog.catalog),
    // TAL-39 — deliberadamente NO llega a /login (página sin autenticar,
    // restricción de seguridad de TAL-25 que esta tarea no ensancha); esta
    // página SÍ está autenticada, mismo criterio ya establecido para
    // `appearance` arriba.
    backgroundImageUrl: calendar.backgroundImageUrl ?? null,
  };
}

export default async function GuestCalendarPage({
  params,
}: PageProps<"/c/[calendarId]">) {
  const { calendarId } = await params;

  const user = await getAuthorizedUser();
  if (!user) redirect(`/login?callbackUrl=/c/${calendarId}`);

  // Existencia antes que rol — mismo orden que la versión Prisma original
  // (TAL-8) y que `admin/[calendarId]/page.tsx` (TAL-12): "este calendario
  // no existe" es un hecho verificable sin necesidad de que quien mira
  // tenga acceso a él.
  const calendar = await getCalendarForGuestPage(calendarId);
  if (!calendar) notFound();
  const { skinStyle, endDate, countdownLabel, backgroundImageUrl } = calendar;

  // Cualquier rol (Guest, Admin o Super Admin) puede ver el calendario; para
  // un Guest sin membership todavía, resolveCalendarAccess la crea aquí
  // mismo si existe una Invitation a su nombre (ver src/lib/roles.ts).
  const access = await resolveCalendarAccess(user, calendarId);
  if (!access) redirect("/unauthorized");

  // La zona horaria la trae la cookie `tz` (TimezoneSync, layout raíz).
  // Si ya existe, se resuelven las puertas aquí mismo, en el servidor
  // (vía rápida, sin ida y vuelta al cliente).
  //
  // Si NO existe todavía (primerísima visita de esta persona): NO se
  // resuelve ninguna puerta en el servidor con un valor por defecto tipo
  // UTC. Hallazgo de auditoría, ronda 2: eso podía filtrar en la
  // respuesta inicial (HTML/payload de React Server Components) el
  // vídeo/mensaje de un día que en la zona horaria REAL de quien mira
  // todavía es futuro — comprobado con São Paulo entre las 21:00 y
  // medianoche local, donde UTC ya considera "mañana". El refresco
  // posterior de `TimezoneSync` no arregla esto: no revoca una respuesta
  // que el servidor ya mandó. En su lugar, `DoorGridLoader` (componente
  // cliente) resuelve las puertas en cuanto conoce la zona horaria real
  // del navegador — el servidor no manda contenido de ningún día hasta
  // entonces.
  const tz = (await cookies()).get("tz")?.value;

  // TAL-27, parte 2 — mismo criterio de zona horaria que las puertas justo
  // arriba: si ya hay cookie `tz`, "hoy" se resuelve aquí mismo en el
  // servidor (`todayInTimeZone`, mismo helper que ya usa
  // `ServerResolvedDoors` más abajo); si no, el número se difiere al
  // propio `CountdownHero` (TAL-62; cliente, resuelve con `Intl` del
  // navegador tras montar) — nunca un valor por defecto tipo UTC. A
  // diferencia de las puertas, un desfase de un día en este número no
  // filtra contenido de ningún día (no es un hallazgo de seguridad como el
  // de TAL-8 ronda 2), pero el brief pide explícitamente reutilizar el
  // mismo patrón ya establecido, sin reinventarlo.
  const daysRemaining = tz ? daysUntil(todayInTimeZone(new Date(), tz), endDate) : null;

  // TAL-47 — resuelto en una variable propia (tipada como
  // `React.CSSProperties`, no con un `as` inline) antes de mezclarla con
  // `"--accent"` más abajo: `skinBackgroundStyle` devuelve una unión
  // discriminada (TAL-29) que TypeScript no deja "castear" junto a una
  // custom property arbitraria en el mismo objeto literal ("neither type
  // sufficiently overlaps") — asignarla primero a una variable con tipo
  // declarado la resuelve a un `CSSProperties` concreto sin ese conflicto.
  // `skinBackgroundStyle`, no `coverBackgroundStyle` — la primera ya no
  // antepone la capa oscura cuando no hay foto (el contraste lo garantiza
  // `textColor` ahora), ver `skin-appearance.ts`.
  const mainBackgroundStyle: React.CSSProperties = skinBackgroundStyle(skinStyle.palette.bg, backgroundImageUrl);

  return (
    <main
      className={["session-page-main", skinTreatmentClass(skinStyle)].filter(Boolean).join(" ")}
      data-skin-style={skinStyle.key}
      style={
        {
          flex: 1,
          paddingLeft: "2rem",
          paddingRight: "2rem",
          paddingBottom: "2rem",
          maxWidth: "900px",
          // TAL-46 — `<body>` es un flex container en columna
          // (`globals.css`), así que este `<main>` es un flex item cuyo eje
          // CRUZADO es el horizontal. Antes, sin ningún margen `auto`,
          // `align-items: stretch` (heredado del padre) lo estiraba al
          // ancho de `<body>` y `maxWidth` recortaba ese resultado a 900px
          // — pero SIEMPRE anclado al borde izquierdo, sin ninguna forma de
          // centrado. Corrección real, no solo "añadir margin: auto":
          // un margen `auto` en el eje cruzado tiene prioridad ABSOLUTA
          // sobre `stretch` (la propia spec de Flexbox — el `align-self`
          // efectivo deja de ser `stretch` en cuanto hay un margen `auto`
          // en ese eje), así que `margin: auto` SIN `width` explícito hace
          // que el item deje de estirarse del todo y pase a encogerse a su
          // contenido (~549px medido en un caso de prueba real, muy por
          // debajo de los 900px pretendidos) — confirmado con
          // `getBoundingClientRect()` en el navegador, no solo a ojo. Hace
          // falta `width: "100%"` para devolverle un tamaño cruzado
          // definido (100% del `<body>`, recortado por `maxWidth` a 900px
          // igual que antes) — con eso, los márgenes `auto` sí reparten el
          // espacio sobrante en partes iguales a los lados. No hizo falta
          // tocar `<body>` ni ningún padre — no es un flex ROW, así que
          // `justify-content` no aplica aquí.
          width: "100%",
          marginLeft: "auto",
          marginRight: "auto",
          // TAL-47 — el fondo del skin (o `backgroundImageUrl`) cubre ahora
          // TODA la pantalla del Invitado, no solo las tarjetas concretas
          // que ya lo tenían — antes este `<main>` se quedaba con el `--bg`
          // fijo de la app (pine) alrededor/entre ellas.
          //
          // TAL-50 — la tarjeta de portada (`CalendarCoverHeader`,
          // `paintBackground={false}`, más abajo) ya NO repinta el mismo
          // fondo por su cuenta — antes lo hacía desde su propia esquina,
          // y con un skin de patrón repetitivo (rayas/lunares/gajos) se
          // veía como una costura sobre este fondo (hallazgo real de
          // Aitor). Deja pasar esta capa de `<main>` sin más — es segura
          // de dejar transparente porque no está sobre contenido que
          // scrollea. La cabecera de mes sticky del grid (`door-grid.tsx`)
          // SÍ mantiene su propio repintado (con la misma costura pequeña
          // de antes) — corrección de auditoría, ronda 1: sin fondo
          // propio, mientras queda fija en pantalla, las casillas de
          // semanas anteriores del mismo mes se ven por detrás durante el
          // scroll. Ver el comentario completo en `door-grid.tsx`.
          ...mainBackgroundStyle,
          // TAL-62 — colores del skin como variables (`skinStyleVars`): los
          // consumen la cabecera, el bloque de la cuenta atrás, el grid, el
          // modal y el recuadro del icono.
          // `--skin-seen-bg` es el contrato con TAL-67 (casilla "visto").
          ...skinStyleVars(skinStyle),
          color: "var(--skin-ink)",
        } as React.CSSProperties
      }
    >
      {/* TAL-28 — SessionIndicator sustituye el antiguo "Sesión: email (ROL)"
          + botón "Cerrar sesión" (que necesitaban el mismo tratamiento
          `coverTextStyle` que el título, para leerse sobre un fondo de
          skin arbitrario — hallazgo de auditoría de TAL-24, ronda 1). El
          nuevo indicador no lo necesita: tanto el círculo del avatar como
          el emoji del botón de logout tienen su propio fondo/color
          opacos, así que son legibles sobre CUALQUIER color de skin sin
          ningún tratamiento especial — se probó explícitamente contra el
          skin "Nieve" (fondo casi blanco, el caso límite que motivó el
          NO-GO de TAL-24). `position: fixed`, así que no vive dentro de
          la cabecera oscurecida — flota en la esquina de la pantalla
          igual que en las otras 3 pantallas. */}
      <SessionIndicator user={user} mode="user" currentCalendarId={calendarId} />
      {/* TAL-49 — cabecera compartida con la vista previa en vivo del editor
          de Admin (`calendar-preview.tsx`), ver `calendar-cover-header.tsx`.

          TAL-50 — `paintBackground={false}`: esta tarjeta ya NO repinta el
          fondo del skin por su cuenta (antes sí, reutilizando
          `mainBackgroundStyle`) — con un skin de patrón repetitivo, esa
          segunda pintada reiniciaba el patrón desde la esquina de la
          tarjeta, se veía como una costura sobre el fondo de `<main>`
          justo detrás. Ahora `<main>` (`mainBackgroundStyle`, más abajo)
          es la ÚNICA capa de fondo real de toda la pantalla — esta
          tarjeta queda transparente y la deja pasar. */}
      <CalendarCoverHeader
        background={skinStyle.palette.bg}
        backgroundImageUrl={backgroundImageUrl}
        textColor={skinStyle.palette.ink}
        textPill={false}
        titleTag="h1"
        paintBackground={false}
        containerStyle={{ marginBottom: "1rem", borderRadius: "0.75rem", padding: "1.25rem 0 0" }}
        title={calendar.coverTitle}
        countdown={() => (
          // TAL-62 — bloque de la cuenta atrás del Estilo 2026 (colores del
          // skin, textos grandes, halo decorativo fuera del texto).
          <div style={{ marginTop: "1rem" }}>
            <CountdownHero daysRemaining={daysRemaining} endDate={endDate.toISOString().slice(0, 10)} label={countdownLabel} />
          </div>
        )}
      >
        {/* TAL-60 — icono Lucide en su recuadro; TAL-62 — con el par
            `tile`/`tileInk` del skin (`--icon-tile-bg`/`--icon-tile-fg`,
            puestos por `skinStyleVars` en `<main>`), diseñado y verificado
            por skin, así que ya no se pasa `accent`. */}
        <div style={{ marginBottom: "0.75rem" }}>
          <CoverIcon value={calendar.coverIcon} size={26} box={52} />
        </div>
      </CalendarCoverHeader>

      {tz ? (
        <ServerResolvedDoors calendarId={calendarId} userId={user.id} timeZone={tz} />
      ) : (
        <DoorGridLoader calendarId={calendarId} />
      )}
    </main>
  );
}

async function ServerResolvedDoors({
  calendarId,
  userId,
  timeZone,
}: {
  calendarId: string;
  userId: string;
  timeZone: string;
}) {
  const today = todayInTimeZone(new Date(), timeZone);
  const result = await resolveDoors(calendarId, userId, today);

  if (!result.ok) {
    return (
      <p style={{ color: "var(--skin-ink)" }}>
        Este calendario tiene un rango de fechas demasiado largo ({result.span} días) para mostrarlo aquí —
        contacta con quien lo administra.
      </p>
    );
  }
  return (
    <DoorGrid calendarId={calendarId} doors={result.doors} />
  );
}
