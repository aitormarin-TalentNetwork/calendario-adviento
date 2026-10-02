import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireServerSecret } from "./serverAuth";
import { MAX_UPLOAD_BYTES, detectImageType, readBodyCapped } from "./dayFileGuards";
import { faultPoint, type AttachResult, type BeginIntentResult } from "./dayFiles";

/**
 * TAL-67 — subida de la imagen del día. La llama SOLO el servidor de Next
 * (`days-actions.ts::uploadDayImageAction`), de servidor a servidor; el
 * navegador nunca habla con Convex. Todo el ciclo de vida del fichero ocurre
 * aquí dentro (procedencia inequívoca, docs/dias.md):
 * 1. secreto en cabecera ANTES de leer el cuerpo;
 * 2. cuerpo leído en streaming con tope de 5 MB (no se fía de
 *    `Content-Length`) y tipo real por bytes mágicos;
 * 3. intención (relee el rol del actor y comprueba que el día existe) →
 *    `store` → registro → enlace (vuelve a comprobar tamaño y tipo con los
 *    metadatos reales).
 */
const http = httpRouter();

const UPLOAD_READ_TIMEOUT_MS = 30_000;

type UploadError = "not-authorized" | "too-large" | "bad-type" | "no-day" | "frozen" | "bad-request";

function json(status: number, body: { ok: true } | { ok: false; error: UploadError }): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

http.route({
  path: "/tal67/day-image",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      await requireServerSecret(request.headers.get("x-server-secret") ?? "");
    } catch {
      await request.body?.cancel().catch(() => {});
      return json(401, { ok: false, error: "not-authorized" });
    }
    const actorUserId = request.headers.get("x-actor-user-id");
    const calendarId = request.headers.get("x-calendar-id");
    const date = request.headers.get("x-day-date");
    if (!actorUserId || !calendarId || !date) {
      await request.body?.cancel().catch(() => {});
      return json(400, { ok: false, error: "bad-request" });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPLOAD_READ_TIMEOUT_MS);
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      const body = await readBodyCapped(new Response(request.body), MAX_UPLOAD_BYTES, controller.signal);
      if (!body.ok) return json(body.reason === "too-large" ? 413 : 400, { ok: false, error: body.reason === "too-large" ? "too-large" : "bad-request" });
      bytes = body.bytes;
    } finally {
      clearTimeout(timer);
    }
    const contentType = detectImageType(bytes);
    if (!contentType) return json(415, { ok: false, error: "bad-type" });

    let begun: BeginIntentResult;
    try {
      begun = await ctx.runMutation(internal.dayFiles.beginDayFileIntent, {
        kind: "upload",
        calendarId: calendarId as Id<"calendars">,
        date,
        actorUserId: actorUserId as Id<"users">,
        requireActor: true,
      });
    } catch {
      // Ids con forma inválida, etc.: nada creado todavía.
      return json(400, { ok: false, error: "bad-request" });
    }
    if (!begun.ok) return json(begun.error === "not-authorized" ? 403 : 409, { ok: false, error: begun.error });

    await faultPoint("before-store");
    const storageId = await ctx.storage.store(new Blob([bytes], { type: contentType }));
    await faultPoint("after-store");
    const registered: { ok: boolean } = await ctx.runMutation(internal.dayFiles.registerDayFile, {
      intentId: begun.intentId,
      storageId,
    });
    if (!registered.ok) {
      await ctx.storage.delete(storageId);
      console.error("TAL-67: registerDayFile no encontró la intención", begun.intentId);
      return json(409, { ok: false, error: "no-day" });
    }
    await faultPoint("after-register");
    const attached: AttachResult = await ctx.runMutation(internal.dayFiles.attachDayImage, {
      intentId: begun.intentId,
      storageId,
    });
    if (!attached.ok) {
      if (attached.error === "no-intent") {
        // La intención ya no está (p. ej. el día se borró y se llevó la
        // intención registrada, con su fichero): no-op si ya no existe.
        if (await ctx.storage.getUrl(storageId)) await ctx.storage.delete(storageId);
        return json(409, { ok: false, error: "no-day" });
      }
      return json(attached.error === "no-day" ? 409 : 422, { ok: false, error: attached.error });
    }
    return json(200, { ok: true });
  }),
});

export default http;
