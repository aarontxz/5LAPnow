"use client";

import { useEffect, useRef } from "react";
import type { ClangLastDrawView, PublicSeatView } from "@5lapnow/shared-types";
import { playCardDealSound } from "@/lib/sound";

/**
 * Plays the deal-card sound once per Clang draw — but only on the drawer's
 * own client. Unlike `useClangPlaySound` (a Play is public, everyone should
 * hear it), a draw only adds a card to the drawer's own hidden hand, so
 * every OTHER client sees the exact same `lastDraw` broadcast and must stay
 * silent for it. Dedup'd on `roundNumber:actionIndex`, same reasoning as
 * `useEatSound`.
 *
 * `seats` silences an away seat's own auto-drawn card (see
 * ClangService.resolveAwayTurns) even on that seat's own client, if it's
 * still connected — an automatic filler move, not a real decision.
 */
export function useClangDrawSound(
  roundNumber: number | null,
  lastDraw: ClangLastDrawView | null,
  mySeatIndex: number | null,
  seats: PublicSeatView[] | undefined
): void {
  const lastKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (roundNumber == null || lastDraw == null) return;
    const key = `${roundNumber}:${lastDraw.actionIndex}`;
    if (lastKeyRef.current === key) return;
    lastKeyRef.current = key;
    if (mySeatIndex === null || lastDraw.seatIndex !== mySeatIndex) return;
    const actorIsAway = seats?.find((s) => s.seatIndex === lastDraw.seatIndex)?.status === "sitting-out";
    if (!actorIsAway) playCardDealSound(1);
  }, [roundNumber, lastDraw?.actionIndex, mySeatIndex]);
}
