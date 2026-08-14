"use client";

import { useEffect, useRef } from "react";
import type { ClangLastPlayView } from "@5lapnow/shared-types";
import { playCardDealSound } from "@/lib/sound";

/**
 * Plays the deal-card sound once per Clang Play (a discard of one rank —
 * `count` cards at once), reusing the same staggered multi-card playback as
 * a poker community-card deal. Dedup'd on `roundNumber:actionIndex`, same
 * reasoning as `useEatSound`.
 */
export function useClangPlaySound(roundNumber: number | null, lastPlay: ClangLastPlayView | null): void {
  const lastKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (roundNumber == null || lastPlay == null) return;
    const key = `${roundNumber}:${lastPlay.actionIndex}`;
    if (lastKeyRef.current === key) return;
    lastKeyRef.current = key;
    playCardDealSound(lastPlay.count);
  }, [roundNumber, lastPlay?.actionIndex]);
}
