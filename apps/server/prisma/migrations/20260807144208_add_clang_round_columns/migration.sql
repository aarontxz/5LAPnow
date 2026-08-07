/*
  Warnings:

  - Added the required column `eatPaymentPerCard` to the `ClangRound` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "ClangRound" ADD COLUMN     "bonusHits" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "eatPaymentPerCard" INTEGER NOT NULL;
