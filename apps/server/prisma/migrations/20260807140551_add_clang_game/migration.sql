-- CreateEnum
CREATE TYPE "TableGameKind" AS ENUM ('poker', 'clang');

-- DropForeignKey
ALTER TABLE "Table" DROP CONSTRAINT "Table_gameDefinitionId_fkey";

-- AlterTable
ALTER TABLE "Table" ADD COLUMN     "gameKind" "TableGameKind" NOT NULL DEFAULT 'poker',
ALTER COLUMN "gameDefinitionId" DROP NOT NULL,
ALTER COLUMN "smallBlind" DROP NOT NULL,
ALTER COLUMN "bigBlind" DROP NOT NULL;

-- CreateTable
CREATE TABLE "ClangRound" (
    "id" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "roundNumber" INTEGER NOT NULL,
    "stake" INTEGER NOT NULL,
    "outcome" JSONB NOT NULL,
    "players" JSONB NOT NULL,
    "actions" JSONB NOT NULL DEFAULT '[]',
    "playedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClangRound_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Table" ADD CONSTRAINT "Table_gameDefinitionId_fkey" FOREIGN KEY ("gameDefinitionId") REFERENCES "GameDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClangRound" ADD CONSTRAINT "ClangRound_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "Table"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
