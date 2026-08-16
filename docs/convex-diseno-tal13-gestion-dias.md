# Diseño / pseudocódigo — Gestión de Días sobre Convex (para TAL-13)

Fichero propio, no toca nada del worktree de T1. Pseudocódigo y firmas,
no implementación final — mismo criterio que TAL-12/TAL-15/TAL-16. Traduce
`src/app/admin/[calendarId]/days-actions.ts` + `days-section.tsx`
(versión Prisma, TAL-6, última ronda de auditoría — commit `738e15f`,
justo antes de que TAL-10 quitara Prisma del todo), leyendo el estado
real tras el merge de TAL-9/TAL-10 a `main` (`dadf17d`) y aplicando el
helper `convex/serverAuth.ts` del secreto compartido (mismo criterio que
TAL-12/TAL-15/TAL-16).

## Qué ya existe en TAL-9 y qué le falta

`convex/days.ts::upsertDay` ya existe y cubre la mitad principal:
idempotente por `(calendarId, date)`, valida formato de fecha
(`assertValidCalendarDate`) e integridad referencial + la invariante de
rango (fecha dentro de `[startDate, endDate]` del `Calendar` en ese
momento) — ya verificado por T1 como carrera real contra
`updateCalendarRange` (`docs/convex-modelo-de-datos.md` § "Invariante de
rango Calendar/Day", 25 repeticiones, 0 violaciones). **No existe
todavía**: `deleteDay`, ninguna query para listar los días de un
calendario (`listDaysForCalendar`), y `upsertDay` no valida `videoUrl`
(esquema/longitud) ni `message` (longitud) — eso vivía solo en
`days-actions.ts` del lado de Next.js (`parseVideoUrl`,
`MAX_VIDEO_URL_LENGTH`, `MAX_MESSAGE_LENGTH`).

## La invariante de rango, lado Day — ya cerrada por TAL-9, no hay hueco nuevo que abrir aquí

La pregunta que me pediste revisar con cuidado (qué falta del lado de
escritura de `Day`, análoga al trigger de Postgres) ya está resuelta:
`upsertDay` comprueba el rango en la misma mutation que escribe, y la
propia auditoría de TAL-9 ya probó la carrera real contra
`updateCalendarRange` (no solo cada mutation por separado) — exactamente
el nivel de rigor que TAL-16 todavía tiene pendiente para la carrera
expulsión-vs-aceptación. Para TAL-13 no hace falta repetir ese trabajo,
solo no perderlo: si `deleteDay` (nueva, abajo) alguna vez necesitara
tocar algo del `Calendar` además de `Day`, tendría que pasar por el mismo
cuidado — pero borrar un día no toca el rango del calendario en absoluto,
así que no reabre la pregunta.

## `videoUrl`/`message` — mismo tipo de hueco que ya vimos en TAL-16 con el email

`parseVideoUrl`/`MAX_VIDEO_URL_LENGTH`/`MAX_MESSAGE_LENGTH` (Prisma,
`days-actions.ts`) son validaciones de servidor reales (hallazgos de
auditoría TAL-6 ronda 1: solo `https:`, límite de longitud defensivo
contra filas absurdas) que hoy **no tienen ningún equivalente en
`upsertDay`** — igual que `inviteGuest` (TAL-9) no validaba el formato de
email hasta que lo señalé en el diseño de TAL-16. Mismo patrón, misma
recomendación: extender `upsertDay` con esta validación en vez de
confiar en que Next.js siempre la hace bien antes de llamar — no hay dos
semánticas en conflicto, solo una comprobación que falta.

```ts
// convex/days.ts — upsertDay, extendido
const MAX_VIDEO_URL_LENGTH = 2000;
const MAX_MESSAGE_LENGTH = 2000;

function assertValidVideoUrl(raw: string): void {
  if (raw.length > MAX_VIDEO_URL_LENGTH) {
    throw new Error(`La URL del vídeo no puede superar los ${MAX_VIDEO_URL_LENGTH} caracteres.`);
  }
  let parsed: URL;
  try { parsed = new URL(raw); } catch { throw new Error("El vídeo debe ser una URL válida."); }
  if (parsed.protocol !== "https:") {
    throw new Error("El vídeo debe ser una URL https:// — no se aceptan otros esquemas por seguridad.");
  }
}

export const upsertDay = internalMutation({
  args: { calendarId: v.id("calendars"), date: v.string(), videoUrl: v.string(), message: v.optional(v.string()) },
  handler: async (ctx, args) => {
    assertValidCalendarDate(args.date);              // ya existía
    assertValidVideoUrl(args.videoUrl);               // NUEVO
    if (args.message && args.message.length > MAX_MESSAGE_LENGTH) { // NUEVO
      throw new Error(`El mensaje no puede superar los ${MAX_MESSAGE_LENGTH} caracteres.`);
    }

    const calendar = await ctx.db.get(args.calendarId); // ya existía, resto sin cambios
    if (!calendar) throw new Error("El calendario ya no existe.");
    if (args.date < calendar.startDate || args.date > calendar.endDate) {
      throw new Error("Esa fecha no está dentro del rango del calendario.");
    }
    const existing = await ctx.db.query("days")
      .withIndex("by_calendar_and_date", q => q.eq("calendarId", args.calendarId).eq("date", args.date))
      .unique();
    if (existing) { await ctx.db.patch(existing._id, { videoUrl: args.videoUrl, message: args.message }); return existing._id; }
    return await ctx.db.insert("days", args);
  },
});
```

Nota honesta sobre el "por qué molestarse" si Next.js ya valida esto
antes de llamar: es el mismo argumento de siempre en esta serie
(`guests-actions.ts` confía en `isCalendarGuest`, pero cada capa de datos
ha ido ganando su propia validación en vez de confiar ciegamente en el
llamador) — el secreto compartido (TAL-11) prueba "esta llamada viene de
nuestro servidor", no "nuestro servidor validó todo correctamente" (son
cosas distintas, ya lo señalé en el cierre de TAL-11). No es un hallazgo
de seguridad crítico (el único llamador posible sigue siendo Next.js,
nunca un navegador directo, gracias al secreto) — es defensa en
profundidad barata, mismo criterio que aplicar `inviteGuest` en TAL-16.

