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
  "table:startHand": (payload: { tableId: string }) => void;
  /** Owner-only: sets a one-hand game override (cleared after the next hand starts). */
  "table:setNextGame": (payload: { tableId: string; gameDefinitionId: string }) => void;
  /** Owner-only: defines the repeating game rotation for this table. */
  "table:setRotation": (payload: { tableId: string; rotation: Array<{ gameDefinitionId: string; count: number }> }) => void;
  "hand:action": (payload: HandActionRequest) => void;
  /** Any seated player can request to see the undealt community cards after a hand ends early. */
  "hand:revealRabbit": (payload: { tableId: string }) => void;
}

export interface ServerToClientEvents {
  "table:snapshot": (snapshot: TableSnapshot) => void;
  "action:error": (payload: { message: string }) => void;
}
