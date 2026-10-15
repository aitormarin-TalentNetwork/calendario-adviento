# Bienvenida con foto, login genérico y fondo tenue (TAL-70, TAL-85)

Normativo: `design/design-system.md` § "Bienvenida con foto (después de entrar) + imagen
de fondo tenue" y `design/propuesta-bienvenida.html`.

## Login genérico

`src/app/login/page.tsx` muestra el logo de la app (icono Lucide `CalendarDays` sobre
`--primary-soft`), "Calendario de Adviento", "Una sorpresa cada día." y "Entrar con
Google". No lee ningún calendario, tampoco con `callbackUrl`, que sigue decidiendo el
destino al entrar (`callbackUrl ?? "/start"`).

Se retiró `calendars.getPublicCoverInfoForLogin`, la única consulta a `calendars` sin
autenticar (TAL-25). **Despliegue:** Convex sale antes que Next. El Next anterior la
llamaba dentro de un `try/catch` que cae a su portada genérica, así que durante la ventana
su `/login` responde 200 sin portada, y entrar conserva el `callbackUrl`.

## Bienvenida al abrir `/c/<id>`

**TAL-85 — sale en CADA entrada al calendario**, no una vez al día (design-system.md
§ "Foto de portada visible en todas partes"). Basta con que el calendario tenga
`coverImageUrl` y que la foto cargue; ya no hace falta la cookie `tz` (sin ella sale
igual, sin la línea de la cuenta atrás). Si no hay foto, o no carga, no hay bienvenida.

**Qué es "entrar":**

- montar la página: carga completa (primera visita, recarga, enlace de invitación,
  otra pestaña) o venir de otra pantalla (`/c`, `/admin`, atrás/adelante);
- una navegación de cliente que acaba en el MISMO `/c/<id>` sin remontar la página: el
  enlace del menú de la cuenta al calendario actual, o `/c` → redirect al mismo
  calendario (un solo calendario).

**Qué NO es entrar:** abrir y cerrar el diálogo de un vídeo, el `router.refresh()` de
`TimezoneSync` y las server actions de la página (`markDayViewedAction`).

**Cómo se distingue** (`src/lib/navigation-entry.ts`, `welcome-overlay.tsx`), con dos
señales que tienen que cambiar las dos:

1. `navSeq`: contador de navegaciones del router en este documento. Lo incrementa
   `src/instrumentation-client.ts::onRouterTransitionStart`, que Next 16 llama en cada
   push / replace (`<Link>`, `useRouter().push`) y en atrás/adelante, pero no en
   `router.refresh()` ni en las server actions (comprobado en
   `next/dist/client/components/app-router-instance.js`, 16.3.8). El overlay lo lee con
   `useSyncExternalStore` (con `getServerSnapshot`).
2. `renderId`: `crypto.randomUUID()` en cada render del servidor de la página.

Cuando cambia el `renderId`, el overlay reabre la bienvenida (monta de nuevo
`WelcomeDialog` con otra `key`) solo si `navSeq` avanzó desde la última vez
(`shouldReopenWelcome`). Una navegación hacia fuera suma `navSeq` pero no pinta la
página otra vez, así que no hay parpadeo antes de desmontarla. Caso límite aceptado:
una navegación abortada seguida de un `router.refresh()` la reabriría; ningún camino de
la app lo produce.

Comprobado con contraprueba (desactivando `shouldReopenWelcome`): el enlace del menú
al calendario actual deja de sacarla (`e2e/tal85-foto-portada.spec.ts`, caso 3c). En
16.3.8, `/c` → redirect al mismo calendario y atrás/adelante ya remontan la página por
sí solos (casos 3b y 3d pasan también sin la regla): la regla los cubre igualmente si
eso cambia.

**`welcomeViews` (TAL-70) queda sin uso.** El Next nuevo no lee ni escribe la marca (se
borraron `src/lib/welcome.ts` y `welcome-actions.ts`). La tabla, sus índices y las
funciones `markSeenPublic`/`hasSeenTodayPublic`/`countForCalendars` se conservan para el
Next anterior durante el despliegue o un rollback, y `deleteCalendarHandler` sigue
borrando sus filas. Su retirada del schema va en una tarea aparte, con el procedimiento
de migración (como TAL-82). Lo que sigue describe cómo funcionaba la marca mientras
exista:

- **Dónde se guardaba:** tabla `welcomeViews {userId, calendarId, date}` (índices
  `by_user_calendar_date` y `by_calendar`).
- **`markSeenPublic` es una sola mutation.** Pasos, en orden:
  1. comprueba el secreto;
  2. valida que la fecha tenga el formato `YYYY-MM-DD`;
  3. comprueba que el calendario existe, antes de autorizar y para cualquier actor,
     también el Super Admin;
  4. autoriza (Super Admin leído en ese momento, o membership vigente);
  5. busca la fila y la inserta solo si no existe.

  El OCC de Convex serializa las marcas simultáneas, así que queda exactamente 1 fila.
  También serializa la marca frente al borrado del calendario: `deleteCalendarHandler`
  borra las `welcomeViews` en su misma transacción y las dos operaciones tocan el
  documento del calendario, de modo que nunca queda una fila huérfana.
