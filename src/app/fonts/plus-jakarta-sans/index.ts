import localFont from "next/font/local";

/**
 * TAL-79 — Plus Jakarta Sans autoalojada: el build ya no pide nada a Google
 * (antes, `next/font/google` la descargaba en cada build; si Google fallaba,
 * fallaba el build). Los 4 `.woff2` son, byte a byte, los subsets que sirve
 * Google Fonts (v2.071, variable `wght` 200–800); origen y `sha256` en el
 * README de esta carpeta.
 *
 * Una instancia por subset para reproducir exactamente el CSS de antes: 20
 * `@font-face` (5 pesos × 4 subsets, mismo fichero variable en los 5 pesos)
 * con `font-family: Plus Jakarta Sans` y el `unicode-range` literal de Google
 * (vía `declarations`). Precarga solo latin y latin-ext, como antes.
 *
 * Sin `variable` ni `adjustFontFallback`: next/font/local solo aplica el
 * `font-family` de `declarations` a las `@font-face`, no a la variable ni al
 * respaldo (saldrían como "jakarta Fallback" con otras métricas). Por eso
 * `--font-jakarta` y `Plus Jakarta Sans Fallback` se declaran en
 * `globals.css` (bloque TAL-79), con los literales del CSS de antes.
 *
 * `layout.tsx` importa este módulo solo por efecto: con eso se emiten las
 * caras y la precarga en todas las rutas.
 *
 * Opciones literales a propósito (next/font las analiza en el build, no
 * admite construirlas con funciones): 5 entradas por subset, una por peso.
 */
export const plusJakartaCyrillicExt = localFont({
  src: [
    { path: "./cyrillic-ext.woff2", weight: "400", style: "normal" },
    { path: "./cyrillic-ext.woff2", weight: "500", style: "normal" },
    { path: "./cyrillic-ext.woff2", weight: "600", style: "normal" },
    { path: "./cyrillic-ext.woff2", weight: "700", style: "normal" },
    { path: "./cyrillic-ext.woff2", weight: "800", style: "normal" },
  ],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'Plus Jakarta Sans'" },
    { prop: "unicode-range", value: "U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F" },
  ],
});

export const plusJakartaVietnamese = localFont({
  src: [
    { path: "./vietnamese.woff2", weight: "400", style: "normal" },
    { path: "./vietnamese.woff2", weight: "500", style: "normal" },
    { path: "./vietnamese.woff2", weight: "600", style: "normal" },
    { path: "./vietnamese.woff2", weight: "700", style: "normal" },
    { path: "./vietnamese.woff2", weight: "800", style: "normal" },
  ],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'Plus Jakarta Sans'" },
    {
      prop: "unicode-range",
      value:
        "U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB",
    },
  ],
});

export const plusJakartaLatinExt = localFont({
  src: [
    { path: "./latin-ext.woff2", weight: "400", style: "normal" },
    { path: "./latin-ext.woff2", weight: "500", style: "normal" },
    { path: "./latin-ext.woff2", weight: "600", style: "normal" },
    { path: "./latin-ext.woff2", weight: "700", style: "normal" },
    { path: "./latin-ext.woff2", weight: "800", style: "normal" },
  ],
  display: "swap",
  preload: true,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'Plus Jakarta Sans'" },
    {
      prop: "unicode-range",
      value:
        "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF",
    },
  ],
});

export const plusJakartaLatin = localFont({
  src: [
    { path: "./latin.woff2", weight: "400", style: "normal" },
    { path: "./latin.woff2", weight: "500", style: "normal" },
    { path: "./latin.woff2", weight: "600", style: "normal" },
    { path: "./latin.woff2", weight: "700", style: "normal" },
    { path: "./latin.woff2", weight: "800", style: "normal" },
  ],
  display: "swap",
  preload: true,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'Plus Jakarta Sans'" },
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    },
  ],
});
