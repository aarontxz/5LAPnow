"use client";

import { useEffect } from "react";
import { playTurnReminderSound } from "@/lib/sound";

const REMINDER_DELAY_MS = 5000;

/**
 * Plays a more insistent alert if it's still your turn REMINDER_DELAY_MS
 * after it started — a nudge for anyone who stepped away. Re-arms on every
 * `isMyTurn` toggle: a fresh turn starts a fresh timer, and acting (or the
 * turn moving on) before the delay elapses cancels it via the effect's own
 * cleanup, so at most one reminder ever fires per turn.
 */
export function useTurnReminderSound(isMyTurn: boolean): void {
  useEffect(() => {
    if (!isMyTurn) return;
    const timer = setTimeout(() => playTurnReminderSound(), REMINDER_DELAY_MS);
    return () => clearTimeout(timer);
  }, [isMyTurn]);
}
