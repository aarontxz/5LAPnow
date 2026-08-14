"use client";

import { useEffect, useRef } from "react";
import type { HandView } from "@5lapnow/shared-types";
import { playCardDealSound, playCheckSound, playChipsSound, playFoldSound } from "@/lib/sound";

/**
 * Plays a sound effect for every new action logged in the current poker
 * hand — keyed off `HandView.lastAction`'s `actionIndex` (scoped by
 * `handNumber`, since it resets to 0 each hand) so an unrelated snapshot
 * rebroadcast (e.g. a chat message arriving while a hand is live) never
 * replays the same action's sound twice. Only ever looks at the single most
 * recent action, so at most one sound plays per render — no risk of a
 * "catch-up" flood of every action in the hand's history firing at once on
 * mount/reconnect.
 */
export function useHandActionSounds(hand: HandView | null): void {
  const lastKeyRef = useRef<string | null>(null);
  const actionIndex = hand?.lastAction?.actionIndex ?? null;
  const handNumber = hand?.handNumber ?? null;

  useEffect(() => {
    if (hand?.lastAction == null || actionIndex == null || handNumber == null) return;
    const key = `${handNumber}:${actionIndex}`;
    if (lastKeyRef.current === key) return;
    lastKeyRef.current = key;

    const action = hand.lastAction;
    switch (action.type) {
      case "check":
        playCheckSound();
        break;
      case "fold":
        playFoldSound();
        break;
      case "call":
        playChipsSound("call");
        break;
      case "bet":
      case "raise":
        playChipsSound("bet");
        break;
      case "post":
        playChipsSound("post");
        break;
      case "dealCommunityCards":
        playCardDealSound(action.cards.length);
        break;
      case "dealHoleCards":
      case "redraw":
        // No sound for hole cards being dealt to a player's own hand.
        break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handNumber, actionIndex]);
}
