import type { Card } from "@5lapnow/cards";
import type { SeatStatus, HandPhase, PotResult, LegalActionInfo } from "@5lapnow/game-engine";

export interface PublicSeatView {
  seatIndex: number;
  playerId: string | null;
  displayName: string | null;
  stack: number;
  status: SeatStatus;
  /** Owner queued a stack change while a hand was in progress; takes effect when the next hand starts. */
  pendingStackAdjustment: number | null;
  /** Player asked to stand up mid-hand; they'll auto-check/fold on their turns until the hand ends, then be removed. */
  leavingAfterHand: boolean;
}

export interface HandPlayerView {
  seatIndex: number;
  folded: boolean;
  allIn: boolean;
  committedThisStreet: number;
  totalContributed: number;
  holeCardCount: number;
  /** Populated only for the viewer's own seat, or every non-folded seat once the hand is complete. */
  holeCards: Card[] | null;
}

export interface HandView {
  handNumber: number;
  streetName: string;
  phase: HandPhase;
  board: Card[];
  /** Populated only for multi-board games; null for standard single-board games. */
  boards: Card[][] | null;
  /** Undealt community cards shown after rabbit hunting; null until revealed or when all cards were already dealt. */
  rabbitBoard: Card[] | null;
  rabbitBoards: Card[][] | null;
  pot: number;
  turnSeatIndex: number | null;
  players: HandPlayerView[];
  results: PotResult[] | null;
  /** Populated only for the viewer when it is their turn to act. */
  legalActions: LegalActionInfo | null;
}

export interface SeatRequestView {
  id: string;
  seatIndex: number;
  userId: string;
  displayName: string;
  requestedBuyIn: number;
}


export interface TableSnapshot {
  tableId: string;
  gameDefinitionId: string;
  gameName: string;
  ownerId: string;
  /** Null until the owner has requested/taken a seat and picked a name. */
  ownerDisplayName: string | null;
  seats: PublicSeatView[];
  /** Seats currently awaiting the owner's approval (or auto-approval for the owner's own seat). */
  pendingRequests: SeatRequestView[];
  buttonSeatIndex: number | null;
  handInProgress: boolean;
  hand: HandView | null;
  /** Which game will be used for the next hand (owner-set override, or current game as default). */
  nextGameDefinitionId: string;
  nextGameName: string;
}
