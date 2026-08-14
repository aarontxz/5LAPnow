"use client";

import { useEffect } from "react";
import { playTurnReminderSound } from "@/lib/sound";

const REMINDER_DELAY_MS = 5000;
const SECOND_REMINDER_DELAY_MS = 10000;

/**
 * Plays the same alert twice if it's still your turn: once at
 * REMINDER_DELAY_MS, again at SECOND_REMINDER_DELAY_MS if you still haven't
 * acted — a nudge for anyone who stepped away. Re-arms on every `isMyTurn`
 * toggle: a fresh turn starts fresh timers, and acting (or the turn moving
 * on) before either delay elapses cancels both via the effect's own
 * cleanup, so at most one of each ever fires per turn.
 */
export function useTurnReminderSound(isMyTurn: boolean): void {
  useEffect(() => {
    if (!isMyTurn) return;
    const firstTimer = setTimeout(() => playTurnReminderSound(), REMINDER_DELAY_MS);
    const secondTimer = setTimeout(() => playTurnReminderSound(), SECOND_REMINDER_DELAY_MS);
    return () => {
      clearTimeout(firstTimer);
      clearTimeout(secondTimer);
    };
  }, [isMyTurn]);
}
