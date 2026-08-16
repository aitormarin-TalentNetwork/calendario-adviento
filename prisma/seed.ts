// Siembra el catálogo fijo de Skin. Ejecutar con `npx prisma db seed` (o
// automáticamente tras `prisma migrate dev`/`reset`, ver prisma.config.ts).
// Idempotente: se puede correr varias veces sin duplicar filas.
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const SKINS = [
  { key: "pine", name: "Pino", description: "Verde pino con acentos dorados — skin por defecto." },
  { key: "berry", name: "Grosella", description: "Rojo grosella oscuro." },
  { key: "midnight", name: "Medianoche", description: "Azul noche." },
  { key: "gold", name: "Dorado", description: "Dorado cálido." },
];

async function main() {
  for (const skin of SKINS) {
    await prisma.skin.upsert({
      where: { key: skin.key },
      update: { name: skin.name, description: skin.description },
      create: skin,
    });
  }
  console.log(`Seed OK: ${SKINS.length} skins.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
