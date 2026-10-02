import type { ImageChecker } from "@/lib/image-checker";
import type { ImageCheckResult } from "@/lib/image-url-check";
import type { ImageUrlWarnings } from "@/lib/image-url-warning";

/**
 * TAL-69 — límites de abuso de la comprobación (en memoria del proceso):
 * - caché por URL (TTL 10 min, máx. 500 entradas; solo "image"/"page", un
 *   "unknown" no se fija para no congelar un fallo transitorio);
 * - deduplicación: comprobaciones concurrentes de la misma URL comparten la
 *   misma promesa en curso;
 * - enfriamiento por calendario: como mucho 1 comprobación cada 10 s;
 *   dentro, se devuelve lo que haya en caché o "unknown" (sin aviso).
 * Funciones puras con reloj y comprobador inyectables (tests sin red).
 */
export type ImageCheckService = ReturnType<typeof createImageCheckService>;

type Urls = { coverImageUrl?: string | null; backgroundImageUrl?: string | null };
type Field = keyof Urls;
const FIELDS: Field[] = ["coverImageUrl", "backgroundImageUrl"];

export function createImageCheckService({
  checker,
  now = Date.now,
  ttlMs = 10 * 60_000,
  cooldownMs = 10_000,
  maxEntries = 500,
}: {
  checker: ImageChecker;
  now?: () => number;
  ttlMs?: number;
  cooldownMs?: number;
  maxEntries?: number;
}) {
  const cache = new Map<string, { result: ImageCheckResult; expiresAt: number }>();
  const inflight = new Map<string, Promise<ImageCheckResult>>();
  const lastCheckByCalendar = new Map<string, number>();

  const key = (url: string) => {
    try {
      return new URL(url).toString();
    } catch {
      return url;
    }
  };

  function cached(url: string): ImageCheckResult | null {
    const entry = cache.get(key(url));
    if (!entry) return null;
    if (entry.expiresAt <= now()) {
      cache.delete(key(url));
      return null;
    }
    return entry.result;
  }

  function store(url: string, result: ImageCheckResult) {
    cache.delete(key(url));
    cache.set(key(url), { result, expiresAt: now() + ttlMs });
    while (cache.size > maxEntries) cache.delete(cache.keys().next().value!);
  }

  function checkOne(url: string): Promise<ImageCheckResult> {
    const hit = cached(url);
    if (hit) return Promise.resolve(hit);
    const running = inflight.get(key(url));
    if (running) return running;
    const promise = checker(url)
      .catch((): ImageCheckResult => "unknown")
      .then((result) => {
        if (result !== "unknown") store(url, result);
        return result;
      })
      .finally(() => inflight.delete(key(url)));
    inflight.set(key(url), promise);
    return promise;
  }

  async function checkCalendar(calendarId: string, urls: Urls): Promise<Partial<Record<Field, ImageCheckResult>>> {
    const t = now();
    const last = lastCheckByCalendar.get(calendarId);
    const cooling = last !== undefined && t - last < cooldownMs;
    if (!cooling) {
      lastCheckByCalendar.set(calendarId, t);
      while (lastCheckByCalendar.size > maxEntries) lastCheckByCalendar.delete(lastCheckByCalendar.keys().next().value!);
    }
    const entries = await Promise.all(
      FIELDS.map(async (field) => {
        const url = urls[field];
        if (!url) return [field, undefined] as const;
        return [field, cooling ? cached(url) ?? "unknown" : await checkOne(url)] as const;
      })
    );
    return Object.fromEntries(entries.filter(([, r]) => r !== undefined));
  }

  return { checkOne, checkCalendar };
}

/**
 * Lógica de `checkImageUrlsAction` sin Next/Convex (inyectables): primero
 * la autorización — un no-Admin NUNCA llega al comprobador —, luego las
 * URLs ya guardadas del calendario (nunca URLs del cliente).
 */
export async function runImageCheck({
  calendarId,
  isAdmin,
  loadSavedUrls,
  service,
}: {
  calendarId: string;
  isAdmin: () => Promise<boolean>;
  loadSavedUrls: () => Promise<Urls | null>;
  service: Pick<ImageCheckService, "checkCalendar">;
}): Promise<ImageUrlWarnings> {
  if (!(await isAdmin())) return {};
  const urls = await loadSavedUrls();
  if (!urls) return {};
  const results = await service.checkCalendar(calendarId, urls);
  const warnings: ImageUrlWarnings = {};
  if (results.coverImageUrl === "page") warnings.coverImageUrl = true;
  if (results.backgroundImageUrl === "page") warnings.backgroundImageUrl = true;
  return warnings;
}
