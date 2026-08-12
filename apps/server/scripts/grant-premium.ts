import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Manually grants (or extends) a signed-in account's Premium subscription — purchases are
 * handled via Google Form, not in-app payment (see PREMIUM_PRICING.md). Usage:
 *
 *   pnpm --filter @5lapnow/server grant-premium <email> <months>
 */
async function main() {
  const [email, monthsArg] = process.argv.slice(2);
  const months = Number(monthsArg);
  if (!email || !monthsArg || !Number.isFinite(months) || months <= 0) {
    console.error("Usage: pnpm --filter @5lapnow/server grant-premium <email> <months>");
    process.exit(1);
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error(`No user with email ${email} (they must sign in with Google at least once first)`);

  // Extends from the later of "now" or their current expiry, so renewing before lapse doesn't lose time.
  const base = user.premiumUntil && user.premiumUntil > new Date() ? user.premiumUntil : new Date();
  const premiumUntil = new Date(base);
  premiumUntil.setMonth(premiumUntil.getMonth() + months);

  await prisma.user.update({ where: { id: user.id }, data: { premiumUntil } });

  console.log(`Granted ${email} Premium until ${premiumUntil.toISOString()}`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
