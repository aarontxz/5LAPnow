-- AlterEnum
ALTER TYPE "ChipTransactionType" ADD VALUE 'bounty';

-- AlterTable
ALTER TABLE "Hand" ADD COLUMN     "bounty" JSONB;
