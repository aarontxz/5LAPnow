"use client";

import { useEffect, useRef } from "react";
import type { Card } from "@5lapnow/cards";
import type { PublicSeatView } from "@5lapnow/shared-types";
import { playCardDealSound } from "@/lib/sound";

/**
 * Plays the deal-card sound once per 10 Card Flip draw. Dedup'd on
 * `roundNumber:pileIndex:rank:suit` — Card Flip's view model doesn't expose
 * an action-log index for draws, so the drawn card's own identity stands in
 * for one; pairing it with the round number still rules out a same-card
 * collision across rounds.
 *
 * `drawerSeatIndex`/`seats` silence an away seat's auto-drawn card (see
 * CardFlipService.resolveAwayTurns) — an automatic filler move, not a real
 * decision, so it shouldn't sound like one.
 */
export function useCardFlipDrawSound(
  roundNumber: number | null,
  pileIndex: number | null,
  card: Card | null,
  drawerSeatIndex: number | null,
  seats: PublicSeatView[] | undefined
): void {
  const lastKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (roundNumber == null || pileIndex == null || card == null) return;
    const key = `${roundNumber}:${pileIndex}:${card.rank}:${card.suit}`;
    if (lastKeyRef.current === key) return;
    lastKeyRef.current = key;
    const actorIsAway = drawerSeatIndex != null && seats?.find((s) => s.seatIndex === drawerSeatIndex)?.status === "sitting-out";
    if (!actorIsAway) playCardDealSound(1);
  }, [roundNumber, pileIndex, card?.rank, card?.suit]);
}
