"use client";

import { useEffect, useRef } from "react";
import { playYourTurnSound } from "@/lib/sound";

/**
 * Plays a chime on the false→true edge of `isMyTurn` — once per turn, not on
 * every re-render while it's still your turn (e.g. dragging the raise
 * slider, which re-renders the page constantly).
 */
export function useYourTurnSound(isMyTurn: boolean): void {
  const wasMyTurnRef = useRef(false);

  useEffect(() => {
    if (isMyTurn && !wasMyTurnRef.current) playYourTurnSound();
    wasMyTurnRef.current = isMyTurn;
  }, [isMyTurn]);
}
