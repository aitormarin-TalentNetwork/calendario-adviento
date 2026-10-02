import { checkImageUrl, type ImageCheckResult } from "@/lib/image-url-check";

/**
 * TAL-69 — frontera inyectable del comprobador. En producción, siempre el
 * real. El stub determinista de los E2E solo se activa si la variable
 * `E2E_IMAGE_CHECK_STUB=1` existe (la define ÚNICAMENTE el `webServer` de
 * playwright.config.ts) Y `NODE_ENV !== "production"`: en producción se
 * ignora aunque alguien la defina.
 */
export type ImageChecker = (url: string) => Promise<ImageCheckResult>;

/** Literales de los criterios de aceptación de TAL-69. */
export const STUB_PAGE_URL = "https://www.fcbarcelona.com/en/news/4266456/28th-liga-in-fc-barcelona-history";
export const STUB_IMAGE_URL = "https://upload.wikimedia.org/wikipedia/commons/a/a9/Example.jpg";

export const realImageChecker: ImageChecker = (url) => checkImageUrl(url);

export const stubImageChecker: ImageChecker = async (url) => {
  if (url === STUB_PAGE_URL) return "page";
  if (url === STUB_IMAGE_URL) return "image";
  // Sonda: solo el stub la clasifica como página (el real daría "unknown"
  // para un host .invalid), así el E2E comprueba que el stub está activo.
  if (url.includes("stub-page")) return "page";
  if (url.includes("stub-slow")) {
    await new Promise((resolve) => setTimeout(resolve, 10_000));
    return "page";
  }
  if (url.includes("stub-throw")) throw new Error("stub-throw: fallo simulado del comprobador");
  return "unknown";
};

export function selectImageChecker(env: Record<string, string | undefined>): ImageChecker {
  return env.E2E_IMAGE_CHECK_STUB === "1" && env.NODE_ENV !== "production" ? stubImageChecker : realImageChecker;
}
