import type { Card } from "@5lapnow/cards";
import type { ClangHandCategory } from "./scoring.js";

export type ClangPhase = "instant-window" | "awaiting-eat" | "turn" | "awaiting-discard" | "complete";

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
  type: "instant" | "call" | "forced" | "emptyHand";
  /** Null for a forced (deck-exhaustion) showdown or an emptyHand win — neither has a caller to favor on ties (an emptyHand win has no ties at all: it's decided by who emptied their hand first, not by comparing hand values). */
  callerSeatIndex: number | null;
  winnerSeatIndices: number[];
  payments: ClangPayment[];
  reveal: Array<{ seatIndex: number; hand: Card[]; value: number }>;
}

export type ClangActionLogEntry =
  | { type: "deal"; seatIndices: number[]; hands: Array<{ seatIndex: number; hand: Card[] }> }
  | { type: "bonus"; seatIndex: number; category: ClangHandCategory; payout: number }
  | { type: "play"; seatIndex: number; rank: number; count: number; cards: Card[] }
  | { type: "eat"; discarderSeatIndex: number; eaterSeatIndex: number; rank: number; count: number; amount: number; cards: Card[] }
  | { type: "eatDeclined"; seatIndex: number; rank: number }
  | { type: "draw"; seatIndex: number; card: Card }
  | { type: "callClangInstant"; seatIndex: number }
  | { type: "callClang"; seatIndex: number }
  | { type: "forcedShowdown" }
  | { type: "emptyHand"; seatIndex: number };

export interface ClangRoundState {
  roundNumber: number;
  stake: number;
  /** Chips paid per card the eater discards when they Eat (independent of `stake`). */
  eatPaymentPerCard: number;
  phase: ClangPhase;
  drawPile: Card[];
  discardPile: Card[];
  /** Number of cards from the tail of `discardPile` that belong to the most recent discard (a Play or an Eat) — lets viewers see the whole batch, not just one card. */
  lastDiscardCount: number;
  players: ClangPlayerState[];
  /** Seat indices in play order for this round, starting at the button. Fixed for the whole round. */
  turnOrder: number[];
  turnIndex: number;
  /** Seat indices that have taken their own first turn action (Draw or Call Clang) and
   * have therefore lost their shot at an instant Clang. Each seat's "golden window" lasts
   * until *their own* first turn, independent of what other seats have already done —
   * e.g. seat 2 can still call an instant Clang after seat 0 has drawn, as long as seat 2
   * hasn't taken a turn yet themselves. */
  instantClangClosedSeats: number[];
  pendingEat: ClangPendingEat | null;
  /** Set the first time any seat's hand empties out via a Play or an Eat — whichever seat
   * does that first wins the round outright, once the eat chain that Play/Eat opened up
   * finishes resolving (further players can still eat off it, even ones who themselves reach
   * zero cards in the process — see `finishDiscarderTurn`). Never overwritten once set: if a
   * later eater in the same chain also empties their hand, the round still credits the win to
   * whoever got there first. */
  emptyHandSeatIndex: number | null;
  /** Set once a turn's draw finds the pile empty: that seat still plays out its throw (and
   * any resulting eat chain) using its current hand, but the round ends the moment that
   * turn's discard/eat sequence finishes — no further turn ever gets to draw. */
  deckExhausted: boolean;
  /** Starting-hand bounties paid out at deal time (e.g. a Four of a Kind or Straight Flush), independent of the round's eventual outcome. */
  bonusHits: ClangBonusHit[];
  actions: ClangActionLogEntry[];
  result: ClangRoundResult | null;
  /** Set once this round has been persisted (ClangService.settleIfComplete) — guards against
   * re-persisting/re-paying the same round if `finish()` is re-entered after it already
   * completed (e.g. a player toggling "away" between rounds re-triggers advanceAwaySeats). */
  settled: boolean;
}