### `deleteDay` — nueva, idempotente

```ts
export const deleteDay = internalMutation({
  args: { calendarId: v.id("calendars"), date: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("days")
      .withIndex("by_calendar_and_date", q => q.eq("calendarId", args.calendarId).eq("date", args.date))
      .unique();
    if (!existing) return; // idempotente — mismo criterio que el P2025 de Prisma: reenvío de un borrado ya hecho no es error
    await ctx.db.delete(existing._id);
  },
});
```

**Hueco real, no señalado todavía en ningún otro diseño de esta serie**:
si el `Day` que se borra tiene `dayViews` asociadas (alguien ya lo vio,
TAL-8), ¿qué pasa con esas filas? La versión Prisma no lo trataba de
forma especial — `onDelete: Cascade` en el schema se las llevaba por
delante automáticamente, sin que `deleteDayAction` tuviera que saberlo
siquiera. En Convex, igual que ya señaló TAL-9 para `deleteCalendar`
(TAL-12) y yo mismo repetí ahí, no hay cascade automático — `deleteDay`
tiene que borrar explícitamente las `dayViews` de ese día antes (o en la
misma mutation) que el propio `Day`:

```ts
export const deleteDay = internalMutation({
  args: { calendarId: v.id("calendars"), date: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("days")
      .withIndex("by_calendar_and_date", q => q.eq("calendarId", args.calendarId).eq("date", args.date))
      .unique();
    if (!existing) return;

    const views = await ctx.db.query("dayViews")
      .withIndex("by_day_and_user", q => q.eq("dayId", existing._id)).collect();
    for (const view of views) await ctx.db.delete(view._id);

    await ctx.db.delete(existing._id);
  },
});
```

