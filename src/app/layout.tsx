import type { Metadata } from "next";
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
        <TimezoneSync />
        {children}
      </body>
    </html>
  );
}
