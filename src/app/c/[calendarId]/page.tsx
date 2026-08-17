import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { fetchQuery } from "convex/nextjs";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { DoorGrid } from "@/app/c/[calendarId]/door-grid";
import { DoorGridLoader } from "@/app/c/[calendarId]/door-grid-loader";
import { signOut } from "@/lib/auth";
import { todayInTimeZone } from "@/lib/calendars";
import { convexAppServerSecret } from "@/lib/convex-server";
import { DEFAULT_COVER_ICON } from "@/lib/cover-icons";
import { getAuthorizedUser } from "@/lib/current-user";
import { resolveDoors } from "@/lib/guest-calendar";
import { resolveCalendarAccess } from "@/lib/roles";

/**
 * TAL-14 — reconectada contra Convex (`calendars.getPublic`, TAL-12, ya
 * existente — no hacía falta nada nuevo). `null` es "este calendario no
 * existe de verdad" (`notFound()` más abajo) — un fallo genuino de Convex
 * se deja propagar, mismo criterio que el resto de lecturas reconectadas
 * de TAL-12 (no hay ningún estado parcial honesto que fingir).
 */
async function getCalendarForGuestPage(calendarId: string): Promise<{ coverTitle: string; coverIcon: string } | null> {
  const calendar = await fetchQuery(api.calendars.getPublic, {
    serverSecret: convexAppServerSecret(),
    calendarId: calendarId as Id<"calendars">,
  });
  if (!calendar) return null;
  return {
    coverTitle: calendar.coverTitle,
    // Respaldo para calendarios creados antes de TAL-23 — ver
    // convex/schema.ts § coverIcon.
    coverIcon: calendar.coverIcon ?? DEFAULT_COVER_ICON,
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

  return (
    <main style={{ flex: 1, padding: "2rem", maxWidth: "900px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "1.5rem" }}>
        <div>
          <h1>
            <span aria-hidden="true">{calendar.coverIcon}</span> {calendar.coverTitle}
          </h1>
          <p style={{ color: "var(--accent)" }}>
            Sesión: {user.email} ({access.kind === "super-admin" ? "Super Admin" : access.role})
          </p>
        </div>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <button type="submit">Cerrar sesión</button>
        </form>
      </div>

      {tz ? (
        <ServerResolvedDoors calendarId={calendarId} userId={user.id} timeZone={tz} />
      ) : (
        <DoorGridLoader calendarId={calendarId} />
      )}
    </main>
  );
}

async function ServerResolvedDoors({ calendarId, userId, timeZone }: { calendarId: string; userId: string; timeZone: string }) {
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
  return <DoorGrid calendarId={calendarId} doors={result.doors} />;
}