- **Foto rota o lenta:** con `onError` o con más de 6 s de carga, la bienvenida se quita
  y queda el calendario debajo. Mismo criterio de "carga / no carga" que la tarjeta de
  "Tus calendarios" y la vista previa del editor (`src/lib/use-image-status.ts`).
- **UI** (`welcome-overlay.tsx`, estilos `.welcome-*`):
  - la foto con `object-fit: cover`;
  - el degradado del mockup, `rgba(10,8,30,0.85)` → `0.35` (50 %) → `0.1`;
  - "Hola, <nombre>", con el primer nombre de la sesión, o solo "Hola";
  - el título de portada;
  - la cuenta atrás (`formatCountdownMessage`);
  - el botón "Abrir mi calendario" (`--sun`/`--on-sun`), que cierra la bienvenida y
    devuelve el foco a `#calendar-main`. Escape también la cierra.

  El menú de la cuenta queda por encima (z-index 10 frente a 9).
- **Contraste:** el E2E mide en el DOM, a 375 px y en escritorio, el alpha del degradado
  en el borde superior de cada texto. Lo compone sobre una foto blanca pura (peor caso) y
  exige 4,5:1, o 3:1 para el texto grande.

## Imagen de fondo tenue (sustituye el tratamiento de TAL-39)

- La imagen de fondo ya no sustituye al skin ni lleva capa oscura. Es una capa
  `.faint-bg-layer` con `opacity: 0.1` y `filter: saturate(0.7)`, encima del fondo del
  skin y por debajo del contenido (`.faint-bg-host`, `isolation: isolate`). La crea
  `skin-appearance.ts::faintBackgroundLayer`.
- Se aplica en tres sitios: el `<main>` de `/c/<id>`, la vista previa del editor
  (`CalendarCoverHeader`) y la cabecera de mes del grid del editor.
- **TAL-85 — respaldo:** si el calendario no tiene `backgroundImageUrl`, la capa usa la
  foto de portada (`skin-appearance.ts::faintBackgroundUrl`), en los mismos tres sitios
  y con el mismo tratamiento (10 %, ya cubierto por la puerta de contraste de abajo).
- **Por qué se ve con `z-index: -1`** (duda del auditor en TAL-85, loop 1): `.faint-bg-host`
  crea un contexto de apilamiento (`isolation: isolate`) y, por el orden de pintado de CSS
  (CSS 2.1, apéndice E), dentro de él se pinta primero el fondo de la raíz (el fondo del
  skin del `<main>`) y después los hijos con `z-index` negativo, antes que el contenido en
  flujo. La capa queda encima del fondo y debajo del contenido. Lo comprueba en píxeles
  `e2e/tal85-foto-portada.spec.ts` (caso 4b: el píxel con la capa frente al mismo píxel
  con la capa oculta coincide con 10 % de la foto con `saturate(0.7)` sobre el fondo, y el
  texto sigue en AA sobre ese compuesto; caso 4c: capturas lado a lado con una foto de
  rayas).
- El texto ya no usa el tratamiento "photo" (blanco con sombra): usa el normal del skin.
- **Tarjetas al 85 %:** con imagen, `<main>` define `--skin-card-surface:
  color-mix(in srgb, var(--skin-card) 85%, transparent)`, que usan la tarjeta del mes
  (`.skin-month-card`) y el modal del día. Sin imagen siguen opacas, igual que antes. La
  cabecera de mes fija (sticky) sigue opaca, para que no se transparenten las casillas que
  pasan por debajo (motivo de TAL-50).
- **Puerta de contraste:** `scripts/verify-tal70-faint-background-contrast.mjs`. Para los
  8 skins, toma como fondo el del skin con la imagen al 10 % en los dos peores casos
  (blanca y negra pura) y pone encima la tarjeta o el modal al 85 %. Evalúa los textos que
  existen de verdad:
  - página: ink;
  - tarjeta del mes: ink, dim y weekend;
  - modal: ink.

  "dim sobre página" se informa como dato sin bloquear (decisión de la Directora,
  2026-10-02), porque ningún texto `--skin-dim` va sobre la página. Si algún día uno sale
  fuera de la tarjeta, el barrido de `e2e/tal61-estilo-base.spec.ts` obliga a darle una
  excepción de valor exacto con su fondo real. Esa es la protección.
- La paleta del skin no depende del tema claro u oscuro de la app (las variables
  `--skin-*` van en línea en el contenedor).

## Rollback

TAL-85: revertir Next devuelve la regla "una vez al día" y vuelve a escribir en
`welcomeViews`, que sigue en el schema con sus funciones. Revertir Convex quita
`coverImageUrl` de las filas de "Tus calendarios"; el Next nuevo lo trata como ausente
(tarjeta sin foto).

TAL-70: `welcomeViews` es una tabla nueva: el schema anterior la acepta con datos (comprobado en
TAL-67), así que revertir no exige vaciarla. Revertir el código devuelve el login con
portada y el fondo de TAL-39. Auditoría: `npx convex run welcomeViews:countForCalendars
'{"calendarIds":[…]}'`.
