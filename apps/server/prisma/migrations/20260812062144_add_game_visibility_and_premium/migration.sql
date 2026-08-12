-- CreateEnum
CREATE TYPE "GameVisibility" AS ENUM ('PUBLIC', 'PRIVATE', 'PREMIUM_HOST');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "premiumUntil" TIMESTAMP(3);

-- AlterTable: add "visibility" alongside the old "restricted" column first, so we can
-- backfill from it before dropping it.
ALTER TABLE "GameDefinition" ADD COLUMN     "visibility" "GameVisibility" NOT NULL DEFAULT 'PUBLIC';

-- Backfill: previously-restricted games owned by an account become PRIVATE (the "Game
-- Request" tier); previously-restricted games with no owner (the seeded premium builtins,
-- e.g. Double/Triple Board Bomb Pot) become PREMIUM_HOST. Unrestricted games stay PUBLIC.
UPDATE "GameDefinition"
SET "visibility" = CASE
  WHEN "restricted" AND "createdById" IS NOT NULL THEN 'PRIVATE'::"GameVisibility"
  WHEN "restricted" THEN 'PREMIUM_HOST'::"GameVisibility"
  ELSE 'PUBLIC'::"GameVisibility"
END;

-- AlterTable
ALTER TABLE "GameDefinition" DROP COLUMN "restricted";
