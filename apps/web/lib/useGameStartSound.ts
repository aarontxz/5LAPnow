"use client";

import { useEffect, useRef } from "react";
import { playCardDealSound } from "@/lib/sound";

/**
 * Plays the deal-card sound once when a new hand/round begins. `gameNumber`
 * is whichever of `hand.handNumber` / `clangRound.roundNumber` /
 * `cardFlipRound.roundNumber` is currently active — all three are facets of
 * the same table-wide monotonic `RuntimeTable.gameCounter` (see CLAUDE.md:
 * "hand/round numbers stay one continuous timeline across engine
 * switches"), so a plain "did this change" ref is enough to dedupe without
 * needing to scope by engine.
 */
export function useGameStartSound(gameNumber: number | null): void {
  const lastRef = useRef<number | null>(null);

  useEffect(() => {
    if (gameNumber != null && lastRef.current !== gameNumber) playCardDealSound(1);
    lastRef.current = gameNumber;
  }, [gameNumber]);
}
