// TAL-82 — ayuda SOLO de tests en dev: confirma que `CONVEX_CLOUD_URL` llega
// al runtime de las funciones (la segunda condición de la barrera de
// `./lib/testHelpers`). Pasa a su vez por la barrera, así que en producción
// lanza error. Se retira con las demás ayudas de TAL-82 en el paso 3.
import { internalQuery } from "./_generated/server";
import { assertTestHelpersAllowed } from "./lib/testHelpers";

export const whereAmIForTests = internalQuery({
  args: {},
  handler: async (): Promise<{ host: string }> => {
    assertTestHelpersAllowed();
    return { host: new URL(process.env.CONVEX_CLOUD_URL ?? "").hostname };
  },
});
