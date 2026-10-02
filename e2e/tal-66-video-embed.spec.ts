import { expect, test } from "@playwright/test";
import { NON_EMBEDDABLE_VIDEO_WARNING, parseEmbeddableVideo, parseYouTubeStartSeconds } from "../src/lib/video-embed";

/**
 * TAL-66 — tests puros de `parseEmbeddableVideo`, por formato. Ids
 * de ejemplo con el formato real de YouTube (11 caracteres).
 */

const ID = "dQw4w9WgXcQ";
const YT = (start?: number) => ({
  embedUrl: `https://www.youtube.com/embed/${ID}${start ? `?start=${start}` : ""}`,
  thumbnailUrl: `https://img.youtube.com/vi/${ID}/hqdefault.jpg`,
});

function check(cases: [string, unknown][]) {
  for (const [input, expected] of cases) {
    expect(parseEmbeddableVideo(input), input).toEqual(expected);
  }
}

test("regresión: los formatos que ya funcionaban dan exactamente la misma salida", () => {
  check([
    [`https://www.youtube.com/watch?v=${ID}`, YT()],
    [`https://youtube.com/watch?v=${ID}`, YT()],
    [`https://m.youtube.com/watch?v=${ID}`, YT()],
    [`https://www.youtube.com/embed/${ID}`, YT()],
    [`https://www.youtube.com/shorts/${ID}`, YT()],
    [`https://youtu.be/${ID}`, YT()],
    ["https://vimeo.com/76979871", { embedUrl: "https://player.vimeo.com/video/76979871", thumbnailUrl: null }],
    [
      "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view?usp=sharing",
      { embedUrl: "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/preview", thumbnailUrl: null },
    ],
  ]);
});

test("YouTube nuevo: live, music, nocookie, /v/, /e/", () => {
  check([
    [`https://www.youtube.com/live/${ID}`, YT()],
    [`https://www.youtube.com/live/${ID}?si=AbCdEf123`, YT()],
    [`https://music.youtube.com/watch?v=${ID}`, YT()],
    [`https://www.youtube-nocookie.com/embed/${ID}`, YT()],
    [`https://youtube-nocookie.com/embed/${ID}`, YT()],
    [`https://www.youtube.com/v/${ID}`, YT()],
    [`https://www.youtube.com/e/${ID}`, YT()],
    [`https://m.youtube.com/shorts/${ID}`, YT()],
    [`https://m.youtube.com/live/${ID}`, YT()],
  ]);
});

test("YouTube: parámetros extra, barra final, mayúsculas, espacios y http", () => {
  check([
    [`https://www.youtube.com/watch?feature=share&v=${ID}`, YT()],
    [`https://www.youtube.com/watch?v=${ID}&list=PL123&index=2`, YT()],
    [`https://www.youtube.com/watch?v=${ID}&si=xyz`, YT()],
    [`https://youtu.be/${ID}?si=AbCdEf123`, YT()],
    [`https://youtu.be/${ID}?feature=shared`, YT()],
    [`https://youtu.be/${ID}/`, YT()],
    [`https://www.youtube.com/embed/${ID}/`, YT()],
    [`https://www.youtube.com/shorts/${ID}?feature=share`, YT()],
    [`https://WWW.YouTube.com/watch?v=${ID}`, YT()],
    [`   https://youtu.be/${ID}   `, YT()],
    [`http://www.youtube.com/watch?v=${ID}`, YT()],
  ]);
});

test("YouTube: attribution_link válido", () => {
  check([[`https://www.youtube.com/attribution_link?a=x&u=%2Fwatch%3Fv%3D${ID}%26feature%3Dshare`, YT()]]);
});

test("tiempo de inicio (decisión del PM): t= / start= / #t= → ?start=<segundos>", () => {
  check([
    [`https://youtu.be/${ID}?t=90`, YT(90)],
    [`https://youtu.be/${ID}?t=90s`, YT(90)],
    [`https://www.youtube.com/watch?v=${ID}&t=1m30s`, YT(90)],
    [`https://www.youtube.com/watch?v=${ID}&t=1h2m3s`, YT(3723)],
    [`https://www.youtube.com/embed/${ID}?start=90`, YT(90)],
    [`https://www.youtube.com/watch?v=${ID}#t=1m30s`, YT(90)],
    [`https://www.youtube.com/live/${ID}?t=45`, YT(45)],
  ]);
});

test("tiempo de inicio no válido: se ignora, el embed sigue saliendo", () => {
  check([
    [`https://youtu.be/${ID}?t=abc`, YT()],
    [`https://youtu.be/${ID}?t=0`, YT()],
    [`https://youtu.be/${ID}?t=-5`, YT()],
    [`https://youtu.be/${ID}?t=999999`, YT()],
  ]);
  expect(parseYouTubeStartSeconds("2m")).toBe(120);
  expect(parseYouTubeStartSeconds("1h")).toBe(3600);
  expect(parseYouTubeStartSeconds("1m30")).toBeNull();
  expect(parseYouTubeStartSeconds("")).toBeNull();
});

