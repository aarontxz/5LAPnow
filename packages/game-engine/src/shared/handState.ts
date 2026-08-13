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
  /** Player chose to voluntarily reveal their hole cards after the hand completed, even though they weren't required to. */
  shown: boolean;
  /**
   * Snapshot of this player's hole cards at the moment they folded, taken
   * only when `reshuffleFoldedCardsIntoDeck` clears `holeCards` back to `[]`
   * for real-time dealing purposes (e.g. ESG). For every other game, folded
   * `holeCards` are never cleared, so this stays null and callers should just
   * read `holeCards` directly — history-persistence code should prefer this
   * field when set, falling back to `holeCards` otherwise.
   */
  foldedHoleCards: Card[] | null;
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
  /** Which board (0-indexed) this share was won on — only set for multi-board (double/triple board bomb pot) hands. */
  boardIndex?: number;
  /** Total point-race score (out of the number of scoring categories) this share was won with — only set under `scoring: "point-race"`. */
  points?: number;
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
  /** Seats that had to show their cards because they were eligible in a pot contested by more than one player. Everyone else won every pot they were eligible for uncontested and may choose to voluntarily reveal instead. */
  mustShowSeats: number[];
}

/** `"post"` covers antes/blinds; the rest mirror `PlayerAction["type"]` from bettingRound.ts. */
export type HandActionType = "post" | "fold" | "check" | "call" | "bet" | "raise";

export interface BettingActionLogEntry {
  streetName: string;
  seatIndex: number;
  type: HandActionType;
  /** Chips committed by this action, or null for actions with no chip amount (fold/check). */
  amount: number | null;
}

/** Community cards dealt this street — full identities logged, since board cards are always public. */
export interface DealCommunityCardsLogEntry {
  streetName: string;
  type: "dealCommunityCards";
  boardIndex: number;
  cards: Card[];
}

/** Initial hole cards dealt at the start of a hand — count only, never identities: a live spectator never learns a hole card until it's revealed as part of a seat's final hand at showdown, never per-card as it's dealt. */
export interface DealHoleCardsLogEntry {
  streetName: string;
  type: "dealHoleCards";
  seatIndex: number;
  count: number;
}

/** Mid-street hole-card top-up (draw-style variants, e.g. ESG) — count only, same reasoning as DealHoleCardsLogEntry. */
export interface RedrawLogEntry {
  streetName: string;
  type: "redraw";
  seatIndex: number;
  count: number;
}

export type HandActionLogEntry = BettingActionLogEntry | DealCommunityCardsLogEntry | DealHoleCardsLogEntry | RedrawLogEntry;

export interface HandState {
  gameDefinition: GameDefinition;
  handNumber: number;
  buttonSeatIndex: number;
  streetIndex: number;
  /** Flat union of all boards; equals boards[0] for single-board games. */
  board: Card[];
  boards: Card[][];
  /** Community cards that would have come next — null until any player rabbit hunts (or N/A, all cards dealt). Same cards for everyone once drawn; who can actually see them is gated per-viewer by `rabbitRevealedSeats`. */
  rabbitBoard: Card[] | null;
  rabbitBoards: Card[][] | null;
  /** Seats that have individually chosen to rabbit hunt — each sees `rabbitBoard`/`rabbitBoards` privately once their own seat is in here. */
  rabbitRevealedSeats: Set<number>;
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

/**
 * How many of each seat's hole cards came from the most recent deal/redraw
 * event — walks backward from the end of `actions` while the entries are
 * `dealHoleCards`/`redraw`, summing per seat, and stops at the first action
 * that isn't one of those (so it's naturally empty once any betting action
 * has happened since). Mirrors ClangEngine's "was the last action my draw?"
 * pattern, generalized to cover a redraw event that deals several seats —
 * and several cards each — in one go. Pass a prefix of `actions` (e.g. up to
 * a specific replay step) to get the answer as of that point in time instead
 * of "right now".
 */
export function recentlyDealtCounts(actions: HandActionLogEntry[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (let i = actions.length - 1; i >= 0; i--) {
    const action = actions[i] as HandActionLogEntry;
    if (action.type !== "dealHoleCards" && action.type !== "redraw") break;
    counts.set(action.seatIndex, (counts.get(action.seatIndex) ?? 0) + action.count);
  }
  return counts;
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
