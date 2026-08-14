"use client";

import { useEffect, useRef } from "react";
import type { ClangLastEatView } from "@5lapnow/shared-types";
import { playEatSound } from "@/lib/sound";

/**
 * Plays the slurp sound once per Eat. Dedup'd on `roundNumber:actionIndex`
 * — `actionIndex` alone resets to 0 at the start of every round, so an eat
 * early in a later round could collide with an already-played index from an
 * earlier round and get silently skipped without the round number in the key.
 */
export function useEatSound(roundNumber: number | null, lastEat: ClangLastEatView | null): void {
  const lastKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (roundNumber == null || lastEat == null) return;
    const key = `${roundNumber}:${lastEat.actionIndex}`;
    if (lastKeyRef.current === key) return;
    lastKeyRef.current = key;
    playEatSound();
  }, [roundNumber, lastEat?.actionIndex]);
}
