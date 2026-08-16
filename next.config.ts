import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // `next dev` reescribe AGENTS.md en cada arranque para meter sus propias
  // notas de la versión — es un fichero de proceso de la fábrica (rol de
  // auditor incluido), no algo que deba tocar el scaffold de Next.
  agentRules: false,
};

export default nextConfig;
