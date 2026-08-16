import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/lib/auth.config";

// Instancia "ligera" (sin Prisma) solo para el middleware — ver
// src/lib/auth.config.ts. Aquí solo comprobamos que hay sesión; el rol
// concreto (Super Admin / Admin / Invitado por calendario) se resuelve en
// cada página, que sí puede consultar la base de datos.
const { auth } = NextAuth(authConfig);

const PROTECTED_PREFIXES = ["/superadmin", "/admin", "/c"];

export default auth((req) => {
  const { pathname, search } = req.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );

  if (isProtected && !req.auth) {
    const loginUrl = new URL("/login", req.nextUrl.origin);
    loginUrl.searchParams.set("callbackUrl", pathname + search);
    return NextResponse.redirect(loginUrl);
  }
});

export const config = {
  matcher: ["/superadmin/:path*", "/admin/:path*", "/c/:path*"],
};
