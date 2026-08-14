"use client";

import { useEffect, useRef } from "react";
import type { Card } from "@5lapnow/cards";
import { playCardDealSound } from "@/lib/sound";

/**
 * Plays the deal-card sound once per 10 Card Flip draw. Dedup'd on
 * `roundNumber:pileIndex:rank:suit` — Card Flip's view model doesn't expose
 * an action-log index for draws, so the drawn card's own identity stands in
 * for one; pairing it with the round number still rules out a same-card
 * collision across rounds.
 */
export function useCardFlipDrawSound(roundNumber: number | null, pileIndex: number | null, card: Card | null): void {
  const lastKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (roundNumber == null || pileIndex == null || card == null) return;
    const key = `${roundNumber}:${pileIndex}:${card.rank}:${card.suit}`;
    if (lastKeyRef.current === key) return;
    lastKeyRef.current = key;
    playCardDealSound(1);
  }, [roundNumber, pileIndex, card?.rank, card?.suit]);
}
