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
