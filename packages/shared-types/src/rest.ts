import type { Card } from "@5lapnow/cards";
import type { HandActionLogEntry, PotResult } from "@5lapnow/game-engine";
import type { ClangActionLogEntry, ClangHandCategory, ClangPayment } from "@5lapnow/clang-engine";
import type { CardFlipActionLogEntry, CardFlipPayment } from "@5lapnow/card-flip-engine";

export type TableGameKind = "poker" | "clang" | "cardflip";

export interface CreateGuestSessionRequest {
  /** Optional: a guest can enter the lobby with no name yet, and pick one when they first request a seat. */
  displayName?: string;
}

export interface CreateGuestSessionResponse {
  userId: string;
  displayName: string | null;
  /** True once this account has linked a Google sign-in — required to host a table or request AI game generation. */
  googleLinked: boolean;
  /** The linked Google account's email, for display (e.g. "Signed in as …") — null until googleLinked. */
  email: string | null;
}

export interface GoogleSignInRequest {
  /** The Google ID token from the client's Google Identity Services sign-in. */
  idToken: string;
}

export interface CreateTableRequest {
  /** Determines the table's game mode — every table (poker or Clang) is tied to a real GameDefinition row. */
  gameDefinitionId: string;
  /** Ignored for non-poker game definitions (e.g. Clang, which has no blinds). */
  smallBlind?: number;
  bigBlind?: number;
  minBuyIn: number;
  maxBuyIn: number;
}

export interface TableSummary {
  id: string;
  name?: string;
  gameKind: TableGameKind;
  gameDefinitionId: string;
  gameName: string;
  smallBlind: number | null;
  bigBlind: number | null;
  minBuyIn: number;
  maxBuyIn: number;
  seatedCount: number;
}

export interface HandLogPlayer {
  seatIndex: number;
  userId: string | null;
  displayName: string | null;
  /** Chips this seat put into the pot across the whole hand. */
  totalContributed: number;
  /** Null if this seat's stack wasn't tracked before this hand existed (only possible for hands played before this field shipped). */
  stackBefore: number | null;
  stackAfter: number | null;
  /**
   * Redacted per-viewer by the server before this ever reaches a client — null unless
   * this is the viewer's own seat, or the seat was forced to show (contested pot) or
   * voluntarily revealed (`shown`). Never trust a client to enforce this.
   */
  holeCards: Card[] | null;
  /** Voluntarily revealed after the hand completed, even though not forced to. */
  shown: boolean;
}

export interface HandLogEntry {
  handNumber: number;
  /** The specific poker variant this hand was played as (e.g. "No-Limit Texas Hold'em", "Double Board Bomb Pot") — a table can switch variants between hands, so this is per-hand, not table-wide. */
  gameName: string;
  board: Card[];
  /** Populated only for multi-board (double/triple board bomb pot) hands; null otherwise. */
  boards: Card[][] | null;
  results: PotResult[];
  /** Who was in each seat when this hand was played, since seats can turn over later. */
  players: HandLogPlayer[];
  /** Ordered log of every posted blind/ante and player action taken during the hand. */
  actions: HandActionLogEntry[];
  playedAt: string;
}

export interface PlayerLedgerEntry {
  userId: string;
  displayName: string | null;
  totalBuyIn: number;
  totalCashOut: number;
  /** Chips currently on the table, if still seated. */
  currentStack: number;
  /** totalCashOut + currentStack - totalBuyIn: how much this player is up or down overall. */
  net: number;
  isSeated: boolean;
}

export interface ClangRoundLogPlayer {
  seatIndex: number;
  userId: string | null;
  displayName: string | null;
  hand: Card[];
  handValue: number;
  stackBefore: number | null;
  stackAfter: number | null;
}

export interface ClangRoundLogEntry {
  roundNumber: number;
  stake: number;
  eatPaymentPerCard: number;
  outcome: {
    type: "instant" | "call" | "forced" | "emptyHand";
    callerSeatIndex: number | null;
    winnerSeatIndices: number[];
    payments: ClangPayment[];
  };
  bonusHits: Array<{ seatIndex: number; category: ClangHandCategory; payout: number; payments: ClangPayment[] }>;
  players: ClangRoundLogPlayer[];
  actions: ClangActionLogEntry[];
  playedAt: string;
}

export interface CardFlipRoundLogPlayer {
  seatIndex: number;
  userId: string | null;
  displayName: string | null;
  hand: Card[];
  bestHandLabel: string;
  stackBefore: number | null;
  stackAfter: number | null;
}

export interface CardFlipRoundLogEntry {
  roundNumber: number;
  stake: number;
  cardsPerPlayer: number;
  outcome: {
    winnerSeatIndices: number[];
    payments: CardFlipPayment[];
  };
  players: CardFlipRoundLogPlayer[];
  actions: CardFlipActionLogEntry[];
  playedAt: string;
}

export interface TableLedgerResponse {
  hands: HandLogEntry[];
  /** Empty for poker tables. */
  clangRounds: ClangRoundLogEntry[];
  /** Empty for non-Card-Flip tables. */
  cardFlipRounds: CardFlipRoundLogEntry[];
  players: PlayerLedgerEntry[];
}
