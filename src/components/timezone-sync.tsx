"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const COOKIE_NAME = "tz";

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Deja la zona horaria real del navegador en una cookie (`tz`) para que el
 * servidor pueda calcular "hoy" con `todayInTimeZone` (src/lib/
 * calendars.ts) al resolver qué puertas están desbloqueadas — sin esto,
 * `resolveDoors` no tiene forma de saber en qué huso horario está quien
 * mira el calendario (no se guarda por persona en BD). No pinta nada — solo
 * sincroniza y, si la cookie estaba desactualizada o no existía todavía
 * (primera visita), pide un refresco para que la página ya la use.
 */
export function TimezoneSync() {
  const router = useRouter();

  useEffect(() => {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!detected || readCookie(COOKIE_NAME) === detected) return;

    document.cookie = `${COOKIE_NAME}=${encodeURIComponent(detected)}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }, [router]);

  return null;
}
