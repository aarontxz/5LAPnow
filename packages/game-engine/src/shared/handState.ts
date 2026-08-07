import { Card, Deck } from "@5lapnow/cards";
import { GameDefinition } from "./gameDefinition.js";
import { Seat } from "./table.js";

export interface HandPlayerState {
  seatIndex: number;
  holeCards: Card[];
  folded: boolean;
  allIn: boolean;
  /** Total chips put into the pot across the whole hand (all streets). */
  totalContributed: number;
  /** Chips put in during the current betting round only. */
  committedThisStreet: number;
  hasActedThisRound: boolean;
}

export interface BettingRoundState {
  /** Highest `committedThisStreet` any player must match to call. */
  currentBet: number;
  /** Minimum legal raise increment (no-limit: last raise size, or big blind if no raise yet). */
  minRaiseIncrement: number;
  turnSeatIndex: number | null;
  /** Seat whose bet/raise reopened the action; round closes when action returns to them. */
  lastAggressorSeatIndex: number | null;
}

export type HandPhase = "betting" | "showdown" | "complete";

export interface PotShare {
  seatIndex: number;
  amount: number;
  /** Human-readable label for the hand this share was won with, e.g. "Full House, Kings full of Fives". Omitted for uncontested (win-by-fold) pots. */
  description?: string;
}

export interface PotResult {
  amount: number;
  eligibleSeats: number[];
  hiWinners: PotShare[];
  loWinners: PotShare[];
}

export interface ShowdownResult {
  pots: PotResult[];
  /** Seats that reached showdown (i.e. not folded, not folded-out earlier). */
  revealedSeats: number[];
}

/** `"post"` covers antes/blinds; the rest mirror `PlayerAction["type"]` from bettingRound.ts. */
export type HandActionType = "post" | "fold" | "check" | "call" | "bet" | "raise";

export interface HandActionLogEntry {
  streetName: string;
  seatIndex: number;
  type: HandActionType;
  /** Chips committed by this action, or null for actions with no chip amount (fold/check). */
  amount: number | null;
}

export interface HandState {
  gameDefinition: GameDefinition;
  handNumber: number;
  buttonSeatIndex: number;
  streetIndex: number;
  board: Card[];
  deck: Deck;
  players: Map<number, HandPlayerState>;
  /** Acting order for this hand (seat indices), starting left of the button. */
  seatOrder: number[];
  bettingRound: BettingRoundState | null;
  phase: HandPhase;
  results: ShowdownResult | null;
  /** Ordered log of every posted blind/ante and player action taken this hand. */
  actions: HandActionLogEntry[];
}

/** Street name for the action currently being taken; forced bets (streetIndex -1) belong to the first street. */
export function currentStreetName(hand: HandState): string {
  const street = hand.gameDefinition.streets[Math.max(hand.streetIndex, 0)];
  return street?.name ?? `street-${hand.streetIndex}`;
}

export function orderSeatsFromButton(seats: Seat[], buttonSeatIndex: number): number[] {
  const activeIndices = seats.filter((s) => s.status === "active" && s.stack > 0).map((s) => s.seatIndex);
  let buttonPos = activeIndices.indexOf(buttonSeatIndex);
  if (buttonPos === -1) {
    // Button seat is no longer active; advance to the next active seat clockwise
    const nextActive = activeIndices.find((i) => i > buttonSeatIndex) ?? activeIndices[0];
    buttonPos = activeIndices.indexOf(nextActive!);
  }
  return [...activeIndices.slice(buttonPos + 1), ...activeIndices.slice(0, buttonPos + 1)];
}

export function totalPot(hand: HandState): number {
  let sum = 0;
  for (const p of hand.players.values()) sum += p.totalContributed;
  return sum;
}

export function activeHandPlayers(hand: HandState): HandPlayerState[] {
  return [...hand.players.values()].filter((p) => !p.folded);
}
