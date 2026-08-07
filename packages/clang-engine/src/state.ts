import type { Card } from "@5lapnow/cards";
import type { ClangHandCategory } from "./scoring.js";

export type ClangPhase = "instant-window" | "awaiting-eat" | "turn" | "complete";

export interface ClangPlayerState {
  seatIndex: number;
  hand: Card[];
}

export interface ClangPendingEat {
  /** The player who originally played the cards — pays every eater in the chain. */
  discarderSeatIndex: number;
  eaterSeatIndex: number;
  rank: number;
  /** Number of successful eats that have already occurred in this chain (0 on first offer). */
  chainDepth: number;
}

export interface ClangPayment {
  fromSeatIndex: number;
  toSeatIndex: number;
  amount: number;
}

export interface ClangBonusHit {
  seatIndex: number;
  category: ClangHandCategory;
  /** Amount paid to this seat by each other seat (not the total collected). */
  payout: number;
  payments: ClangPayment[];
}

export interface ClangRoundResult {
  type: "instant" | "call" | "forced";
  /** Null for a forced (deck-exhaustion) showdown — there's no caller to favor on ties. */
  callerSeatIndex: number | null;
  winnerSeatIndices: number[];
  payments: ClangPayment[];
  reveal: Array<{ seatIndex: number; hand: Card[]; value: number }>;
}

export type ClangActionLogEntry =
  | { type: "deal"; seatIndices: number[] }
  | { type: "bonus"; seatIndex: number; category: ClangHandCategory; payout: number }
  | { type: "play"; seatIndex: number; rank: number; count: number }
  | { type: "eat"; discarderSeatIndex: number; eaterSeatIndex: number; rank: number; count: number }
  | { type: "eatDeclined"; seatIndex: number; rank: number }
  | { type: "draw"; seatIndex: number }
  | { type: "callClangInstant"; seatIndex: number }
  | { type: "callClang"; seatIndex: number }
  | { type: "forcedShowdown" };

export interface ClangRoundState {
  roundNumber: number;
  stake: number;
  /** Chips paid per card the eater discards when they Eat (independent of `stake`). */
  eatPaymentPerCard: number;
  phase: ClangPhase;
  drawPile: Card[];
  discardPile: Card[];
  players: ClangPlayerState[];
  /** Seat indices in play order for this round, starting at the button. Fixed for the whole round. */
  turnOrder: number[];
  turnIndex: number;
  allowInstantClang: boolean;
  pendingEat: ClangPendingEat | null;
  /** Starting-hand bounties paid out at deal time (e.g. a Four of a Kind or Straight Flush), independent of the round's eventual outcome. */
  bonusHits: ClangBonusHit[];
  actions: ClangActionLogEntry[];
  result: ClangRoundResult | null;
}
