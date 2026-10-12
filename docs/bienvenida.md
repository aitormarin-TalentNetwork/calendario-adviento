# Bienvenida con foto, login genérico y fondo tenue (TAL-70)

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

Se muestra si se cumplen tres condiciones:

- el calendario tiene `coverImageUrl`;
- existe la cookie `tz`;
- la persona aún no la ha visto hoy en ese calendario (día natural en su zona).

Si no hay foto, no hay bienvenida. Si falta la cookie `tz` (caso raro: `TimezoneSync` la
pone en la primera visita), tampoco: no hay un "hoy" fiable y se prefiere no mostrarla
antes que gastarla en un día equivocado.

- **Dónde se guarda:** tabla `welcomeViews {userId, calendarId, date}` (índices
  `by_user_calendar_date` y `by_calendar`). Así funciona por persona y en cualquier
  dispositivo. Cuesta una lectura por visita y una escritura por persona, calendario y
  día.
- **Lectura:** `welcomeViews.hasSeenTodayPublic`, en el render del servidor, después de
  `resolveCalendarAccess`. Si falla, no se muestra la bienvenida (nunca bloquea).
- **Marca:** solo cuando la foto ha cargado de verdad (`onLoad`, o ya completa al
  hidratar). La hace `markWelcomeSeenAction(calendarId)`, que saca la persona de la
  sesión y la fecha de la cookie `tz`, en el servidor. Después llama a
  `welcomeViews.markSeenPublic`.
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
  sin marcar y queda el calendario debajo. En la siguiente visita se reintenta.
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

`welcomeViews` es una tabla nueva: el schema anterior la acepta con datos (comprobado en
TAL-67), así que revertir no exige vaciarla. Revertir el código devuelve el login con
portada y el fondo de TAL-39. Auditoría: `npx convex run welcomeViews:countForCalendars
'{"calendarIds":[…]}'`.
