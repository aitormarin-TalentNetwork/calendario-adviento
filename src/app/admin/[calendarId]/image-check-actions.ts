"use server";

import { fetchQuery } from "convex/nextjs";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { convexAppServerSecret } from "@/lib/convex-server";
import { getAuthorizedUser } from "@/lib/current-user";
import { createImageCheckService, runImageCheck } from "@/lib/image-check-service";
import { selectImageChecker } from "@/lib/image-checker";
import { IMAGE_CHECK_TOTAL_TIMEOUT_MS } from "@/lib/image-url-check";
import type { ImageUrlWarnings } from "@/lib/image-url-warning";
import { resolveCalendarAccess } from "@/lib/roles";

// Una instancia por proceso (caché, deduplicación y enfriamiento compartidos).
const service = createImageCheckService({ checker: selectImageChecker(process.env) });

/**
 * TAL-69 — segunda Server Action, la llama el editor DESPUÉS de un guardado
 * correcto (el guardado nunca espera a esto). Recibe solo `calendarId`:
 * comprueba que el usuario es Admin y lee de Convex las URLs YA GUARDADAS.
 *
 * Fail-open total: cualquier error (también de programación), sin permiso o
 * plazo de 3 s vencido → `{}` (sin aviso). Nunca lanza ni redirige.
 */
export async function checkImageUrlsAction(calendarId: string): Promise<ImageUrlWarnings> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<ImageUrlWarnings>((resolve) => {
      timer = setTimeout(() => resolve({}), IMAGE_CHECK_TOTAL_TIMEOUT_MS);
    });
    const work = runImageCheck({
      calendarId,
      isAdmin: async () => {
        const user = await getAuthorizedUser();
        if (!user) return false;
        const access = await resolveCalendarAccess(user, calendarId);
        return access?.kind === "super-admin" || access?.role === "ADMIN";
      },
      loadSavedUrls: async () => {
        const calendar = await fetchQuery(api.calendars.getPublic, {
          serverSecret: convexAppServerSecret(),
          calendarId: calendarId as Id<"calendars">,
        });
        return calendar ? { coverImageUrl: calendar.coverImageUrl, backgroundImageUrl: calendar.backgroundImageUrl } : null;
      },
      service,
    }).catch((): ImageUrlWarnings => ({}));
    return await Promise.race([work, deadline]);
  } catch {
    return {};
  } finally {
    clearTimeout(timer);
  }
}
