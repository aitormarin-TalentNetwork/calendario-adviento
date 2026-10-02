import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // `next dev` reescribe AGENTS.md en cada arranque para meter sus propias
  // notas de la versión — es un fichero de proceso de la fábrica (rol de
  // auditor incluido), no algo que deba tocar el scaffold de Next.
  agentRules: false,
  // TAL-67 — la imagen del día (máx. 5 MB, validado en Next y en Convex)
  // viaja del navegador a la Server Action `uploadDayImageAction`; el
  // límite por defecto de las Server Actions es 1 MB.
  experimental: {
    serverActions: {
      bodySizeLimit: "6mb",
    },
  },
};

export default nextConfig;
