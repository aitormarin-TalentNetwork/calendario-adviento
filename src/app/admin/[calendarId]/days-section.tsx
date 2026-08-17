import { fetchQuery } from "convex/nextjs";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { DaysGridEditor } from "@/app/admin/[calendarId]/days-grid-editor";
import { formatCalendarDate, parseUtcDateOnly } from "@/lib/calendars";
import { convexAppServerSecret } from "@/lib/convex-server";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Límite defensivo (hallazgo de auditoría, ronda 1): sin él, un rango de
// fechas absurdamente largo (años/siglos — nada en el CRUD de calendario
// de TAL-5 lo impide) generaría un día por cada fecha del rango en cada
// render de esta sección, agotando memoria/CPU del servidor con una sola
// petición autenticada. 366 cubre cualquier calendario real (incluido uno
// que abarque un año entero) con margen; por encima, se pide acortar el
// rango antes de poder gestionar días.
const MAX_MANAGEABLE_DAYS = 366;

function daySpan(startDate: Date, endDate: Date): number {
  return Math.round((endDate.getTime() - startDate.getTime()) / ONE_DAY_MS) + 1;
}

/**
 * Todas las fechas de `startDate` a `endDate` (ambas incluidas, un día
 * natural cada una) — no una numeración "Día 1..N" arbitraria, para que
 * coincida exactamente con lo que `Day.date` puede guardar. Solo se llama
 * ya sabiendo que el rango está dentro de MAX_MANAGEABLE_DAYS.
 */