test("rechazos: id inválido, playlist, clip, canal, host desconocido, sin esquema, esquemas peligrosos", () => {
  check([
    ["https://youtu.be/dQw4w9WgXc", null], // 10 caracteres
    ["https://youtu.be/dQw4w9WgXcQQ", null], // 12 caracteres
    [`https://youtu.be/${ID}/extra`, null],
    ["https://www.youtube.com/watch?v=abc/def", null],
    ["https://www.youtube.com/playlist?list=PL1234567890", null],
    ["https://www.youtube.com/clip/UgkxAbCdEfGhIjKlMnOpQrStUvWxYz", null],
    ["https://www.youtube.com/@canal", null],
    ["https://www.youtube.com/channel/UC1234567890", null],
    [`https://evil.example.com/watch?v=${ID}`, null],
    [`https://youtube.com.evil.example/watch?v=${ID}`, null],
    [`youtube.com/watch?v=${ID}`, null],
    [`javascript:alert(1)//youtube.com/watch?v=${ID}`, null],
    ["data:text/html,<script>alert(1)</script>", null],
    [`ftp://www.youtube.com/watch?v=${ID}`, null],
    ["no es una url", null],
  ]);
});

test("attribution_link malicioso: absoluto, protocol-relative, doble codificación, anidado, barra invertida", () => {
  const base = "https://www.youtube.com/attribution_link?u=";
  check([
    [`${base}${encodeURIComponent(`https://evil.example/watch?v=${ID}`)}`, null],
    [`${base}${encodeURIComponent(`//evil.example/watch?v=${ID}`)}`, null],
    [`${base}%252Fwatch%253Fv%253D${ID}`, null], // doblemente codificado
    [`${base}${encodeURIComponent(`/attribution_link?u=/watch?v=${ID}`)}`, null], // anidado
    [`${base}${encodeURIComponent(`/\\evil.example/watch?v=${ID}`)}`, null],
    [`${base}${encodeURIComponent(`javascript:alert(1)`)}`, null],
    [`${base}${encodeURIComponent("/playlist?list=PL1")}`, null],
    ["https://www.youtube.com/attribution_link", null],
  ]);
});

test("Vimeo estrechado (ronda 3): /ID/HASH, /123abc y otras rutas → null (caen al aviso)", () => {
  check([
    ["https://vimeo.com/76979871/", { embedUrl: "https://player.vimeo.com/video/76979871", thumbnailUrl: null }],
    ["https://vimeo.com/76979871?share=copy", { embedUrl: "https://player.vimeo.com/video/76979871", thumbnailUrl: null }],
    ["https://vimeo.com/76979871/abc123def4", null], // oculto con hash: sin h= el embed no funciona
    ["https://vimeo.com/123abc", null],
    ["https://vimeo.com/channels/staffpicks/76979871", null],
    ["https://player.vimeo.com/video/76979871", null],
  ]);
});

test("Drive sin ampliar: /open?id=, /uc?id= y docs.google.com → null", () => {
  check([
    ["https://drive.google.com/open?id=1AbCdEfGhIjKlMnOpQrStUvWxYz012345", null],
    ["https://drive.google.com/uc?id=1AbCdEfGhIjKlMnOpQrStUvWxYz012345&export=download", null],
    ["https://docs.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view", null],
  ]);
});

test("caso real de producción (criterio b): la URL del calendario de Aitor es una BÚSQUEDA de YouTube → null en todas las variantes de host", () => {
  // URL literal del calendario afectado (TAL-66, facilitada por el PM). No es
  // un vídeo: no se puede incrustar. Lo que lo resuelve es el aviso al Admin.
  const REAL = "https://www.youtube.com/results?search_query=cute+kitten+purring";
  check([
    [REAL, null],
    ["https://youtube.com/results?search_query=cute+kitten+purring", null],
    ["https://m.youtube.com/results?search_query=cute+kitten+purring", null],
    ["https://music.youtube.com/results?search_query=cute+kitten+purring", null],
    ["https://music.youtube.com/search?q=cute+kitten+purring", null],
    ["https://www.youtube-nocookie.com/results?search_query=cute+kitten+purring", null],
    ["https://www.youtube.com/results?search_query=cute+kitten+purring&v=dQw4w9WgXcQ", null],
  ]);
});

test("texto literal del aviso (PM)", () => {
  expect(NON_EMBEDDABLE_VIDEO_WARNING).toBe(
    "Este enlace no se puede mostrar dentro del calendario; el invitado tendrá que abrirlo fuera. Usa un enlace normal de YouTube, Vimeo o Drive"
  );
});
