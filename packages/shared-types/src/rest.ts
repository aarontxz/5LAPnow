import type { Card } from "@5lapnow/cards";
import type { HandActionLogEntry, PotResult } from "@5lapnow/game-engine";
import type { ClangActionLogEntry, ClangHandCategory, ClangPayment } from "@5lapnow/clang-engine";

export type TableGameKind = "poker" | "clang";

export interface CreateGuestSessionRequest {
  /** Optional: a guest can enter the lobby with no name yet, and pick one when they first request a seat. */
  displayName?: string;
}

export interface CreateGuestSessionResponse {
  userId: string;
  displayName: string | null;
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
}

export interface HandLogEntry {
  handNumber: number;
  board: Card[];
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
}

export interface ClangRoundLogEntry {
  roundNumber: number;
  stake: number;
  eatPaymentPerCard: number;
  outcome: {
    type: "instant" | "call" | "forced";
    callerSeatIndex: number | null;
    winnerSeatIndices: number[];
    payments: ClangPayment[];
  };
  bonusHits: Array<{ seatIndex: number; category: ClangHandCategory; payout: number; payments: ClangPayment[] }>;
  players: ClangRoundLogPlayer[];
  actions: ClangActionLogEntry[];
  playedAt: string;
}

export interface TableLedgerResponse {
  hands: HandLogEntry[];
  /** Empty for poker tables. */
  clangRounds: ClangRoundLogEntry[];
  players: PlayerLedgerEntry[];
}
