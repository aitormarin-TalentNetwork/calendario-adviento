// Fixtures de desarrollo para probar a mano la autenticación/protección de
// rutas de TAL-2 (login de Gmail, roles, invitaciones) sin depender de
// prisma/seed.ts (que es de TAL-3/T1 — este script no lo toca).
//
// Uso: npx tsx scripts/dev-seed-fixtures.ts
// Idempotente: se puede correr varias veces, hace upsert por email/key.
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const SUPER_ADMIN_EMAIL = "superadmin.dev@example.com";
const ADMIN_EMAIL = "admin.dev@example.com";
const INVITED_GUEST_EMAIL = "invitado.dev@example.com";
const UNINVITED_EMAIL = "sin-invitacion.dev@example.com";
// Invitación guardada con mayúsculas a propósito — para probar que hace
// match con el login (que siempre normaliza a minúsculas) sin depender de
// que la columna sea citext (ver docs/auth.md, corrección de auditoría).
const CASE_MISMATCH_INVITATION_EMAIL = "MAYUS.dev@Example.COM";
const CASE_MISMATCH_LOGIN_EMAIL = "mayus.dev@example.com";
// Invitado sin aceptar todavía — para probar con curl que aceptar la
// invitación dos veces en paralelo no rompe (upsert idempotente).
const RACE_TEST_EMAIL = "race.dev@example.com";

async function main() {
  const skin = await prisma.skin.upsert({
    where: { key: "dev-fixtures" },
    update: {},
    create: { key: "dev-fixtures", name: "Fixture de desarrollo" },
  });

  const superAdmin = await prisma.user.upsert({
    where: { email: SUPER_ADMIN_EMAIL },
    update: { isSuperAdmin: true },
    create: { email: SUPER_ADMIN_EMAIL, name: "Super Admin (dev)", isSuperAdmin: true },
  });

  const adminUser = await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: {},
    create: { email: ADMIN_EMAIL, name: "Admin (dev)" },
  });

  const calendar = await prisma.calendar.upsert({
    where: { id: "00000000-0000-0000-0000-000000000d2c" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000d2c",
      name: "Calendario de pruebas T2",
      coverTitle: "¡Feliz cuenta atrás, equipo! 🎄",
      startDate: new Date("2026-12-01"),
      endDate: new Date("2026-12-24"),
      skinId: skin.id,
    },
  });

  await prisma.calendarMembership.upsert({
    where: { calendarId_userId: { calendarId: calendar.id, userId: adminUser.id } },
    update: { role: "ADMIN" },
    create: { calendarId: calendar.id, userId: adminUser.id, role: "ADMIN" },
  });

  // Invitado con invitación pendiente de "aceptar" — a propósito NO se crea
  // aquí la CalendarMembership: eso lo hace resolveCalendarAccess() la
  // primera vez que este email inicia sesión y visita /c/<calendarId>.
  await prisma.invitation.upsert({
    where: { calendarId_email: { calendarId: calendar.id, email: INVITED_GUEST_EMAIL } },
    update: {},
    create: { calendarId: calendar.id, email: INVITED_GUEST_EMAIL },
  });

  await prisma.invitation.upsert({
    where: { calendarId_email: { calendarId: calendar.id, email: CASE_MISMATCH_INVITATION_EMAIL } },
    update: {},
    create: { calendarId: calendar.id, email: CASE_MISMATCH_INVITATION_EMAIL },
  });

  await prisma.invitation.upsert({
    where: { calendarId_email: { calendarId: calendar.id, email: RACE_TEST_EMAIL } },
    update: {},
    create: { calendarId: calendar.id, email: RACE_TEST_EMAIL },
  });

  console.log("Fixtures listas. Con AUTH_DEV_LOGIN=true, en /login puedes entrar como:\n");
  console.log(`  Super Admin  → ${SUPER_ADMIN_EMAIL}  → prueba /superadmin`);
  console.log(`  Admin        → ${ADMIN_EMAIL}  → prueba /admin/${calendar.id}`);
  console.log(`  Invitado     → ${INVITED_GUEST_EMAIL}  → prueba /c/${calendar.id} (crea su membership GUEST al entrar)`);
  console.log(`  Sin invitación → ${UNINVITED_EMAIL}  → prueba /c/${calendar.id} (debe acabar en /unauthorized)`);
  console.log(`  Mayúsculas   → invitación a "${CASE_MISMATCH_INVITATION_EMAIL}", login con "${CASE_MISMATCH_LOGIN_EMAIL}" → prueba /c/${calendar.id}`);
  console.log(`  Carrera      → ${RACE_TEST_EMAIL} (sin aceptar todavía) → para probar con curl en paralelo`);
  console.log(`\ncalendarId de pruebas: ${calendar.id}`);
  console.log(`superAdmin.id=${superAdmin.id}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
