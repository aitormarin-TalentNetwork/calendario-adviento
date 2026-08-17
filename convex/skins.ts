import { internalMutation, internalQuery, query, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { requireServerSecret } from "./serverAuth";

type SkinSeed = {
  key: string;
  name: string;
  description?: string;
  background: string;
  accent: string;
};

// Equivalente al seed idempotente de prisma/seed.ts (upsert por `key`).
// internalMutation, no mutation — ver docs/convex-modelo-de-datos.md §
// "Sin autenticación/autorización todavía".
//
// TAL-22 — pasa a ser un upsert de verdad (inserta si no existe, o
// actualiza `name`/`description`/`background`/`accent` si ya existe) en
// vez de "inserta si no existe, si no ignora". El comentario original ya
// lo llamaba "upsert" (equivalente al seed idempotente de Prisma, que sí
// actualizaba campos), pero el código solo hacía la mitad. Hacía falta
// para esta tarea: los 4 skins originales (Dorado/Grosella/Medianoche/
// Pino) ya existen en algunos deployments con el shape antiguo (sin
// `background`/`accent`) — con el "ignora si existe" de antes, volver a
// sembrar el catálogo completo nunca les habría añadido el color. Sin
// riesgo para otros llamadores: `createSkin` es una `internalMutation`
// exclusiva de seed (CLI), ningún código de aplicación la invoca.
async function upsertSkinHandler(ctx: MutationCtx, args: SkinSeed) {
  const existing = await ctx.db
    .query("skins")
    .withIndex("by_key", (q) => q.eq("key", args.key))
    .unique();
  if (existing) {
    await ctx.db.patch(existing._id, {
      name: args.name,
      description: args.description,
      background: args.background,
      accent: args.accent,
    });
    return existing._id;
  }
  return await ctx.db.insert("skins", args);
}

export const createSkin = internalMutation({
  args: {
    key: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    background: v.string(),
    accent: v.string(),
  },
  handler: upsertSkinHandler,
});

/**
 * TAL-43 — migración de un solo uso, deployment de producción
 * (`abundant-badger-144`). Producción tiene los 4 skins originales del
 * MVP con `key` en INGLÉS (`pine`/`berry`/`midnight`/`gold` — el shape de
 * antes de TAL-22), mientras que `SKIN_CATALOG` de abajo (y
 * `resolveDefaultSkinId`, `convex/calendars.ts`, ya desde TAL-30) usan
 * `key` en ESPAÑOL para esas mismas 4 filas (`pino`/`grosella`/
 * `medianoche`/`dorado`). `upsertSkinHandler` hace upsert POR `key` — si
 * se corriera `seedSkinCatalog` contra producción sin migrar antes,
 * NO encontraría las 4 filas legacy (claves distintas) y las duplicaría
 * en vez de repararlas, dejando las 4 originales huérfanas y sin color.
 *
 * Esta mutation SOLO renombra el campo `key` de esas 4 filas — nunca
 * toca `_id` (calendarios ya creados en producción referencian esos
 * `_id` como `skinId`; cambiar el `_id` los rompería) ni `name` (ya
 * está en español en producción, `{key: "pine", name: "Pino"}` — el
 * mismatch es solo de `key`). Orden obligatorio: correr ESTA mutation
 * PRIMERO, después `seedSkinCatalog` — así el upsert encuentra las 4
 * filas ya renombradas por `key` y las parchea con `background`/
 * `accent` en vez de insertarlas de nuevo.
 *
 * Idempotente: una fila sin su `key` legacy correspondiente ya presente
 * (porque no existe en este deployment, o porque ya se migró) no se
 * toca — una segunda ejecución no escribe nada.
 *
 * Corre por CLI (`npx convex run skins:migrateLegacySkinKeysToSpanish
 * '{}'` contra el deployment que corresponda, nunca desde código de
 * aplicación) — mismo canal que `backfillEmbeddedCoverIcon`
 * (`convex/calendars.ts`, TAL-23) para el otro precedente de migración
 * de datos históricos de este proyecto. **Diseñada y verificada aquí
 * (deployment de dev de esta terminal); la ejecución contra producción
 * la decide y la corre la Directora con el CEO — no esta terminal.**
 */
const LEGACY_SKIN_KEY_TRANSLATIONS: Record<string, string> = {
  pine: "pino",
  berry: "grosella",
  midnight: "medianoche",
  gold: "dorado",
};

async function migrateLegacySkinKeysToSpanishHandler(
  ctx: MutationCtx
): Promise<{
  renamed: number;
  alreadyMigrated: number;
  neverExisted: number;
  skippedTargetKeyCollision: number;
}> {
  let renamed = 0;
  let alreadyMigrated = 0;
  let neverExisted = 0;
  let skippedTargetKeyCollision = 0;

  for (const [legacyKey, spanishKey] of Object.entries(LEGACY_SKIN_KEY_TRANSLATIONS)) {
    const legacyRow = await ctx.db
      .query("skins")
      .withIndex("by_key", (q) => q.eq("key", legacyKey))
      .unique();
    const spanishRow = await ctx.db
      .query("skins")
      .withIndex("by_key", (q) => q.eq("key", spanishKey))
      .unique();

    if (!legacyRow) {
      if (spanishRow) alreadyMigrated++;
      else neverExisted++;
      continue;
    }
    if (spanishRow) {
      // Las dos filas existen a la vez (p. ej. `seedSkinCatalog` ya se
      // corrió antes que esta migración, insertando la fila en español
      // como duplicada) — renombrar aquí colisionaría por `key` (no es
      // una restricción única a nivel de schema, pero `.unique()` en
      // `upsertSkinHandler`/`resolveDefaultSkinId` reventaría en cuanto
      // alguien vuelva a consultar por esa `key`). Se deja sin tocar,
      // señalado en el resultado, para resolución manual — no es un caso
      // que esta migración deba intentar arreglar sola.
      skippedTargetKeyCollision++;
      continue;
    }
    await ctx.db.patch(legacyRow._id, { key: spanishKey });
    renamed++;
  }

  return { renamed, alreadyMigrated, neverExisted, skippedTargetKeyCollision };
}

export const migrateLegacySkinKeysToSpanish = internalMutation({
  args: {},
  handler: migrateLegacySkinKeysToSpanishHandler,
});

/**
 * TAL-22 — catálogo completo (originalmente 22 skins: los 4 del MVP + los
 * 18 nuevos validados con Aitor, design/design-system.md § "Skins"; 23 con
 * "Tira Cómica" (TAL-38), ahora 24 con "Rojiblanco" (TAL-48) — mismo
 * mecanismo, sin UI de gestión). Un
 * solo `npx convex run skins:seedSkinCatalog '{}'` puebla o actualiza
 * todas las filas de una vez — idempotente vía `upsertSkinHandler`
 * (converge al mismo estado sin importar si las filas ya existían con
 * datos parciales o no existían en absoluto). Añadir un skin nuevo sigue
 * siendo por script/CLI, no UI — decisión ya cerrada en
 * design-system.md § "Skins" → "Arquitectura".
 *
 * Fuente de los 18 nuevos: `design/propuesta-skins.html` (valores CSS
 * reales del prototipo validado — `background`/`accent` tomados
 * literalmente de ahí, no reinterpretados). Los que partían de una
 * referencia con copyright ya vienen resueltos como genéricos en el
 * propio prototipo (regla dura de marca registrada, ver comentarios por
 * skin abajo) — no se ha añadido ningún logo/nombre/personaje protegido.
 *
 * Fuente de los 4 originales (Dorado/Grosella/Medianoche/Pino): no
 * tenían valores de color en ningún sitio ("hoy no los tienen", brief de
 * esta tarea) — sus propios nombres ya nombran directamente cuatro
 * tokens del Design System (`--gold`, `--berry`, un pine casi negro tipo
 * "medianoche", `--pine`), así que se derivan de ahí en vez de
 * inventar hex sin fuente. Judgment call documentado, no bloqueante:
 * TAL-24 (aplicación visual real) todavía no existe, así que un ajuste
 * futuro de estos 4 valores concretos es un cambio de datos de una fila,
 * no de schema ni de lógica.
 */
const SKIN_CATALOG: SkinSeed[] = [
  // --- Los 4 originales del MVP — derivados de los tokens del Design
  // System que ya llevan su nombre (ver comentario de arriba). ---
  {
    key: "dorado",
    name: "Dorado",
    description: "El clásico del MVP — degradado cálido de oro, elegante y luminoso.",
    background: "linear-gradient(160deg, #c99a3d 0%, #e3bb63 100%)",
    accent: "#1b3a2f",
  },
  {
    key: "grosella",
    name: "Grosella",
    description: "El clásico del MVP — rojo grosella profundo con acento dorado.",
    background: "linear-gradient(160deg, #8c2f39 0%, #4a1319 100%)",
    accent: "#c99a3d",
  },
  {
    key: "medianoche",
    name: "Medianoche",
    description: "El clásico del MVP — pine casi negro, sobrio y nocturno.",
    background: "linear-gradient(160deg, #0f1e17 0%, #1b3a2f 100%)",
    accent: "#e3bb63",
  },
  {
    key: "pino",
    name: "Pino",
    description: "El clásico del MVP — verde pino natural con acento dorado.",
    background: "linear-gradient(160deg, #234a3b 0%, #1b3a2f 100%)",
    accent: "#c99a3d",
  },

  // --- 18 nuevos — valores CSS literales de design/propuesta-skins.html. ---
  {
    key: "nochebuena",
    name: "Nochebuena",
    description: "El clásico navideño, pero elegante — profundo y cálido, con acentos de oro.",
    background:
      "radial-gradient(ellipse at 30% 20%, rgba(201,154,61,0.25), transparent 55%), linear-gradient(160deg, #4a1319 0%, #1b3a2f 100%)",
    accent: "#c99a3d",
  },
  {
    key: "nieve",
    name: "Nieve",
    description: "Invierno genérico y luminoso, no depende de la Navidad en concreto.",
    background: "linear-gradient(160deg, #cfe3ee 0%, #eef5f8 55%, #ffffff 100%)",
    accent: "#4a7f9c",
  },
  {
    key: "confeti",
    name: "Confeti",
    description: "Retro y desenfadado — rayos tipo sunburst, sin tema fijo, para cumpleaños/aniversarios.",
    background:
      "conic-gradient(from 0deg at 20% 15%, #f2a6d8 0deg 40deg, #7c5cbf 40deg 80deg, #f4805c 80deg 120deg, #7c5cbf 120deg 160deg, #f4c542 160deg 200deg, #7c5cbf 200deg 240deg, #f2a6d8 240deg 280deg, #7c5cbf 280deg 320deg, #f4805c 320deg 360deg), #7c5cbf",
    accent: "#f4c542",
  },
  {
    key: "dorado-real",
    name: "Dorado Real",
    description: "Negro + oro foil, elegante — bodas, aniversarios de empresa, gala.",
    background: "linear-gradient(160deg, #0c0c0c 0%, #1a1512 100%)",
    accent: "#e3bb63",
  },
  {
    key: "bosque-nordico",
    name: "Bosque Nórdico",
    description: "Acogedor y artesanal, tipo papel/madera — para algo íntimo (familia, amigos).",
    background: "linear-gradient(160deg, #e7e0cf 0%, #d8cdaf 100%)",
    accent: "#a9714a",
  },
  {
    key: "neon-fiesta",
    name: "Neón Fiesta",
    description: "Moderno y gamberro — Fin de Año, cumpleaños de equipo, energía y color.",
    background: "linear-gradient(160deg, #0d0221 0%, #1a0b3d 100%)",
    accent: "#ff2e88",
  },
  {
    // Genérico, sin personajes con copyright (marca registrada — ver
    // brief item 3 y design-system.md § "Skins" → "Marcas registradas").
    key: "historieta",
    name: "Historieta",
    description: "Cómic clásico — contorno grueso, tramado de puntos, colores primarios.",
    background: "radial-gradient(circle, #1a1a1a 1.2px, transparent 1.2px) 0 0 / 10px 10px, #ffd23f",
    accent: "#e63946",
  },
  {
    key: "enamorados",
    name: "Enamorados",
    description: "San Valentín, aniversario de pareja — rosa suave con acentos rojos.",
    background:
      "radial-gradient(ellipse at 70% 20%, rgba(255,255,255,0.3), transparent 55%), linear-gradient(160deg, #d94f6b 0%, #f7c9d4 100%)",
    accent: "#8c2f39",
  },
  {
    // Genérico, sin branding de ninguna serie concreta.
    key: "oficina",
    name: "Oficina",
    description: "Humor de oficina genérico — tonos caqui/beige, sin branding de ninguna serie.",
    background: "linear-gradient(160deg, #d9d2bd 0%, #b9ae90 100%)",
    accent: "#a89b74",
  },
  {
    // Genérico, sin ningún personaje con copyright.
    key: "superheroe",
    name: "Superhéroe",
    description: "Energético, colores primarios de cómic de acción — sin personajes protegidos.",
    background: "linear-gradient(160deg, #1a3ba8 0%, #0b1b4a 100%)",
    accent: "#ffd23f",
  },
  {
    key: "bebe",
    name: "Bebé",
    description: "Primer año, cuenta atrás de embarazo, baby shower — pasteles muy suaves.",
    background: "linear-gradient(160deg, #dff0f7 0%, #fde7ef 100%)",
    accent: "#aed9e8",
  },
  {
    key: "adolescente",
    name: "Adolescente",
    description: "Degradado atrevido tipo Y2K/sticker — para quinceañeras, cumpleaños de instituto.",
    background: "linear-gradient(150deg, #6d28d9 0%, #db2777 55%, #f97316 100%)",
    accent: "#f97316",
  },
  {
    key: "memorias-de-familia",
    name: "Memorias de Familia",
    description: "Tonos cálidos de álbum de fotos antiguo — para recuerdos compartidos.",
    background: "linear-gradient(160deg, #e8dcc4 0%, #c9b78f 100%)",
    accent: "#c9b78f",
  },
  {
    key: "amigas",
    name: "Amigas",
    description: "Colorido y desenfadado — despedidas, viajes de amigas, cumpleaños de grupo.",
    background: "linear-gradient(135deg, #ffb3c6 0%, #c9a7f5 50%, #a0e7d4 100%)",
    accent: "#c9a7f5",
  },
  {
    key: "kpop",
    name: "K-pop",
    description: "Degradado holográfico tipo photocard — sin logos ni imágenes de grupos concretos.",
    background: "linear-gradient(120deg, #ff9ecf 0%, #b19cff 30%, #7ee8fa 60%, #ffd1ff 100%)",
    accent: "#b19cff",
  },
  {
    key: "gotico",
    name: "Gótico",
    description: "Oscuro y dramático — para quien quiere algo bien distinto de festivo alegre.",
    background: "linear-gradient(160deg, #0a0a0c 0%, #1c1622 100%)",
    accent: "#8c2f39",
  },
  {
    // Genérico, sin logos de liga ni equipo concreto.
    key: "baloncesto",
    name: "Baloncesto",
    description: "Colores de cancha (naranja/negro/blanco) — sin logos de liga ni equipo.",
    background: "linear-gradient(160deg, #b3541e 0%, #7a3610 100%)",
    accent: "#1a1a1a",
  },
  {
    // Genérico ("colores azulgrana genéricos, no escudo/nombre del
    // Barça" — design-system.md § "Skins" → "Marcas registradas").
    key: "futbol",
    name: "Fútbol",
    description: "Rayas de colores de equipo, sin escudo ni nombre de club — inspirado libremente.",
    background: "repeating-linear-gradient(90deg, #1a2a6c 0 22px, #8c2f39 22px 44px)",
    accent: "#8c2f39",
  },

  // --- Skin #23 — pedido explícito de Aitor (TAL-38, 2026-08-17), fuera
  // del catálogo inicial de 22 validado el 2026-08-16. Aitor va a subir su
  // propia foto de portada (un personaje de cómic con derechos de autor
  // que él tiene derecho a usar) y quiere un skin cuyos colores combinen
  // con ella — el skin en sí no reproduce ni nombra esa IP, mismo criterio
  // que "Historieta"/"Superhéroe" arriba. `background` es exactamente el
  // degradado sutil pedido (sin textura, a diferencia de "Historieta").
  // El schema solo admite UN `accent` (un hex) y ningún campo de
  // contorno/borde — de los 4 elementos de color del brief (rojo, azul,
  // amarillo, contorno negro grueso) solo el rojo tiene dónde sembrarse
  // (`accent: "#e63946"`, mismo criterio que "Historieta"). Azul, amarillo
  // y el contorno negro NO quedan representados en ningún dato de esta
  // fila — quedan pendientes como dirección visual para quien trabaje el
  // frontend de esta skin en el futuro, fuera de alcance de esta tarea.
  {
    key: "tira-comica",
    name: "Tira Cómica",
    description:
      "Colores vivos de cómic clásico — rojo, azul y amarillo con contorno negro, sobre fondo claro. Pensado para combinar con una foto de portada propia.",
    background: "linear-gradient(160deg, #fdf8ec 0%, #ffffff 100%)",
    accent: "#e63946",
  },

  // --- Skin #24 — pedido explícito de Aitor (TAL-48, 2026-08-17). Rayas
  // rojo/blanco tipo camiseta de fútbol — misma regla dura de marcas que
  // el resto del catálogo (colores genéricos inspirados libremente, sin
  // nombre de club/ciudad/escudo/liga concreta), mismo criterio ya
  // aplicado a "Fútbol" arriba. Sin `textColor`: este skin entra en el
  // grupo de "difíciles" del catálogo de TAL-47 (rayas alternas, ningún
  // color de texto plano funciona sobre las dos a la vez) — lleva
  // tratamiento de "píldora de fondo" en vez de `textColor`, que
  // construye T1 como parte de TAL-47 (coordinado con la Directora antes
  // de sembrar esta fila, 2026-08-17 — el campo `textColor` en sí todavía
  // no existe en el schema en el momento de este commit).
  {
    key: "rojiblanco",
    name: "Rojiblanco",
    description: "Rayas verticales de camiseta de fútbol clásica, rojo y blanco — sin escudo ni nombre de equipo.",
    background: "repeating-linear-gradient(90deg, #d61f26 0 20px, #ffffff 20px 40px)",
    accent: "#1a1a1a",
  },
];

export const seedSkinCatalog = internalMutation({
  args: {},
  handler: async (ctx) => {
    const ids = [];
    for (const skin of SKIN_CATALOG) {
      ids.push(await upsertSkinHandler(ctx, skin));
    }
    return ids;
  },
});

export const getByKey = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, args) =>
    ctx.db
      .query("skins")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique(),
});

/**
 * TAL-12 — catálogo completo, para el selector de skin del formulario de
 * edición de calendario (`src/app/admin/[calendarId]/page.tsx`). Catálogo
 * fijo y pequeño (unas pocas filas) — `.collect()` sin índice es
 * suficiente, mismo criterio que `resolveDefaultSkinId` en
 * `convex/calendars.ts`. Frontera pública con secreto compartido, mismo
 * patrón que el resto de TAL-11/TAL-12 (`convex/serverAuth.ts`).
 */
export const listAllPublic = query({
  args: { serverSecret: v.string() },
  handler: async (ctx, args) => {
    await requireServerSecret(args.serverSecret);
    return await ctx.db.query("skins").collect();
  },
});
