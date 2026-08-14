"use client";

import { useEffect, useRef } from "react";
import type { ClangResultView } from "@5lapnow/shared-types";
import { playClangCalledSound } from "@/lib/sound";

/**
 * Plays once when a round ends via someone actually calling Clang (normal
 * or instant) — not for a "forced" end (draw pile exhausted, nobody
 * called). Dedup'd on `roundNumber` so it never repeats for the same
 * round's later re-broadcasts (e.g. a chat message arriving after the round
 * already ended).
 */
export function useClangCalledSound(roundNumber: number | null, result: ClangResultView | null): void {
  const lastRoundRef = useRef<number | null>(null);

  useEffect(() => {
    if (roundNumber == null || result == null) return;
    if (result.type !== "call" && result.type !== "instant") return;
    if (lastRoundRef.current === roundNumber) return;
    lastRoundRef.current = roundNumber;
    playClangCalledSound();
  }, [roundNumber, result?.type]);
}
