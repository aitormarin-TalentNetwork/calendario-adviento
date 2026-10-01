import path from "node:path";
import { config } from "dotenv";

/**
 * Mismas variables que usa la app en local: `.env.local` (Convex de la
 * terminal, `CONVEX_APP_SERVER_SECRET`) y después `.env` (`AUTH_SECRET`,
 * `AUTH_DEV_LOGIN`). dotenv no pisa lo que ya venga del entorno.
 */
const root = path.resolve(__dirname, "..", "..");
config({ path: path.join(root, ".env.local"), quiet: true });
config({ path: path.join(root, ".env"), quiet: true });
