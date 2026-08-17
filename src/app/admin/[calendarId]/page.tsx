import { notFound, redirect } from "next/navigation";
import { fetchQuery } from "convex/nextjs";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { deleteCalendarAction } from "@/app/admin/actions";
import { DaysSection } from "@/app/admin/[calendarId]/days-section";
import { DeleteCalendarButton } from "@/app/admin/[calendarId]/delete-calendar-button";
import { EditCalendarForm } from "@/app/admin/[calendarId]/edit-calendar-form";
import { GuestsSection } from "@/app/admin/[calendarId]/guests-section";
import type { SkinOption } from "@/app/admin/[calendarId]/skin-picker";
import { SessionIndicator } from "@/components/session-indicator";
import { parseUtcDateOnly } from "@/lib/calendars";
import { convexAppServerSecret } from "@/lib/convex-server";
import { DEFAULT_COUNTDOWN_LABEL } from "@/lib/countdown";
import { DEFAULT_COVER_ICON } from "@/lib/cover-icons";
import { getAuthorizedUser } from "@/lib/current-user";
import { resolveCalendarAccess } from "@/lib/roles";
import { resolveSkinAppearance } from "@/lib/skin-appearance";

type AdminCalendar = {
  id: string;
  name: string;
  coverTitle: string;
  coverIcon: string;
  countdownLabel: string;
  startDate: Date;
  endDate: Date;
  skinId: string;
  coverImageUrl: string | null;
  backgroundImageUrl: string | null;
};

/**
 * TAL-12 — reconectada contra Convex (`calendars.getPublic` +
 * `skins.listAllPublic`, en paralelo). `null` significa "este calendario
 * no existe de verdad" (mismo hecho que `notFound()` representaba con
 * Prisma) — distinto de un fallo de la capa de datos, que ahora se deja
 * propagar tal cual (no hay ningún resultado parcial honesto que mostrar
 * si Convex es inalcanzable, mismo criterio que la versión Prisma nunca
 * tuvo un estado especial para "la base de datos está caída").
 */
async function getCalendarForAdminPage(calendarId: string): Promise<{
  calendar: AdminCalendar;
  skins: SkinOption[];
  skinAccent: string;
  skinBackground: string;
  skinTextColor: string;
  skinTextPill: boolean;
} | null> {
  const serverSecret = convexAppServerSecret();
  const [calendar, skins] = await Promise.all([
    fetchQuery(api.calendars.getPublic, { serverSecret, calendarId: calendarId as Id<"calendars"> }),
    fetchQuery(api.skins.listAllPublic, { serverSecret }),
  ]);
  if (!calendar) return null;

  const appearance = resolveSkinAppearance(calendar.skinId, skins);

  return {
    calendar: {
      id: calendar._id,
      name: calendar.name,
      coverTitle: calendar.coverTitle,
      // Respaldo para calendarios creados antes de TAL-23 — ver
      // convex/schema.ts § coverIcon.
      coverIcon: calendar.coverIcon ?? DEFAULT_COVER_ICON,
      // Respaldo para calendarios creados antes de TAL-27 — ver
      // convex/schema.ts § countdownLabel.
      countdownLabel: calendar.countdownLabel ?? DEFAULT_COUNTDOWN_LABEL,
      startDate: parseUtcDateOnly(calendar.startDate)!,
      endDate: parseUtcDateOnly(calendar.endDate)!,
      skinId: calendar.skinId,
      coverImageUrl: calendar.coverImageUrl ?? null,
      backgroundImageUrl: calendar.backgroundImageUrl ?? null,
    },
    // TAL-37 — `background`/`accent` se propagan tal cual (pueden venir
    // `undefined`, `v.optional` en el schema) para que `SkinPicker` pinte
    // cada muestra con su color real; el respaldo de ambos vive en el
    // propio `SkinPicker`/`DEFAULT_SKIN_APPEARANCE`, no aquí. TAL-47
    // (reconciliación, ronda 3) — `textColor`/`textPill` viajan igual:
    // `SkinPicker` no los usa, pero `edit-calendar-form.tsx` sí, para la
    // vista previa en vivo del skin seleccionado (`CalendarPreview`).
    skins: skins
      .map((skin) => ({
        id: skin._id,
        name: skin.name,
        background: skin.background,
        accent: skin.accent,
        textColor: skin.textColor,
        textPill: skin.textPill,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    // TAL-24 — a diferencia de la portada de Invitado, esta página es un
    // formulario de edición (no una "portada"), así que el brief solo
    // pide que el GRID de días refleje el skin, no toda la página — ver
    // `DaysSection`/`DaysGridEditor` más abajo, donde se escopan
    // `--accent`/`background` solo a esa sección.
    skinAccent: appearance.accent,
    skinBackground: appearance.background,
    skinTextColor: appearance.textColor,
    skinTextPill: appearance.textPill,
  };
}

export default async function AdminCalendarPage({
  params,
}: PageProps<"/admin/[calendarId]">) {
  const { calendarId } = await params;

  const user = await getAuthorizedUser();
  if (!user) redirect(`/login?callbackUrl=/admin/${calendarId}`);

  const access = await resolveCalendarAccess(user, calendarId);
  const isAdmin = access?.kind === "super-admin" || access?.role === "ADMIN";
  if (!isAdmin) redirect("/unauthorized");

  const data = await getCalendarForAdminPage(calendarId);
  if (!data) notFound();
  const { calendar, skins, skinAccent, skinBackground, skinTextColor, skinTextPill } = data;

  return (
    <main
      className="session-page-main"
      style={{ flex: 1, paddingLeft: "2rem", paddingRight: "2rem", paddingBottom: "2rem", maxWidth: "900px" }}
    >
      <SessionIndicator
        email={user.email}
        image={user.image}
        roleLabel={access?.kind === "super-admin" ? "Super Admin" : "Admin"}
      />
      <h1>Editar calendario</h1>

      <EditCalendarForm calendar={calendar} skins={skins} />

      <DaysSection
        calendarId={calendar.id}
        skinAccent={skinAccent}
        skinBackground={skinBackground}
        backgroundImageUrl={calendar.backgroundImageUrl}
        skinTextColor={skinTextColor}
        skinTextPill={skinTextPill}
      />

      <GuestsSection calendarId={calendar.id} />

      {/* TAL-33 — "Eliminar calendario" (ajuste de Aitor: antes "Borrar
          calendario") pasa de botón fantasma en la cabecera a botón rojo
          relleno al final de la pantalla, separado por un divisor
          (design/design-system.md § "Editor de calendario" — "Zona de
          peligro"). `.editor-danger-zone` (globals.css) alinea el botón a
          la derecha en desktop y lo pone a ancho completo en mobile
          (mejor objetivo táctil cuando queda solo al final de la
          pantalla). Confirmación mediante diálogo propio, no
          `window.confirm()` — ver `delete-calendar-button.tsx`. */}
      <div className="editor-danger-zone">
        <form action={deleteCalendarAction.bind(null, calendar.id)}>
          <DeleteCalendarButton calendarName={calendar.name} />
        </form>
      </div>
    </main>
  );
}
