"use client";

import { useEffect, useRef } from "react";
import type { ClangLastPlayView, PublicSeatView } from "@5lapnow/shared-types";
import { playCardDealSound } from "@/lib/sound";

/**
 * Plays the deal-card sound once per Clang Play (a discard of one rank —
 * `count` cards at once), reusing the same staggered multi-card playback as
 * a poker community-card deal. Dedup'd on `roundNumber:actionIndex`, same
 * reasoning as `useEatSound`.
 *
 * `seats` silences an away seat's auto-discarded Play (see
 * ClangService.resolveAwayTurns) — an automatic filler move, not a real
 * decision, so it shouldn't sound like one.
 */
export function useClangPlaySound(
  roundNumber: number | null,
  lastPlay: ClangLastPlayView | null,
  seats: PublicSeatView[] | undefined
): void {
  const lastKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (roundNumber == null || lastPlay == null) return;
    const key = `${roundNumber}:${lastPlay.actionIndex}`;
    if (lastKeyRef.current === key) return;
    lastKeyRef.current = key;
    const actorIsAway = seats?.find((s) => s.seatIndex === lastPlay.seatIndex)?.status === "sitting-out";
    if (!actorIsAway) playCardDealSound(lastPlay.count);
  }, [roundNumber, lastPlay?.actionIndex]);
}
