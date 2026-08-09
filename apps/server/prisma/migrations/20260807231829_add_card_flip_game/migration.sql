-- AlterEnum
ALTER TYPE "GameEngine" ADD VALUE 'cardflip';

-- CreateTable
CREATE TABLE "CardFlipRound" (
    "id" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "roundNumber" INTEGER NOT NULL,
    "stake" INTEGER NOT NULL,
    "cardsPerPlayer" INTEGER NOT NULL,
    "outcome" JSONB NOT NULL,
    "players" JSONB NOT NULL,
    "actions" JSONB NOT NULL DEFAULT '[]',
    "playedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardFlipRound_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "CardFlipRound" ADD CONSTRAINT "CardFlipRound_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "Table"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

