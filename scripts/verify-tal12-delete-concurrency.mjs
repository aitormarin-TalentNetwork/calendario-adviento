// Evidencia de auditoría — TAL-12 (CRUD de Calendario sobre Convex),
// ronda 3: verifica que `calendars.deleteCalendarAsUser` resuelve
// existencia + autorización + borrado en una única mutation atómica bajo
// concurrencia REAL (procesos del sistema operativo separados vía
// `npx convex run`, no `Promise.all` dentro de un mismo proceso Node, que
// podría intercalar de forma menos representativa — mismo rigor que las
// pruebas de concurrencia de TAL-9).
//
// No forma parte de la aplicación — script de verificación puntual,
// guardado versionado a petición del auditor (ronda 3) para que la
// evidencia se pueda re-ejecutar, no solo leer en texto. Necesita
// NEXT_PUBLIC_CONVEX_URL y CONVEX_APP_SERVER_SECRET en el entorno (los
// mismos de `.env.local`/`npx convex env get`). Ejecutar desde la raíz
// del worktree:
//
//   set -a && source .env.local && set +a && node scripts/verify-tal12-delete-concurrency.mjs
//
// Crea y borra datos de prueba propios (emails verify-tal12-*@example.com)
// en el deployment de desarrollo — no toca nada existente.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

const run = promisify(execFile);
const url = process.env.NEXT_PUBLIC_CONVEX_URL;
const goodSecret = process.env.CONVEX_APP_SERVER_SECRET;
if (!url || !goodSecret) {
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
    .trim();
}

async function main() {
  const adminId = await client.mutation(api.users.upsertUserOnLoginPublic, {
    serverSecret: goodSecret,
    email: "verify-tal12-concurrency-admin@example.com",
  });
  const strangerId = await client.mutation(api.users.upsertUserOnLoginPublic, {
    serverSecret: goodSecret,
    email: "verify-tal12-concurrency-stranger@example.com",
  });

  const TRIALS = 8;
  const CONCURRENCY = 6;
  let anyUnauthorizedForAdmin = false;

  for (let trial = 1; trial <= TRIALS; trial++) {
    const calendarId = await client.mutation(api.calendars.createCalendarPublic, {
      serverSecret: goodSecret,
      userId: adminId,
      name: `race ${trial}`,
      coverTitle: "x",
      startDate: "2026-12-01",
      endDate: "2026-12-24",
      creationKey: `tal12-race-${trial}-${process.pid}-${trial}`,
    });

    const calls = Array.from({ length: CONCURRENCY }, () =>
      convexRun("calendars:deleteCalendarAsUser", { calendarId, userId: adminId })
    );
    const results = (await Promise.all(calls)).map((r) => r.replace(/"/g, ""));
    const deleted = results.filter((r) => r === "deleted").length;
    const alreadyGone = results.filter((r) => r === "already-gone").length;
    const unauthorized = results.filter((r) => r === "unauthorized").length;
    console.log(`trial ${trial}: deleted=${deleted} already-gone=${alreadyGone} unauthorized=${unauthorized}`);

    if (unauthorized > 0) anyUnauthorizedForAdmin = true;
    if (deleted !== 1) throw new Error(`VIOLACION: se esperaba exactamente 1 "deleted" en el trial ${trial}, hubo ${deleted}`);
    if (deleted + alreadyGone !== CONCURRENCY) throw new Error(`VIOLACION: el total no cuadra en el trial ${trial}`);

    const stillThere = await client.query(api.calendars.getPublic, { serverSecret: goodSecret, calendarId });
    if (stillThere !== null) throw new Error(`VIOLACION: el calendario del trial ${trial} sigue existiendo tras el borrado concurrente`);
  }

  if (anyUnauthorizedForAdmin) {
    throw new Error('VIOLACION: el Admin real recibió "unauthorized" en alguna ronda de concurrencia real');
  }
  console.log(`OK: ${TRIALS}/${TRIALS} rondas de concurrencia real (${CONCURRENCY} procesos por ronda) sin ningún "unauthorized" para el Admin real, exactamente 1 "deleted" por ronda`);

  // Control: un stranger sin membership, contra un calendario real, sigue "unauthorized".
  const controlCalendarId = await client.mutation(api.calendars.createCalendarPublic, {
    serverSecret: goodSecret,
    userId: adminId,
    name: "control",
    coverTitle: "x",
    startDate: "2026-12-01",
    endDate: "2026-12-24",
    creationKey: `tal12-race-control-${process.pid}`,
  });
  const strangerResult = await client.mutation(api.calendars.deleteCalendarAsUserPublic, {
    serverSecret: goodSecret,
    calendarId: controlCalendarId,
    userId: strangerId,
  });
  console.log("stranger sobre calendario real:", strangerResult);
  if (strangerResult !== "unauthorized") {
    throw new Error("VIOLACION: un stranger sin membership consiguió afectar un calendario real");
  }
  const controlStillThere = await client.query(api.calendars.getPublic, { serverSecret: goodSecret, calendarId: controlCalendarId });
  if (controlStillThere === null) {
    throw new Error("VIOLACION: el calendario de control desapareció pese al 'unauthorized' del stranger");
  }
  console.log("OK: stranger correctamente rechazado, calendario de control intacto");

  // Limpieza.
  await client.mutation(api.calendars.deleteCalendarAsUserPublic, {
    serverSecret: goodSecret,
    calendarId: controlCalendarId,
    userId: adminId,
  });

  console.log("DONE");
}

main().catch((err) => {
  console.error("ERROR:", err);
  process.exit(1);
});
