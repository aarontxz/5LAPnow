"use client";

import { useEffect, useRef } from "react";
import { playWinSound } from "@/lib/sound";

/**
 * Plays win.wav once per distinct `resultKey` while `didWin` is true — the
 * caller is expected to pass a hand/round-scoped key (e.g. `poker:${handNumber}`)
 * only when the viewer's own seat actually won money, and `null` otherwise,
 * so this never needs its own win/loss logic and just dedupes.
 *
 * `delayMs` (default 0) queues the win sound after some other cue instead of
 * playing it immediately — Clang's call site uses this to let clang.mp3 (already
 * playing for everyone via useClangCalledSound) finish before win.wav starts,
 * rather than the two overlapping.
 */
export function useWinSound(didWin: boolean, resultKey: string | null, delayMs = 0): void {
  const lastKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!didWin || resultKey == null || lastKeyRef.current === resultKey) return;
    lastKeyRef.current = resultKey;
    const timer = setTimeout(() => playWinSound(), delayMs);
    return () => clearTimeout(timer);
  }, [didWin, resultKey, delayMs]);
}
