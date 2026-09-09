"use client";

import { useEffect, useRef } from "react";
import type { ClangLastEatView } from "@5lapnow/shared-types";
import { playEatSound } from "@/lib/sound";

/**
 * Plays the slurp sound once per Eat, repeated per card eaten (2 cards eaten
 * slurps twice, 3 cards thrice). `lastEat` only carries the total chips paid
 * (`amount = eatPaymentPerCard * cardsEaten`), so the card count is derived
 * by dividing back out — `eatPaymentPerCard` is a sibling field on the round,
 * not on the eat itself. Dedup'd on `roundNumber:actionIndex` — `actionIndex`
 * alone resets to 0 at the start of every round, so an eat early in a later
 * round could collide with an already-played index from an earlier round and
 * get silently skipped without the round number in the key.
 */
export function useEatSound(
  roundNumber: number | null,
  lastEat: ClangLastEatView | null,
  eatPaymentPerCard: number | null,
): void {
  const lastKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (roundNumber == null || lastEat == null) return;
    const key = `${roundNumber}:${lastEat.actionIndex}`;
    if (lastKeyRef.current === key) return;
    lastKeyRef.current = key;
    const cardsEaten = eatPaymentPerCard ? Math.round(lastEat.amount / eatPaymentPerCard) : 1;
    playEatSound(cardsEaten);
  }, [roundNumber, lastEat?.actionIndex, lastEat?.amount, eatPaymentPerCard]);
}
