import type { Card } from "@5lapnow/cards";

export type CardFlipPhase = "turn" | "complete";

export interface CardFlipPlayerState {
  seatIndex: number;
  hand: Card[];
}

export interface CardFlipPayment {
  fromSeatIndex: number;
  toSeatIndex: number;
  amount: number;
}

/** Per-round settlement bonuses, sourced from the table's CardFlipGameDefinition. */
export interface CardFlipBonusConfig {
  unopenedCardBonus: number;
  straightFlushBonus: number;
  fourOfAKindBonus: number;
}

export interface CardFlipRoundResult {
  winnerSeatIndices: number[];
  payments: CardFlipPayment[];
  /** Every dealt-in seat's final hand plus a human-readable label for their best 5-card hand. */
  reveal: Array<{ seatIndex: number; hand: Card[]; bestHandLabel: string }>;
}

export type CardFlipActionLogEntry =
  | { type: "deal"; seatIndices: number[] }
  | { type: "draw"; seatIndex: number; pileIndex: number }
  | { type: "complete" };

export interface CardFlipRoundState {
  roundNumber: number;
  stake: number;
  /** "X" — the MAXIMUM cards a player may draw on their turn. A turn ends as soon as the player's hand beats the current leader, even earlier than this cap; it only forces a stop if they never catch up. */
  cardsPerPlayer: number;
  bonusConfig: CardFlipBonusConfig;
  phase: CardFlipPhase;
  /** Always 3 face-down draw piles, dealt evenly at round start. */
  piles: Card[][];
  players: CardFlipPlayerState[];
  /** Seat indices in play order for this round, starting at the button. Each seat gets exactly one turn (of variable length), in this order. */
  turnOrder: number[];
  turnIndex: number;
  /** Whoever currently holds the strongest hand at the table — the target every later player's turn must beat to take over the title. Null only before the first player has drawn enough cards to be evaluated. */
  leaderSeatIndex: number | null;
  actions: CardFlipActionLogEntry[];
  result: CardFlipRoundResult | null;
}
