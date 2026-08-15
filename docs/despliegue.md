# Verificación de despliegue (TAL-1)

El servicio de Railway "calendario-adviento" está conectado al repo de GitHub
(`aitormarin-TalentNetwork/calendario-adviento`, rama `main`) con auto-deploy en
cada push. Como `main` todavía no tiene el esqueleto de la app (solo la
documentación de proceso), el primer build automático en producción falla
("Railpack could not determine how to build the app") hasta que este código se
integre — es el comportamiento esperado en este punto del ciclo.

Para demostrar que el esqueleto sí compila, arranca y responde en Railway sin
depender de tocar `main` ni el environment de producción, se desplegó una vez de
forma manual a un **environment efímero** dentro del mismo proyecto, ligado solo
al contenido de esta rama:

1. `railway environment new tal1-preview` — entorno nuevo, aislado de producción.
2. `railway up --environment tal1-preview` — deploy del worktree de esta tarea
   (rama `aitormarin/tal-1-setup-del-proyecto-y-despliegue`), no de `main`.
   Resultado del build: `{"status":"success"}`.
3. `railway domain --environment tal1-preview --service calendario-adviento` —
   dominio generado: `https://calendario-adviento-tal1-preview.up.railway.app`.
4. `curl` a ese dominio → `HTTP 200`.
5. `railway environment delete tal1-preview --yes` — entorno borrado tras
   verificar, para no dejar recursos huérfanos en la cuenta de Railway.

Ejecutado por el CEO (autorización de infraestructura/cuenta externa que esta
terminal no puede correr por su cuenta). Verificado después desde esta terminal
con `railway environment list --json` (ya no existe `tal1-preview`, solo queda
`production`) y con un curl posterior al mismo dominio, que ahora devuelve `404`
— consistente con que el entorno de prueba se desplegó, respondió y se limpió
correctamente.

La evidencia de despliegue de **producción** (punto 4-5 del "qué se considera
hecho" del brief) queda pendiente de la integración real a `main`, que no
ejecuta esta terminal.