**Pregunta de producto, no técnica, que no me corresponde decidir**: si
un Admin borra el vídeo de un día que un invitado ya vio, ¿debería
perderse también el "lo vio" (`DayView`)? La versión Prisma lo hacía así
solo porque `onDelete: Cascade` era la única opción declarativa
disponible, no porque nadie decidiera explícitamente que era lo
correcto — Convex, al exigir hacerlo a mano, obliga a que alguien lo
decida de verdad esta vez. Lo dejo como pregunta abierta explícita en vez
de asumir que "igual que antes" es automáticamente lo que se quiere.

### `listDaysForCalendar` — nueva, trivial

```ts
export const listDaysForCalendar = internalQuery({
  args: { calendarId: v.id("calendars") },
  handler: async (ctx, args) =>
    await ctx.db.query("days").withIndex("by_calendar_and_date", q => q.eq("calendarId", args.calendarId)).collect(),
});
```

Sin cambios de forma respecto a la consulta Prisma (`prisma.day.findMany({
where: { calendarId } })`) — la traducción más directa de todo este
documento.

## `MAX_MANAGEABLE_DAYS` (366) — se queda en Next.js, con una pregunta abierta sobre si debería reforzarse también en Convex

Es un límite defensivo de **renderizado**, no de datos — protege contra
generar un día por cada fecha de un rango absurdamente largo en cada
carga de `DaysSection` (hallazgo de auditoría TAL-6 ronda 1: DoS con una
sola petición autenticada). No se guarda en ningún sitio ni lo comprueba
ninguna mutation — ni en la versión Prisma (`saveDayAction` nunca lo
comprobaba, solo el renderizado de `DaysSection`) ni, por ahora, en la
Convex (`upsertDay`/`updateCalendarRange` tampoco). Al traducirse, sigue
siendo lógica de presentación en Next.js (mismo criterio que
`defaultCalendarDateRange`/`formatCalendarDate` en TAL-12: no necesita
vivir en `convex/*.ts`).

**Pregunta abierta que no estaba señalada en ningún diseño anterior**:
como el límite nunca se comprobó del lado de escritura (ni en Prisma ni
hoy en Convex), nada impide hoy — ni antes — llamar a `updateCalendarRange`
con un rango de siglos y luego llamar a `upsertDay` para fechas sueltas
dentro de él, sin que ninguna mutation lo rechace; solo la sección de
gestión de días se negaría a *mostrarse* con ese calendario. No es una
regresión de la migración (ya era así en Prisma), pero al estar tocando
`upsertDay`/`updateCalendarRange` en este mismo milestone, es un buen
momento para que alguien decida si merece la pena mover el límite (o una
versión de él) al propio `updateCalendarRange` (TAL-12) como defensa real
de datos, en vez de solo un aviso en el panel. No lo decido aquí — ni es
estrictamente parte de TAL-13 (tocaría TAL-12), solo lo dejo señalado
porque nadie lo había hecho todavía en esta serie.

## Frontera pública — mismo patrón que el resto de la serie

`upsertDay`, `deleteDay`, `listDaysForCalendar` necesitan cada una su
envoltorio público delgado con `serverSecret` (`convex/serverAuth.ts`) —
mismo pseudocódigo que TAL-12/TAL-15/TAL-16, no repetido aquí.

## Resumen para quien implemente TAL-13

1. Extender `upsertDay` (TAL-9) con validación de `videoUrl`/`message` —
   no crear una función paralela, mismo criterio que `inviteGuest` en
   TAL-16.
2. Escribir `deleteDay` con el borrado explícito de `dayViews`
   asociadas — y decidir (pregunta de producto, no mía) si borrar el
   vídeo de un día debe borrar también quién lo vio.
3. Escribir `listDaysForCalendar` — trivial, sin huecos.
4. `MAX_MANAGEABLE_DAYS` se queda en Next.js tal cual — pero considerar,
   junto con quien lleve TAL-12 si todavía hay margen, si merece una
   versión de este límite también como defensa de escritura en
   `updateCalendarRange`, no solo de renderizado. No bloqueante para
   TAL-13 en sí.

Con este documento quedan las cuatro tareas de negocio del milestone
(TAL-12, TAL-13, TAL-15, TAL-16) con diseño de partida. No adelanto más
diseño — a la espera de hueco real de implementación, según lo acordado.
