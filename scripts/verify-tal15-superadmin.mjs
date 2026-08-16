// Evidencia de auditoría — TAL-15 (Panel Super Admin sobre Convex):
// verifica contra un deployment real las cinco funciones de
// `convex/superadmin.ts` — rechazo de un actor que no es Super Admin
// (`requireSuperAdmin`, re-verificado dentro de cada función, no solo
// confiado a Next.js), `listCalendarsWithStats` (status/daysCount/
// invitedCount/viewedCount reales), `addAdmin` (validación, ascenso
// GUEST→ADMIN) y `removeAdminEverywhere` (los dos caminos: degradar a
// GUEST si hay invitación viva, borrar si no).
//
// No forma parte de la aplicación — script de verificación puntual,
// guardado versionado (mismo criterio que
// scripts/verify-tal12-delete-concurrency.mjs, TAL-12 ronda 3, a
// sugerencia del auditor) para que la evidencia se pueda re-ejecutar, no
// solo leer en texto. Necesita NEXT_PUBLIC_CONVEX_URL y
// CONVEX_APP_SERVER_SECRET en el entorno (los mismos de `.env.local`).
// Requiere también la CLI de Convex ya autenticada y apuntando al mismo
// deployment (`npx convex env get`), porque `calendarMemberships.ts::
// addMembership` e `invitations.ts::inviteGuest` (TAL-9) siguen siendo
// `internalMutation` — sin frontera pública, fuera del dominio de esta
// tarea — así que la parte de sembrar membership/invitación pasa por el
// canal de administrador de la CLI (`npx convex run`), igual que hizo
// TAL-12 para las llamadas que necesitaba fuera de su propio dominio.
// Necesita también al menos un `Skin` ya sembrado en el deployment
// (`createCalendarPublic` resuelve un skin por defecto si no se le pasa
// uno, TAL-12 — pero necesita que exista alguno).
//
// Ejecutar desde la raíz del worktree:
//   set -a && source .env.local && set +a && node scripts/verify-tal15-superadmin.mjs
//
// Crea y borra datos de prueba propios (emails verify-tal15-*@example.com)
// en el deployment de desarrollo — no toca nada existente.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

const run = promisify(execFile);
const url = process.env.NEXT_PUBLIC_CONVEX_URL;
const secret = process.env.CONVEX_APP_SERVER_SECRET;
if (!url || !secret) {
  console.error("Faltan NEXT_PUBLIC_CONVEX_URL y/o CONVEX_APP_SERVER_SECRET en el entorno.");
  process.exit(1);
}
const client = new ConvexHttpClient(url);

async function convexRun(fn, argsObj) {
  const { stdout } = await run("npx", ["convex", "run", fn, JSON.stringify(argsObj)], { cwd: process.cwd() });
  return stdout
    .split("\n")
    .filter((l) => l.trim() && !l.includes("Warning") && !l.includes("trace-warnings"))
    .join("\n")
    .trim()
    .replace(/^"|"$/g, "");
}

function assert(cond, message) {
  if (!cond) throw new Error(`VIOLACION: ${message}`);
}

