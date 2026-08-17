import { notFound, redirect } from "next/navigation";
import { fetchQuery } from "convex/nextjs";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { deleteCalendarAction } from "@/app/admin/actions";
import { DaysSection } from "@/app/admin/[calendarId]/days-section";
import { EditCalendarForm } from "@/app/admin/[calendarId]/edit-calendar-form";
import { GuestsSection } from "@/app/admin/[calendarId]/guests-section";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
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
  skins: { id: string; name: string }[];
  skinAccent: string;
  skinBackground: string;
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
    },
    skins: skins.map((skin) => ({ id: skin._id, name: skin.name })).sort((a, b) => a.name.localeCompare(b.name)),
    // TAL-24 — a diferencia de la portada de Invitado, esta página es un
    // formulario de edición (no una "portada"), así que el brief solo
    // pide que el GRID de días refleje el skin, no toda la página — ver
    // `DaysSection`/`DaysGridEditor` más abajo, donde se escopan
    // `--accent`/`background` solo a esa sección.
    skinAccent: appearance.accent,
    skinBackground: appearance.background,
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
  const { calendar, skins, skinAccent, skinBackground } = data;

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

      <DaysSection calendarId={calendar.id} skinAccent={skinAccent} skinBackground={skinBackground} />

      <form action={deleteCalendarAction.bind(null, calendar.id)} style={{ marginTop: "2rem" }}>
        <ConfirmSubmitButton
          label="Borrar calendario"
          confirmText={`¿Seguro que quieres borrar "${calendar.name}"? Esto borra también sus días, invitaciones y membresías — no se puede deshacer.`}
        />
      </form>

      <GuestsSection calendarId={calendar.id} />
    </main>
  );
}
