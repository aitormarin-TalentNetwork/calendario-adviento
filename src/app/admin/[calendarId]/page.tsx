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
import { getAuthorizedUser } from "@/lib/current-user";
import { resolveCalendarAccess } from "@/lib/roles";
import { loadSkinCatalog } from "@/lib/skin-catalog";
import { resolveSkinStyle, skinStyleVars, type SkinStyle } from "@/lib/skin-style";

type AdminCalendar = {
  id: string;
  name: string;
  coverTitle: string;
  coverIcon: string | null;
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
  skinStyle: SkinStyle;
} | null> {
  const serverSecret = convexAppServerSecret();
  // TAL-62 — el selector ofrece el catálogo 2026 (8, en su orden) con sus
  // muestras; en modo degradado (Convex anterior a TAL-62), las filas
  // antiguas como antes. Si el calendario todavía apunta a un skin fuera del
  // catálogo, el formulario parte de Alegre (su destino de migración; la
  // barrera de escritura de Convex lo guardaría así de todos modos).
  const [calendar, skinCatalog] = await Promise.all([
    fetchQuery(api.calendars.getPublic, { serverSecret, calendarId: calendarId as Id<"calendars"> }),
    loadSkinCatalog(),
  ]);
  if (!calendar) return null;

  const skinStyle = resolveSkinStyle(calendar.skinId, skinCatalog.catalog);
  let skins: SkinOption[];
  let skinId: string = calendar.skinId;
  if (skinCatalog.mode === "full") {
    skins = skinCatalog.catalog.map((skin) => ({
      id: skin._id,
      name: skin.name,
      swatches: skin.swatches,
      skinStyle: resolveSkinStyle(skin._id, skinCatalog.catalog),
    }));
    if (!skins.some((skin) => skin.id === skinId)) {
      skinId = skinCatalog.catalog.find((skin) => skin.key === "alegre")?._id ?? skins[0]?.id ?? skinId;
    }
  } else {
    skins = skinCatalog.allSkins
      .map((skin) => ({ id: skin._id, name: skin.name, background: skin.background, accent: skin.accent }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  return {
    calendar: {
      id: calendar._id,
      name: calendar.name,
      coverTitle: calendar.coverTitle,
      coverIcon: calendar.coverIcon ?? null,
      countdownLabel: calendar.countdownLabel ?? DEFAULT_COUNTDOWN_LABEL,
      startDate: parseUtcDateOnly(calendar.startDate)!,
      endDate: parseUtcDateOnly(calendar.endDate)!,
      skinId,
      coverImageUrl: calendar.coverImageUrl ?? null,
      backgroundImageUrl: calendar.backgroundImageUrl ?? null,
    },
    skins,
    skinStyle,
  };
}

export default async function AdminCalendarPage({
  params,
  searchParams,
}: PageProps<"/admin/[calendarId]">) {
  const { calendarId } = await params;
  // TAL-65 — error de "Personas del calendario" (`guests-actions.ts`).
  const { people_error: peopleError } = await searchParams;

  const user = await getAuthorizedUser();
  if (!user) redirect(`/login?callbackUrl=/admin/${calendarId}`);

  const access = await resolveCalendarAccess(user, calendarId);
  const isAdmin = access?.kind === "super-admin" || access?.role === "ADMIN";
  if (!isAdmin) redirect("/unauthorized");

  const data = await getCalendarForAdminPage(calendarId);
  if (!data) notFound();
  const { calendar, skins, skinStyle } = data;

  return (
    <main
      className="session-page-main"
      style={{ flex: 1, paddingLeft: "2rem", paddingRight: "2rem", paddingBottom: "2rem", maxWidth: "900px" }}
    >
      <SessionIndicator user={user} mode="admin" currentCalendarId={calendarId} />
      <h1>Editar calendario</h1>

      <EditCalendarForm calendar={calendar} skins={skins} />

      <DaysSection
        calendarId={calendar.id}
        // TAL-62 — el grid del editor está sobre el fondo del TEMA (--bg /
        // --surface-2), no sobre el del skin: su --accent (número y borde
        // de "hoy") es --primary-ink, AA en claro y oscuro (tal61 caso 4).
        // El `tileInk` del skin solo está verificado sobre su `tile` (en
        // Minimal/Rojiblanco es blanco: invisible sobre el crema del tema).
        skinAccent="var(--primary-ink)"
        skinBackground={skinStyle.palette.bg}
        backgroundImageUrl={calendar.backgroundImageUrl}
        skinTextColor={skinStyle.palette.ink}
        skinTextPill={false}
        skinVars={skinStyleVars(skinStyle)}
      />

      <GuestsSection
        calendarId={calendar.id}
        actorUserId={user.id}
        peopleError={typeof peopleError === "string" ? peopleError : undefined}
      />

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
