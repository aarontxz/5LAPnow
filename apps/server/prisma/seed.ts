import { PrismaClient } from "@prisma/client";
import { NO_LIMIT_TEXAS_HOLDEM } from "@5lapnow/game-engine";

const prisma = new PrismaClient();

async function main() {
  const definition = JSON.parse(JSON.stringify(NO_LIMIT_TEXAS_HOLDEM));
  await prisma.gameDefinition.upsert({
    where: { id: NO_LIMIT_TEXAS_HOLDEM.id },
    update: {
      name: NO_LIMIT_TEXAS_HOLDEM.name,
      description: NO_LIMIT_TEXAS_HOLDEM.description,
      definition,
    },
    create: {
      id: NO_LIMIT_TEXAS_HOLDEM.id,
      name: NO_LIMIT_TEXAS_HOLDEM.name,
      description: NO_LIMIT_TEXAS_HOLDEM.description,
      source: "builtin",
      definition,
    },
  });
  console.log(`Seeded builtin game definition: ${NO_LIMIT_TEXAS_HOLDEM.name}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
