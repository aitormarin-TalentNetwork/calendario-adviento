import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Calendario de Adviento",
  description: "Calendarios de adviento personalizados con un vídeo-regalo cada día.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
