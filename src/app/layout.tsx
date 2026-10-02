import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { ConvexClientProvider } from "@/components/convex-client-provider";
import { TimezoneSync } from "@/components/timezone-sync";
import "./globals.css";

/**
 * TAL-61 — la única familia de la app (design/design-system.md § "Estilo
 * 2026 → Tipografía"). `next/font/google` la descarga en el build y la sirve
 * desde la propia app (`/_next/static/media/…`), sin pedir nada a Google en
 * tiempo de ejecución: se ve igual en Mac, Windows, iPhone y Android.
 * `latin-ext` para tildes, ñ y ç. Expone `--font-jakarta`, que `globals.css`
 * usa en el token `--font`.
 */
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
  variable: "--font-jakarta",
});

export const metadata: Metadata = {
  title: "Calendario de Adviento",
  description: "Calendarios de adviento personalizados con un vídeo-regalo cada día.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className={jakarta.variable}>
      <body>
        <ConvexClientProvider>
          <TimezoneSync />
          {children}
        </ConvexClientProvider>
      </body>
    </html>
  );
}
