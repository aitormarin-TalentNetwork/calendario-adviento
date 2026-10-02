// TAL-69 — prueba REAL (con red) del comprobador de URLs de imagen contra
// los literales de los criterios de aceptación. OPCIONAL y FUERA de la
// suite (la suite usa el stub, sin red). Uso:
//   npx tsx scripts/check-tal69-real-urls.ts
// Esperado: fcbarcelona → page · Wikimedia → image · localhost → unknown
// (bloqueado por SSRF). Un "unknown" en los dos primeros = sin red o el
// servidor remoto no respondió a tiempo (fail-open: no se avisaría).
import { STUB_IMAGE_URL, STUB_PAGE_URL } from "../src/lib/image-checker";
import { checkImageUrl } from "../src/lib/image-url-check";

async function main() {
  for (const url of [STUB_PAGE_URL, STUB_IMAGE_URL, "https://localhost/a.jpg"]) {
    const started = Date.now();
    const result = await checkImageUrl(url);
    console.log(`${result.padEnd(8)} ${String(Date.now() - started).padStart(5)} ms  ${url}`);
  }
}

void main();
