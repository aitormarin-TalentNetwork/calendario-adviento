import type { Metadata } from "next";
import { ConvexClientProvider } from "@/components/convex-client-provider";
import { TimezoneSync } from "@/components/timezone-sync";
import "./globals.css";

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
