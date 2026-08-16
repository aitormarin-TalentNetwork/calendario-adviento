import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export type AuthorizedUser = { id: string; email: string; isSuperAdmin: boolean };

/**
 * Usuario autenticado, con `isSuperAdmin` leído siempre en fresco de la base
 * de datos — nunca del JWT/sesión. El JWT solo dice "quién eres" (dura hasta
 * 30 días); usarlo también como fuente de "qué privilegios tienes ahora
 * mismo" significa que revocar (o conceder) Super Admin en BD no surtiría
 * efecto hasta que expire o se recree la sesión (hallazgo de auditoría,
 * ronda 1). Toda comprobación de rol/privilegio debe pasar por aquí, no por
 * `session.user` directamente.
 *
 * Se busca por `session.user.id` (el `userId` inmutable que auth.ts guardó
 * en el JWT al hacer login), NUNCA por email: buscar por email vincula la
 * sesión a "quien tenga ahora mismo ese email en BD", no a la persona que
 * inició sesión — si ese User se borra y otro se crea después con el mismo
 * email, una sesión de hasta 30 días pasaría a representar a la persona
 * nueva y heredaría sus privilegios (hallazgo de auditoría, ronda 2).
 */
export async function getAuthorizedUser(): Promise<AuthorizedUser | null> {
  const session = await auth();
  if (!session?.user?.id) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, isSuperAdmin: true },
  });
  return user;
}
