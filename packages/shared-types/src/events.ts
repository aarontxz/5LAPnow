import type { PlayerAction } from "@5lapnow/game-engine";
import type { TableSnapshot } from "./dto.js";

export interface SeatRequestPayload {
  tableId: string;
  seatIndex: number;
  buyIn: number;
  /** Chosen at request time; must be unique among seated/pending players at this table. */
  displayName: string;
}

export interface SeatApprovalPayload {
  tableId: string;
  requestId: string;
  /** The owner may edit the requested amount before approving. */
  buyIn: number;
}

export interface HandActionRequest {
  tableId: string;
  action: PlayerAction;
}

export interface SeatAdjustStackPayload {
  tableId: string;
  seatIndex: number;
  newStack: number;
}

export interface SeatIndexPayload {
  tableId: string;
  seatIndex: number;
}

export interface SeatAwayPayload {
  tableId: string;
  seatIndex: number;
  away: boolean;
}

export interface ClangRankPayload {
  tableId: string;
  rank: number;
}

export interface ClientToServerEvents {
  "table:join": (payload: { tableId: string }) => void;
  "table:leave": (payload: { tableId: string }) => void;
  /** Sits directly if the requester owns the table, otherwise queues for owner approval. */
  "seat:request": (payload: SeatRequestPayload) => void;
  "seat:approve": (payload: SeatApprovalPayload) => void;
  "seat:reject": (payload: { tableId: string; requestId: string }) => void;
  "seat:cancelRequest": (payload: { tableId: string; requestId: string }) => void;
  "seat:stand": (payload: { tableId: string }) => void;
  /** Owner-only: sets a seated player's stack directly, recorded as a buy-in/cash-out delta. */
  "seat:adjustStack": (payload: SeatAdjustStackPayload) => void;
  /** Owner-only: forcibly stands another player up. */
  "seat:remove": (payload: SeatIndexPayload) => void;
  /** Owner-only: marks a seated player away (skipped for future deals) or back active. */
  "seat:setAway": (payload: SeatAwayPayload) => void;
  /** Owner-only: hands table ownership to the player in this seat. */
  "table:transferOwnership": (payload: SeatIndexPayload) => void;
  /** Owner-only: deals the next hand/round using the current or queued game — poker or Clang, resolved server-side. */
  "table:startHand": (payload: { tableId: string }) => void;
  /** Owner-only: sets a one-hand/round game override (any engine; cleared once the next hand/round starts). */
  "table:setNextGame": (payload: { tableId: string; gameDefinitionId: string }) => void;
  "hand:action": (payload: HandActionRequest) => void;
  /** Any seated player can request to see the undealt community cards after a hand ends early. */
  "hand:revealRabbit": (payload: { tableId: string }) => void;
  /** On your turn: discard all cards of this rank. */
  "clang:play": (payload: ClangRankPayload) => void;
  /** Only legal for the specific eligible next-player while awaiting an Eat decision, and only if they hold a matching card. */
  "clang:eat": (payload: { tableId: string }) => void;
  "clang:passEat": (payload: { tableId: string }) => void;
  /** On your turn, instead of playing: reveal all hands, lowest total wins. */
  "clang:callClang": (payload: { tableId: string }) => void;
  /** Out of turn: only legal during the instant-21 window, for a holder of exactly 21. */
  "clang:callClangInstant": (payload: { tableId: string }) => void;
}

export interface ServerToClientEvents {
  "table:snapshot": (snapshot: TableSnapshot) => void;
  "action:error": (payload: { message: string }) => void;
}
