# Plus Jakarta Sans — autoalojada (TAL-79)

La única familia de la app (design/design-system.md § "Estilo 2026 → Tipografía"). Hasta
TAL-79 la descargaba `next/font/google` en cada build: si Google Fonts fallaba, fallaba el
build (y el deploy de Railway). Ahora vive aquí y se sirve con `next/font/local`
(`index.ts`).

## Origen y equivalencia

Los 4 `.woff2` son, **byte a byte**, los subsets que sirve Google Fonts para la misma
petición que hacía `next/font/google` (`Plus Jakarta Sans`, pesos 400–800, `display=swap`;
versión de la fuente `2.071`, variable `wght` 200–800, sin hinting). Comprobado el
2026-10-12 con el User-Agent de `next/font` (`fetch-resource.js`):

- Hoja: `https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap`

| Fichero | Subset | URL de origen (fonts.gstatic.com) | sha256 |
|---|---|---|---|
| `latin.woff2` | latin | `s/plusjakartasans/v12/LDIoaomQNQcsA88c7O9yZ4KMCoOg4Ko20yygg_vb.woff2` | `cd8db90cd950e26bc8761f65d323588bd5cd112d326d6d322bc7c8ea86771215` |
| `latin-ext.woff2` | latin-ext | `s/plusjakartasans/v12/LDIoaomQNQcsA88c7O9yZ4KMCoOg4Ko40yygg_vbd-E.woff2` | `0303e02b53b0298fb26a0193941a2e8754f0f9a9fce50d90b178d8da3424873f` |
| `vietnamese.woff2` | vietnamese | `s/plusjakartasans/v12/LDIoaomQNQcsA88c7O9yZ4KMCoOg4Ko50yygg_vbd-E.woff2` | `5c913fc1b1f86f4b475e5df45a796aa480d1f7f0891ed6f1a5991d6d1be887c3` |
| `cyrillic-ext.woff2` | cyrillic-ext | `s/plusjakartasans/v12/LDIoaomQNQcsA88c7O9yZ4KMCoOg4Ko70yygg_vbd-E.woff2` | `a16f29d7d2a21a4f9b3249a82eb2725ed5bdb91500dfb5c4758977de27477f20` |

Son los mismos `sha256` que tenían los ficheros que el build de `main` (63fd268, con
`next/font/google`) servía en `.next/static/media`.

Los `unicode-range` de `index.ts` son los literales de esa misma hoja, y el respaldo
`Plus Jakarta Sans Fallback` y `--font-jakarta` (en `src/app/globals.css`, bloque TAL-79) son
los literales del CSS que generaba `next/font/google`. Los protege
`e2e/tal79-fuente-local.spec.ts`, que lee el CSS final emitido.

## Licencia

SIL Open Font License 1.1 — `OFL.txt`, tomado de
`https://raw.githubusercontent.com/google/fonts/092204231c6bf36c0871c0cad11077660106cef5/ofl/plusjakartasans/OFL.txt`
(sha256 `995c7199cab65954f545996326755daee7b63cc6b42b06c13da1f9502ab08a99`).

## Si algún día hay que actualizar la fuente

1. Pedir la hoja de arriba con el User-Agent de `node_modules/next/dist/compiled/@next/font/dist/google/fetch-resource.js`.
2. Descargar las 4 URLs, sustituir los ficheros y actualizar esta tabla (`shasum -a 256`).
3. Si cambian los `unicode-range`, copiarlos literales en `index.ts` y en el test.
4. Pasar la comparación visual antes/después: un cambio de versión de la fuente sí cambia píxeles.