async function main() {
  const tag = process.pid;

  // --- Preparación: actores y datos de prueba ---
  const superAdminId = await client.mutation(api.users.upsertUserOnLoginPublic, {
    serverSecret: secret,
    email: `verify-tal15-superadmin-${tag}@example.com`,
    isSuperAdminOnCreate: true,
  });
  const normalActorId = await client.mutation(api.users.upsertUserOnLoginPublic, {
    serverSecret: secret,
    email: `verify-tal15-normal-${tag}@example.com`,
  });

  const calendarA = await client.mutation(api.calendars.createCalendarPublic, {
    serverSecret: secret,
    userId: superAdminId,
    name: `TAL-15 evidencia A ${tag}`,
    coverTitle: "x",
    startDate: "2099-01-01",
    endDate: "2099-01-31",
    creationKey: `tal15-evidence-a-${tag}`,
  });
  const calendarB = await client.mutation(api.calendars.createCalendarPublic, {
    serverSecret: secret,
    userId: superAdminId,
    name: `TAL-15 evidencia B ${tag}`,
    coverTitle: "x",
    startDate: "2000-01-01",
    endDate: "2000-01-31",
    creationKey: `tal15-evidence-b-${tag}`,
  });

  const guest1Id = await client.mutation(api.users.upsertUserOnLoginPublic, {
    serverSecret: secret,
    email: `verify-tal15-guest1-${tag}@example.com`,
  });
  const noInvId = await client.mutation(api.users.upsertUserOnLoginPublic, {
    serverSecret: secret,
    email: `verify-tal15-noinv-${tag}@example.com`,
  });

  // Membership GUEST de guest1 en A + invitación viva (para el ascenso y
  // para el camino "degradar a GUEST" de removeAdminEverywhere) — vía CLI,
  // `addMembership`/`inviteGuest` son internal (TAL-9, fuera del dominio
  // de esta tarea).
  await convexRun("calendarMemberships:addMembership", { calendarId: calendarA, userId: guest1Id, role: "GUEST" });
  await convexRun("invitations:inviteGuest", { calendarId: calendarA, email: `verify-tal15-guest1-${tag}@example.com` });
  // noInv, ADMIN de B, SIN invitación (para el camino "borrar membership").
  await convexRun("calendarMemberships:addMembership", { calendarId: calendarB, userId: noInvId, role: "ADMIN" });

  // Un día + 2 vistas de 2 usuarios distintos sobre A, para viewedCount.
  const dayId = await convexRun("days:upsertDay", {
    calendarId: calendarA,
    date: "2099-01-05",
    videoUrl: "https://example.com/v.mp4",
  });
  await convexRun("dayViews:markViewed", { dayId, userId: guest1Id });
  await convexRun("dayViews:markViewed", { dayId, userId: noInvId });

  // --- 1. Las cinco funciones rechazan a un actor que no es Super Admin ---
  const rejections = await Promise.allSettled([
    client.query(api.superadmin.listCalendarsWithStatsPublic, { serverSecret: secret, actorUserId: normalActorId, now: "2050-01-01" }),
    client.query(api.superadmin.listAdminsPublic, { serverSecret: secret, actorUserId: normalActorId }),
    client.query(api.superadmin.listCalendarOptionsPublic, { serverSecret: secret, actorUserId: normalActorId }),
    client.mutation(api.superadmin.addAdminPublic, { serverSecret: secret, actorUserId: normalActorId, calendarId: calendarA, email: "x@example.com" }),
    client.mutation(api.superadmin.removeAdminEverywherePublic, { serverSecret: secret, actorUserId: normalActorId, userId: noInvId }),
  ]);
  const rejectedCount = rejections.filter((r) => r.status === "rejected").length;
  assert(rejectedCount === 5, `se esperaba que las 5 llamadas con actor normal fueran rechazadas, lo fueron ${rejectedCount}/5`);
  console.log("OK: las 5 funciones rechazan a un actor que no es Super Admin");

  // --- 2. listCalendarsWithStats: status/daysCount/invitedCount/viewedCount reales ---
  const calendars = await client.query(api.superadmin.listCalendarsWithStatsPublic, {
    serverSecret: secret,
    actorUserId: superAdminId,
    now: "2050-01-01",
  });
  const calA = calendars.find((c) => c.id === calendarA);
  const calB = calendars.find((c) => c.id === calendarB);
  assert(calA, "el calendario A no aparece en listCalendarsWithStats");
  assert(calB, "el calendario B no aparece en listCalendarsWithStats");
  assert(calA.status === "upcoming", `status de A debía ser "upcoming", fue "${calA.status}"`);
  assert(calB.status === "finished", `status de B debía ser "finished", fue "${calB.status}"`);
  assert(calA.daysCount === 1, `daysCount de A debía ser 1, fue ${calA.daysCount}`);
  assert(calA.invitedCount === 1, `invitedCount de A debía ser 1, fue ${calA.invitedCount}`);
  assert(calA.viewedCount === 2, `viewedCount de A debía ser 2 (2 vistas de 2 usuarios distintos), fue ${calA.viewedCount}`);
  console.log(`OK: listCalendarsWithStats — status upcoming/finished, daysCount=${calA.daysCount}, invitedCount=${calA.invitedCount}, viewedCount=${calA.viewedCount}`);

  // --- 3. addAdmin: email inválido, y ascenso real GUEST->ADMIN ---
  const invalidEmailResult = await client.mutation(api.superadmin.addAdminPublic, {
    serverSecret: secret,
    actorUserId: superAdminId,
    calendarId: calendarA,
    email: "no-es-un-email",
  });
  assert(invalidEmailResult.ok === false && invalidEmailResult.error === "invalid-email", `addAdmin con email inválido debía devolver invalid-email, devolvió ${JSON.stringify(invalidEmailResult)}`);
  console.log("OK: addAdmin rechaza email inválido");

  const promoted = await client.mutation(api.superadmin.addAdminPublic, {
    serverSecret: secret,
    actorUserId: superAdminId,
    calendarId: calendarA,
    email: `verify-tal15-guest1-${tag}@example.com`,
  });
  assert(promoted.ok === true, `addAdmin no pudo ascender a guest1, devolvió ${JSON.stringify(promoted)}`);
  const adminsAfterPromote = await client.query(api.superadmin.listAdminsPublic, { serverSecret: secret, actorUserId: superAdminId });
  assert(
    adminsAfterPromote.some((a) => a.email === `verify-tal15-guest1-${tag}@example.com`),
    "guest1 no aparece como Admin tras addAdmin"
  );
  console.log("OK: addAdmin asciende a un GUEST ya invitado a ADMIN");

  // --- 4. removeAdminEverywhere: los dos caminos reales ---
  await client.mutation(api.superadmin.removeAdminEverywherePublic, { serverSecret: secret, actorUserId: superAdminId, userId: guest1Id });
  await client.mutation(api.superadmin.removeAdminEverywherePublic, { serverSecret: secret, actorUserId: superAdminId, userId: noInvId });

  const adminsAfterRemove = await client.query(api.superadmin.listAdminsPublic, { serverSecret: secret, actorUserId: superAdminId });
  assert(!adminsAfterRemove.some((a) => a.email.includes(`guest1-${tag}`)), "guest1 sigue apareciendo como Admin tras removeAdminEverywhere");
  assert(!adminsAfterRemove.some((a) => a.email.includes(`noinv-${tag}`)), "noInv sigue apareciendo como Admin tras removeAdminEverywhere");
  console.log("OK: removeAdminEverywhere — guest1 (con invitación viva) y noInv (sin invitación) ya no son Admin");

  // Confirmación directa de los dos caminos, inspeccionando la tabla real
  // (`npx convex data`, mismo mecanismo usado a mano durante el
  // desarrollo de esta tarea): guest1 (invitación viva) debe seguir
  // teniendo una fila `calendarMemberships` en A con role GUEST
  // (degradado, no borrado); noInv (sin invitación) no debe tener
  // ninguna fila en B (borrada por completo).
  const membershipRows = (await run("npx", ["convex", "data", "calendarMemberships", "--format", "jsonLines", "--limit", "5000"], { cwd: process.cwd() })).stdout
    .split("\n")
    .filter((l) => l.trim().startsWith("{"))
    .map((l) => JSON.parse(l));
  const guest1Row = membershipRows.find((r) => r.userId === guest1Id && r.calendarId === calendarA);
  const noInvRow = membershipRows.find((r) => r.userId === noInvId && r.calendarId === calendarB);
  assert(guest1Row && guest1Row.role === "GUEST", `guest1 debía seguir con una membership GUEST en A (invitación viva), se encontró: ${JSON.stringify(guest1Row)}`);
  assert(!noInvRow, `noInv debía haber perdido su membership en B por completo (sin invitación), pero sigue existiendo: ${JSON.stringify(noInvRow)}`);
  console.log("OK: camino 'degradar a GUEST' (guest1, invitación viva) y camino 'borrar membership' (noInv, sin invitación) confirmados en la tabla real");

  // Limpieza (los calendarios de prueba; usuarios y membresías/invitación
  // de prueba se dejan, mismo criterio que TAL-12/scripts/verify-tal12-delete-concurrency.mjs).
  await client.mutation(api.calendars.deleteCalendarAsUserPublic, { serverSecret: secret, calendarId: calendarA, userId: superAdminId });
  await client.mutation(api.calendars.deleteCalendarAsUserPublic, { serverSecret: secret, calendarId: calendarB, userId: superAdminId });

  console.log("DONE");
}

main().catch((err) => {
  console.error("ERROR:", err);
  process.exit(1);
});
