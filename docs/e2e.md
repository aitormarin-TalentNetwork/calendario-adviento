# Tests end-to-end con Playwright

Introducidos en TAL-57. El auditor exige evidencia real de tests de Playwright
pasando en cada tarea (`AGENTS.md`), así que esta es la base común para todas
las terminales.

## Qué hay

- `playwright.config.ts`: Chromium propio de Playwright en headless. No usa el
  Chrome compartido entre terminales, así que **no hace falta `.chrome-lock/`**.
  Un solo worker, sin paralelismo: los specs encadenan pasos contra el
  deployment de Convex de la terminal.
- `e2e/helpers/env.ts`: carga `.env.local` y `.env`, igual que la app.
- `e2e/helpers/convex.ts`: `convex` (un `ConvexHttpClient` contra
  `NEXT_PUBLIC_CONVEX_URL`), `api` y `serverSecret()` para llamar a cualquier
  función `*Public` de Convex desde los tests (sembrar y consultar datos).
- `e2e/helpers/auth.ts`:
  - `seedUser({ email, superAdmin? })` crea el usuario en Convex antes del
    login. `isSuperAdminOnCreate` solo se aplica al crear, así que conviene
    usar emails únicos por ejecución (`uniqueRunId()`).
  - `loginAs(page, email)` entra por el proveedor `dev-login`
    (`AUTH_DEV_LOGIN=true`, nunca disponible en producción). La sesión queda
    en el contexto del navegador, así que `page.context().request` también va
    autenticado.

## Cómo se ejecuta

Desde la raíz del worktree, con `.env.local` (Convex de desarrollo de la
terminal) y `.env` (`AUTH_SECRET`, `AUTH_DEV_LOGIN=true`):

```sh
npx convex dev --once          # que Convex tenga el código actual
npx playwright install chromium   # solo la primera vez
npm run test:e2e
```

Puerto: `E2E_PORT` (3000 por defecto, el de T1; T2 usa `E2E_PORT=3001`). Si ya
hay un `next dev` en ese puerto se reutiliza; si no, lo arranca Playwright.

Nunca contra producción: los tests escriben datos de prueba en el deployment
de Convex de `.env.local`.

## Convenciones

- Cada spec borra en `afterAll` los calendarios que crea. Los usuarios
  sembrados se quedan como residuo controlado (emails
  `e2e-<tarea>-*@example.com`): no hay mutation pública para borrar usuarios.
- Las capturas de evidencia se escriben explícitamente con
  `page.screenshot({ path })` en `docs/evidence/<tarea>/`, que está ignorado
  por git (igual que la evidencia de TAL-22/TAL-47), y se citan por ruta en el
  export al auditor.
- `test-results/`, `playwright-report/`, `blob-report/` y `playwright/.cache/`
  están en `.gitignore`.

## Batería de regresión (TAL-71)

Los flujos clave de las Ondas 3 y 4 en una sola ejecución corta (unos 3 min con
la máquina libre), para comprobar que un cambio no rompe lo ya validado:

```sh
E2E_PORT=3002 npm run test:e2e:regresion     # cada terminal con su puerto: T1 3000, T2 3001, T3 3002
```

### Qué cubre

Los tests etiquetados `@regresion` (opción `tag` de Playwright) y el recorrido
de punta a punta `e2e/regresion-recorrido.spec.ts`. La lista exacta está en
`e2e/regresion.manifest.json` (22 tests):

| Flujo | Tests |
|---|---|
| Roles y permisos | tal57 1, 2, 3b y 4; tal-58 4 |
| Modos y menú de la cuenta | tal59 4, 5 y 7; tal68-menu-superadmin 1 y 3 |
| Super Admin ve todos | tal64 1 y 3 |
| Invitar con rol | tal65 1, 2 (lo necesita el 3), 3 y 5 |
| Vídeo | tal-66-videos 1 y 8 |
| Imagen de los días vistos | tal67-day-image 1 |
| Bienvenida y login genérico | tal70-welcome 1 y 2 |
| Recorrido encadenado | regresion-recorrido: Super Admin crea e invita con rol → Admin guarda vídeo, sube imagen e invita → Visitante: login genérico, bienvenida, vídeo, «Visto» con la imagen, salto de calendario → Admin cambia a modo Usuario |

### Qué hace el lanzador (`scripts/e2e-regresion.mjs`)

1. **Nunca contra producción.** `CONVEX_DEPLOYMENT` tiene que ser `dev:<slug>`.
   `NEXT_PUBLIC_CONVEX_URL` tiene que tener exactamente el hostname
   `<slug>.convex.cloud` y `NEXT_PUBLIC_CONVEX_SITE_URL` exactamente
   `<slug>.convex.site`, los dos del mismo slug. Además hay una lista de
   denegación con los deployments de producción conocidos
   (`DENIED_PROD_SLUGS`, ampliable). Rechaza `--prod` y exige `E2E_PORT`
   explícito. Si algo no cuadra, sale con exit 2 sin arrancar nada.
2. **Manifiesto.** Lo que lista `playwright test --grep @regresion --list`
   tiene que ser idéntico a `e2e/regresion.manifest.json`; si no, exit 3. Un
   título renombrado o una etiqueta perdida no pasan en silencio.
3. **Cerrojo `.e2e-suite-lock`** en la raíz del repo principal (el padre de
   `git rev-parse --git-common-dir`):
   - adquisición atómica con `mkdir`;
   - `owner` con terminal, cwd, pid, hora y un token;
   - si está tomado, espera (reintento cada 15 s);
   - un cerrojo **huérfano** (sin `owner` o con el pid muerto) **no se borra**:
     avisa y sigue esperando, y lo borra a mano quien lo compruebe;
   - al terminar libera solo si el `owner` conserva su token.
4. **Playwright** con `--grep @regresion` (los argumentos extra se le pasan
   tal cual). SIGINT/SIGTERM se reenvían solo a ese proceso hijo, y el
   cerrojo se suelta después de que termine. Nunca mata procesos por patrón.
   **Comportamiento conocido**: si cortas la batería a mitad (Ctrl-C o
   SIGTERM), Playwright cierra el `next dev` en plena compilación. El
   siguiente arranque en ese worktree se puede quedar compilando al 100 % de
   CPU sin responder. Si pasa: para ese `next dev` por su PID (nunca por
   patrón) y borra `.next` del worktree antes de relanzar. El lanzador lo
   recuerda al interrumpirse.
5. **Resumen**: ejecutados, pasados, fallidos, omitidos, inestables y
   duración. **Un test omitido hace fallar la batería** (exit 1). Por ejemplo,
   tal-66-videos 1 se omite sin salida a youtube.com, y eso no puede pasar por
   verde.

### Añadir un test a la batería

En el **mismo commit**: añade `{ tag: "@regresion" }` al test y su entrada
(`file` y `title`) a `e2e/regresion.manifest.json`. Comprueba que
`npm run test:e2e:regresion` pasa: los tests van en el orden de su spec, así
que si el test depende de otro anterior de un spec en serie, ese otro también
entra. **TAL-73 y TAL-74** entran así al publicarse, cada una con su test
principal: progreso y filtros en «Tus calendarios»; etiqueta de estado en
«Mis calendarios».
