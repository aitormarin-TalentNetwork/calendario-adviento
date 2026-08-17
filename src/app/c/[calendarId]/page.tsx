import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { fetchQuery } from "convex/nextjs";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { CountdownMarkerLoader } from "@/app/c/[calendarId]/countdown-marker-loader";
import { DoorGrid } from "@/app/c/[calendarId]/door-grid";
import { DoorGridLoader } from "@/app/c/[calendarId]/door-grid-loader";
import { SessionIndicator } from "@/components/session-indicator";
import { parseUtcDateOnly, todayInTimeZone } from "@/lib/calendars";
import { convexAppServerSecret } from "@/lib/convex-server";
import { DEFAULT_COUNTDOWN_LABEL, daysUntil, formatCountdownMessage } from "@/lib/countdown";
import { DEFAULT_COVER_ICON } from "@/lib/cover-icons";
import { getAuthorizedUser } from "@/lib/current-user";
import { resolveDoors } from "@/lib/guest-calendar";
import { resolveCalendarAccess } from "@/lib/roles";
import { coverBackgroundStyle, resolveSkinAppearance, type SkinAppearance } from "@/lib/skin-appearance";

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
  coverIcon: string;
  endDate: Date;
  countdownLabel: string;
  appearance: SkinAppearance;
  backgroundImageUrl: string | null;
} | null> {
  const serverSecret = convexAppServerSecret();
  const [calendar, skins] = await Promise.all([
    fetchQuery(api.calendars.getPublic, { serverSecret, calendarId: calendarId as Id<"calendars"> }),
    fetchQuery(api.skins.listAllPublic, { serverSecret }),
  ]);
  if (!calendar) return null;
  return {
    coverTitle: calendar.coverTitle,
    // Respaldo para calendarios creados antes de TAL-23 — ver
    // convex/schema.ts § coverIcon.
    coverIcon: calendar.coverIcon ?? DEFAULT_COVER_ICON,
    endDate: parseUtcDateOnly(calendar.endDate)!,
    // Respaldo para calendarios creados antes de TAL-27 — ver
    // convex/schema.ts § countdownLabel.
    countdownLabel: calendar.countdownLabel ?? DEFAULT_COUNTDOWN_LABEL,
    appearance: resolveSkinAppearance(calendar.skinId, skins),
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
  const { appearance, endDate, countdownLabel, backgroundImageUrl } = calendar;

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
  // `ServerResolvedDoors` más abajo); si no, el marcador se difiere a
  // `CountdownMarkerLoader` (cliente, resuelve con `Intl` del navegador tras
  // montar) — nunca un valor por defecto tipo UTC calculado aquí. A
  // diferencia de las puertas, un desfase de un día en este número no
  // filtra contenido de ningún día (no es un hallazgo de seguridad como el
  // de TAL-8 ronda 2), pero el brief pide explícitamente reutilizar el
  // mismo patrón ya establecido, sin reinventarlo.
  const countdownMessage = tz
    ? formatCountdownMessage(daysUntil(todayInTimeZone(new Date(), tz), endDate), countdownLabel)
    : null;

  // TAL-24 — corrección de auditoría, ronda 1: texto blanco + sombra SOLO
  // no bastaba (el skin "Nieve" llega a `#ffffff` puro, blanco sobre
  // blanco). Ahora el fondo de la cabecera lleva una capa de
  // oscurecimiento uniforme antes del `background` del skin (o de
  // `backgroundImageUrl`, TAL-39 — `coverBackgroundStyle`,
  // `src/lib/skin-appearance.ts` — ahí el cálculo completo de por qué
  // garantiza contraste ≥4.5:1 incluso en ese caso límite), así que el
  // texto blanco + sombra sigue siendo legible de verdad en vez de
  // "normalmente".
  const coverTextStyle = { color: "#fff", textShadow: "0 1px 4px rgba(0,0,0,0.5)" };

  // TAL-47 — resuelto en una variable propia (tipada como
  // `React.CSSProperties`, no con un `as` inline) antes de mezclarla con
  // `"--accent"` más abajo: `coverBackgroundStyle` devuelve una unión
  // discriminada (TAL-29) que TypeScript no deja "castear" junto a una
  // custom property arbitraria en el mismo objeto literal ("neither type
  // sufficiently overlaps") — asignarla primero a una variable con tipo
  // declarado la resuelve a un `CSSProperties` concreto sin ese conflicto.
  const mainBackgroundStyle: React.CSSProperties = coverBackgroundStyle(appearance.background, backgroundImageUrl);

  return (
    <main
      className="session-page-main"
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
          // TAL-47 — el fondo del skin (o `backgroundImageUrl`, mismo
          // criterio que ya usaba solo el bloque de portada) cubre ahora
          // TODA la pantalla del Invitado, no solo las tarjetas concretas
          // que ya lo tenían — antes este `<main>` se quedaba con el `--bg`
          // fijo de la app (pine) alrededor/entre ellas. El bloque de
          // portada de abajo sigue aplicando `coverBackgroundStyle` por su
          // cuenta (mismo degradado/imagen, misma capa de oscurecimiento) —
          // como es opaco, no se superpone/oscurece de más con este fondo,
          // simplemente continúa visualmente el mismo patrón dentro de su
          // propia tarjeta redondeada.
          ...mainBackgroundStyle,
          // Se sobreescribe `--accent` a nivel de página para que TODO lo
          // que ya usa `var(--accent)` más abajo (incluida `DoorGrid`,
          // componente cliente — las custom properties CSS heredan por el
          // árbol del DOM sin importar límites de componente/Server-Client)
          // refleje el acento del skin sin tocar `door-grid.tsx` más de lo
          // necesario. Sin cambios en esta tarea — el acento no cambia de
          // alcance (brief de TAL-47), solo el fondo.
          "--accent": appearance.accent,
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
      <SessionIndicator
        email={user.email}
        image={user.image}
        roleLabel={access.kind === "super-admin" ? "Super Admin" : access.role}
      />
      <div
        style={{
          marginBottom: "1.5rem",
          // TAL-39 — `coverBackgroundStyle` sustituye el color/degradado
          // del skin por `backgroundImageUrl` cuando el calendario tiene
          // uno puesto (misma capa de oscurecimiento de contraste que
          // antes, ver `skin-appearance.ts`).
          ...coverBackgroundStyle(appearance.background, backgroundImageUrl),
          borderRadius: "0.75rem",
          padding: "1.25rem 1.5rem",
        }}
      >
        <h1 style={coverTextStyle}>
          <span aria-hidden="true">{calendar.coverIcon}</span> {calendar.coverTitle}
        </h1>
        {countdownMessage ? (
          <p
            style={{
              ...coverTextStyle,
              fontFamily: "var(--font-display)",
              fontSize: "1.5rem",
              fontWeight: 700,
              marginTop: "0.5rem",
            }}
          >
            {countdownMessage}
          </p>
        ) : (
          <CountdownMarkerLoader
            endDate={endDate.toISOString().slice(0, 10)}
            label={countdownLabel}
            style={coverTextStyle}
          />
        )}
      </div>

      {tz ? (
        <ServerResolvedDoors
          calendarId={calendarId}
          userId={user.id}
          timeZone={tz}
          background={appearance.background}
          backgroundImageUrl={backgroundImageUrl}
        />
      ) : (
        <DoorGridLoader calendarId={calendarId} background={appearance.background} backgroundImageUrl={backgroundImageUrl} />
      )}
    </main>
  );
}

async function ServerResolvedDoors({
  calendarId,
  userId,
  timeZone,
  background,
  backgroundImageUrl,
}: {
  calendarId: string;
  userId: string;
  timeZone: string;
  background: string;
  backgroundImageUrl: string | null;
}) {
  const today = todayInTimeZone(new Date(), timeZone);
  const result = await resolveDoors(calendarId, userId, today);

  if (!result.ok) {
    return (
      <p style={{ color: "var(--accent)" }}>
        Este calendario tiene un rango de fechas demasiado largo ({result.span} días) para mostrarlo aquí —
        contacta con quien lo administra.
      </p>
    );
  }
  return (
    <DoorGrid calendarId={calendarId} doors={result.doors} background={background} backgroundImageUrl={backgroundImageUrl} />
  );
}
