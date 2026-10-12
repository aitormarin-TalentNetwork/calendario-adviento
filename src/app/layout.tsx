import type { Metadata } from "next";
import "./fonts/plus-jakarta-sans";
import { ConvexClientProvider } from "@/components/convex-client-provider";
import { TimezoneSync } from "@/components/timezone-sync";
import "./globals.css";

/*
 * TAL-61 — la única familia de la app (design/design-system.md § "Estilo
 * 2026 → Tipografía"), servida desde la propia app (`/_next/static/media/…`):
 * se ve igual en Mac, Windows, iPhone y Android. TAL-79 — autoalojada con
 * next/font/local (`./fonts/plus-jakarta-sans`, importado arriba solo por
 * efecto: emite las `@font-face` y la precarga); el build ya no depende de
 * Google. `--font-jakarta` lo define `globals.css` (bloque TAL-79).
 */

export const metadata: Metadata = {
  title: "Calendario de Adviento",
  description: "Calendarios de adviento personalizados con un vídeo-regalo cada día.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es">
      <body>
        <ConvexClientProvider>
          <TimezoneSync />
          {children}
        </ConvexClientProvider>
      </body>
    </html>
  );
}
