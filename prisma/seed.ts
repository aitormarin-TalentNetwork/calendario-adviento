// Siembra el catálogo fijo de Skin. Ejecutar con `npx prisma db seed`
// (Prisma 7 no lo dispara solo tras `migrate dev`/`reset` — hay que
// invocarlo aparte). Idempotente: se puede correr varias veces sin duplicar
// filas, y retira los que ya no están en SKINS (si no están en uso).
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Prisma } from "../src/generated/prisma/client.js";

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

  const keys = SKINS.map((skin) => skin.key);
  const retired = await prisma.skin.findMany({ where: { key: { notIn: keys } } });
  let removed = 0;
  for (const skin of retired) {
    try {
      await prisma.skin.delete({ where: { id: skin.id } });
      removed += 1;
    } catch (error) {
      // P2003 = Prisma normaliza aquí cualquier violación de FK del motor
      // subyacente — es el único caso esperado ("sigue en uso por algún
      // Calendar"). Cualquier otro error (conexión, permisos, ...) debe
      // propagarse y no dejar el seed pasar por "OK".
      const isForeignKeyViolation =
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003";
      if (!isForeignKeyViolation) {
        throw error;
      }
      console.warn(`No se pudo retirar el skin "${skin.key}" — sigue en uso por algún Calendar.`);
    }
  }

  console.log(`Seed OK: ${SKINS.length} skins (${removed} retirados).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
