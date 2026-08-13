-- Dedupe existing duplicate round/hand history rows (caused by a settlement
-- idempotency bug: a completed round could be re-persisted whenever a
-- player toggled "away" before the next round started) before adding the
-- constraints that prevent this going forward. For each (tableId, number)
-- group, keeps only the earliest row (by playedAt, then id as a tiebreak)
-- and deletes the rest. This never touches Seat.stack or ChipTransaction —
-- only removes duplicate history log rows.

DELETE FROM "ClangRound" a
USING "ClangRound" b
WHERE a."tableId" = b."tableId"
  AND a."roundNumber" = b."roundNumber"
  AND (a."playedAt" > b."playedAt" OR (a."playedAt" = b."playedAt" AND a."id" > b."id"));

DELETE FROM "CardFlipRound" a
USING "CardFlipRound" b
WHERE a."tableId" = b."tableId"
  AND a."roundNumber" = b."roundNumber"
  AND (a."playedAt" > b."playedAt" OR (a."playedAt" = b."playedAt" AND a."id" > b."id"));

DELETE FROM "Hand" a
USING "Hand" b
WHERE a."tableId" = b."tableId"
  AND a."handNumber" = b."handNumber"
  AND (a."playedAt" > b."playedAt" OR (a."playedAt" = b."playedAt" AND a."id" > b."id"));

-- AlterTable
ALTER TABLE "ClangRound" ADD CONSTRAINT "ClangRound_tableId_roundNumber_key" UNIQUE ("tableId", "roundNumber");

-- AlterTable
ALTER TABLE "CardFlipRound" ADD CONSTRAINT "CardFlipRound_tableId_roundNumber_key" UNIQUE ("tableId", "roundNumber");

-- AlterTable
ALTER TABLE "Hand" ADD CONSTRAINT "Hand_tableId_handNumber_key" UNIQUE ("tableId", "handNumber");
