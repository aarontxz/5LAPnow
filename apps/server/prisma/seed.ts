import { PrismaClient } from "@prisma/client";
import { NO_LIMIT_TEXAS_HOLDEM, DOUBLE_BOARD_BOMB_POT, TRIPLE_BOARD_BOMB_POT } from "@5lapnow/game-engine";

const prisma = new PrismaClient();

async function seedGame(game: typeof NO_LIMIT_TEXAS_HOLDEM) {
  const definition = JSON.parse(JSON.stringify(game));
  await prisma.gameDefinition.upsert({
    where: { id: game.id },
    update: { name: game.name, description: game.description, definition },
    create: { id: game.id, name: game.name, description: game.description, source: "builtin", definition },
  });
  console.log(`Seeded builtin game definition: ${game.name}`);
}

async function main() {
  await seedGame(NO_LIMIT_TEXAS_HOLDEM);
  await seedGame(DOUBLE_BOARD_BOMB_POT);
  await seedGame(TRIPLE_BOARD_BOMB_POT);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
