import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Manually grants a signed-in account access to a `restricted` GameDefinition — the only way
 * this happens for now (see GameDefinitionAccess in prisma/schema.prisma). Usage:
 *
 *   pnpm --filter @5lapnow/server grant-game-access <email> <gameDefinitionId>
 */
async function main() {
  const [email, gameDefinitionId] = process.argv.slice(2);
  if (!email || !gameDefinitionId) {
    console.error("Usage: pnpm --filter @5lapnow/server grant-game-access <email> <gameDefinitionId>");
    process.exit(1);
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error(`No user with email ${email} (they must sign in with Google at least once first)`);

  const gameDefinition = await prisma.gameDefinition.findUnique({ where: { id: gameDefinitionId } });
  if (!gameDefinition) throw new Error(`No game definition with id ${gameDefinitionId}`);

  await prisma.gameDefinitionAccess.upsert({
    where: { userId_gameDefinitionId: { userId: user.id, gameDefinitionId } },
    update: {},
    create: { userId: user.id, gameDefinitionId },
  });

  console.log(`Granted ${email} access to "${gameDefinition.name}" (${gameDefinitionId})`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
