/*
  Warnings:

  - Added the required column `players` to the `Hand` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
-- Existing rows predate this snapshot; backfill with an empty array so the
-- log just shows no per-seat names for those older hands.
ALTER TABLE "Hand" ADD COLUMN     "players" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "Hand" ALTER COLUMN "players" DROP DEFAULT;