function datesInRange(startDate: Date, endDate: Date): Date[] {
  const dates: Date[] = [];
  const cursor = new Date(startDate);
  while (cursor <= endDate) {
    dates.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function toDateInputValue(date: Date) {
  return date.toISOString().slice(0, 10);
}

type DayRow = { date: Date; videoUrl: string; message: string | null };

/**
 * `parseUtcDateOnly` sobre un string "YYYY-MM-DD" que ya viene de Convex
 * (`getCalendarDaysPublic`) — nunca debería fallar, porque
 * `assertValidCalendarDate` (convex/dates.ts) ya garantiza ese formato al
 * guardar. Si alguna vez fallara, es un fallo real que hay que ver (bug de
 * invariante, no "sección no disponible") — por eso lanza en vez de caer
 * silenciosamente a un valor por defecto, a diferencia del catch de más
 * abajo (que sí es "no se pudo consultar Convex", un caso distinto).
 */
function requireDate(value: string): Date {
  const date = parseUtcDateOnly(value);
  if (!date) {
    throw new Error(
      `Fecha inválida recibida de Convex: "${value}" — no debería poder pasar, la valida assertValidCalendarDate al guardar.`
    );
  }
  return date;
}

/**
 * TAL-13 — reconectado contra Convex (antes `prisma.calendar.findUniqueOrThrow`
 * + `prisma.day.findMany`, ver docs/dias.md). Vive en `convex/days.ts`
 * (`getCalendarDaysHandler`), no en `calendars.ts` (dominio de TAL-12 en
 * paralelo) — el rango del calendario y sus días ya guardados se resuelven
 * juntos en una sola llamada, no hay rejilla parcial honesta que mostrar
 * si cualquiera de los dos falta.
 */
async function fetchCalendarDays(calendarId: string) {
  return await fetchQuery(api.days.getCalendarDaysPublic, {
    serverSecret: convexAppServerSecret(),
    calendarId: calendarId as Id<"calendars">,
  });
}

/**
 * `skinAccent`/`skinBackground` (TAL-24) — se aplican solo a esta
 * `<section>`, no a toda la página de Admin (esa es un formulario de
 * edición, no una "portada" — el brief solo pide que el GRID de días
 * refleje el skin). `skinAccent` se sobreescribe como `--accent` aquí
 * (`DaysGridEditor` ya usa `var(--accent)` en sus bordes de casilla —
 * hereda por el árbol del DOM sin importar límites de componente
 * Server/Client); `skinBackground` se pasa directo a `DaysGridEditor`,
 * que lo aplica solo a la cabecera de mes (ver el comentario completo
 * ahí de por qué no se toca el fondo de las casillas individuales).
 *
 * `backgroundImageUrl` (TAL-39) se pasa igual que `skinBackground` —
 * `DaysGridEditor` decide ahí (`skinBackgroundStyle`) si sustituye el
 * color/degradado del skin por la imagen en esa misma cabecera de mes.
 *
 * `skinTextColor`/`skinTextPill` (TAL-47) — mismo `appearance` que ya
 * resuelve `skinAccent`/`skinBackground` en `page.tsx`, se pasan igual a
 * `DaysGridEditor`, que decide con ellos el color de texto de esa cabecera
 * (`resolveCoverTextTreatment`, `skin-appearance.ts`).
 */
export async function DaysSection({
  calendarId,
  skinAccent,
  skinBackground,
  backgroundImageUrl,
  skinTextColor,
  skinTextPill,
}: {
  calendarId: string;
  skinAccent: string;
  skinBackground: string;
  backgroundImageUrl: string | null;
  skinTextColor: string;
  skinTextPill: boolean;
}) {
  // Solo se atrapa el fallo de la propia llamada (Convex no disponible,
  // secreto mal configurado, red caída) — un mensaje de "no disponible"
  // es la degradación honesta correcta para ESTE fallo concreto. Un error
  // dentro de `requireDate` (más abajo, fuera de este try) no se atrapa
  // aquí a propósito: sería un fallo real de invariante, no "no se pudo
  // consultar", y esconderlo detrás del mismo mensaje lo ocultaría en vez
  // de dejarlo visible para investigar.
  let raw: Awaited<ReturnType<typeof fetchCalendarDays>>;
  try {
    raw = await fetchCalendarDays(calendarId);
  } catch {
    return (
      <section style={{ marginTop: "2rem" }}>
        <h2 style={{ fontSize: "1.1rem", marginBottom: "0.75rem" }}>Días del calendario</h2>
        <p style={{ color: "var(--accent)" }}>Esta sección no está disponible ahora mismo.</p>
      </section>
    );
  }

  const startDate = requireDate(raw.startDate);
  const endDate = requireDate(raw.endDate);
  const days: DayRow[] = raw.days.map((day) => ({
    date: requireDate(day.date),
    videoUrl: day.videoUrl,
    message: day.message ?? null,
  }));

  const span = daySpan(startDate, endDate);

  if (span > MAX_MANAGEABLE_DAYS) {
    return (
      <section style={{ marginTop: "2rem" }}>
        <h2 style={{ fontSize: "1.1rem", marginBottom: "0.75rem" }}>Días del calendario</h2>
        <p style={{ color: "var(--accent)" }}>
          Este calendario dura {span} días — más de los {MAX_MANAGEABLE_DAYS} que se pueden gestionar aquí día a
          día. Acorta el rango de fechas arriba antes de asignar vídeos.
        </p>
      </section>
    );
  }

  const dayByDate = new Map(days.map((day) => [toDateInputValue(day.date), day]));
  // TAL-21, hallazgo de auditoría ronda 2: "hoy" NO se calcula aquí en
  // absoluto — ni con la fecha cruda del servidor (ronda 1) ni con la
  // cookie `tz` (que, si todavía no existe en la primerísima visita,
  // habría obligado a caer a UTC de todas formas, dejando esa primera
  // respuesta ya mal aunque se corrigiera después). El marcado de "hoy" es
  // puramente de cliente ahora — ver
  // `days-grid-editor.tsx::DaysGridEditor` (`todayDateStrInTimeZone`,
  // resuelta tras montar con la zona horaria real del navegador, que
  // nunca depende de que ninguna cookie haya llegado).
  const dayInfos = datesInRange(startDate, endDate).map((date) => {
    const dateStr = toDateInputValue(date);
    const day = dayByDate.get(dateStr);
    return {
      dateStr,
      label: formatCalendarDate(date),
      videoUrl: day?.videoUrl ?? null,
      message: day?.message ?? null,
    };
  });

  return (
    <section style={{ marginTop: "2rem", "--accent": skinAccent } as React.CSSProperties}>
      <h2 style={{ fontSize: "1.1rem", marginBottom: "0.25rem" }}>Días del calendario</h2>
      {/* TAL-34 (design/design-system.md § "Editor de calendario",
          design/propuesta-editor-calendario.html) — texto explicativo fijo
          encima del grid, mismo criterio de wording que el mockup. */}
      <p style={{ color: "var(--text-dim)", fontSize: "0.85rem", marginBottom: "0.75rem" }}>
        Selecciona el día para subir el vídeo.
      </p>
      <DaysGridEditor
        calendarId={calendarId}
        days={dayInfos}
        background={skinBackground}
        backgroundImageUrl={backgroundImageUrl}
        textColor={skinTextColor}
        textPill={skinTextPill}
      />
    </section>
  );
}
