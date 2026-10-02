import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// TAL-67 — arranca el drenaje del limpiador de ficheros de la casilla
// "Visto" (`dayFiles.ts::startReconcile`). Si ya hay un drenaje vivo (lease),
// no hace nada; si la cadena murió, el watchdog suele tomar el relevo antes.
// Objetivo medido: ≤ 90 min desde la intención (docs/dias.md).
crons.interval("tal67-reconcile-day-files", { minutes: 15 }, internal.dayFiles.startReconcile);

export default crons;
