-- Leftover deck at hand completion (Deck.peekRemaining(), in order) — lets a
-- hand replay compute a rabbit hunt later even if nobody ever triggered it
-- live. Existing hands get an empty array (no rabbit-hunt support for hands
-- played before this column existed — the deck order genuinely wasn't
-- recorded, nothing to backfill).
ALTER TABLE "Hand" ADD COLUMN "remainingDeck" JSONB NOT NULL DEFAULT '[]';

-- Persisted the first time anyone reveals a rabbit hunt for this hand (live
-- or via replay), so it only needs to be computed once.
ALTER TABLE "Hand" ADD COLUMN "rabbitBoard" JSONB;
ALTER TABLE "Hand" ADD COLUMN "rabbitBoards" JSONB;
