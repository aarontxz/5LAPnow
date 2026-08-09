import { PrismaClient } from "@prisma/client";
import { NO_LIMIT_TEXAS_HOLDEM, DOUBLE_BOARD_BOMB_POT, TRIPLE_BOARD_BOMB_POT } from "@5lapnow/game-engine";
import { parseClangGameDefinition } from "@5lapnow/clang-engine";
import { parseCardFlipGameDefinition } from "@5lapnow/card-flip-engine";

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

async function seedClang() {
  const id = "builtin-clang";
  const name = "Clang";
  const description = "Discard-and-draw card game — call Clang on exactly 21, or the lowest hand wins at showdown.";
  const definition = JSON.parse(JSON.stringify(parseClangGameDefinition({})));
  await prisma.gameDefinition.upsert({
    where: { id },
    update: { name, description, engine: "clang", definition },
    create: { id, name, description, source: "builtin", engine: "clang", definition },
  });
  console.log(`Seeded builtin game definition: ${name}`);
}

async function seedCardFlip() {
  const id = "builtin-card-flip";
  const name = "10 Card Flip";
  const description = "Draw one card at a time from 3 shared piles until everyone holds 10 cards — best 5-card poker hand wins the stake from everybody.";
  const definition = JSON.parse(JSON.stringify(parseCardFlipGameDefinition({})));
  await prisma.gameDefinition.upsert({
    where: { id },
    update: { name, description, engine: "cardflip", definition },
    create: { id, name, description, source: "builtin", engine: "cardflip", definition },
  });
  console.log(`Seeded builtin game definition: ${name}`);
}

async function main() {
  await seedGame(NO_LIMIT_TEXAS_HOLDEM);
  await seedGame(DOUBLE_BOARD_BOMB_POT);
  await seedGame(TRIPLE_BOARD_BOMB_POT);
  await seedClang();
  await seedCardFlip();
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
