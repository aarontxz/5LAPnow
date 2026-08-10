import type { PlayerAction } from "@5lapnow/game-engine";
import type { ChatMessageView, TableSnapshot } from "./dto.js";

export interface ChatSendPayload {
  tableId: string;
  body: string;
}

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
  /** "add"/"remove" are relative to whatever the stack is when this actually applies (immediately, or at the next hand/round if queued mid-hand) — never a snapshot taken at request time, since the stack can keep changing until then. "set" is the one genuinely absolute mode. */
  mode: "add" | "remove" | "set";
  amount: number;
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

export interface CardFlipDrawPayload {
  tableId: string;
  pileIndex: number;
}

export interface ClientToServerEvents {
  "table:join": (payload: { tableId: string }) => void;
  "table:leave": (payload: { tableId: string }) => void;
  /** Sits directly if the requester owns the table, otherwise queues for owner approval. */
  "seat:request": (payload: SeatRequestPayload) => void;
  "seat:approve": (payload: SeatApprovalPayload) => void;
  "seat:reject": (payload: { tableId: string; requestId: string }) => void;
  "seat:cancelRequest": (payload: { tableId: string; requestId: string }) => void;
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
  /** After a hand completes, a player who wasn't forced to show at a contested showdown (won uncontested, or folded earlier) can voluntarily reveal their hole cards to everyone. */
  "hand:showCards": (payload: { tableId: string }) => void;
  /** On your turn, before you may discard: draw one card from the pile. */
  "clang:draw": (payload: { tableId: string }) => void;
  /** After drawing: discard all cards of this rank. */
  "clang:play": (payload: ClangRankPayload) => void;
  /** Only legal for the specific eligible next-player while awaiting an Eat decision, and only if they hold a matching card. */
  "clang:eat": (payload: { tableId: string }) => void;
  "clang:passEat": (payload: { tableId: string }) => void;
  /** On your turn, instead of playing: reveal all hands, lowest total wins. */
  "clang:callClang": (payload: { tableId: string }) => void;
  /** Out of turn: only legal during the instant-21 window, for a holder of exactly 21. */
  "clang:callClangInstant": (payload: { tableId: string }) => void;
  /** On your turn: draw one card from pile 0, 1, or 2. */
  "cardflip:draw": (payload: CardFlipDrawPayload) => void;
  /** Any seated-or-not visitor to the table can chat — trimmed and length-capped server-side. */
  "chat:send": (payload: ChatSendPayload) => void;
}

export interface ServerToClientEvents {
  "table:snapshot": (snapshot: TableSnapshot) => void;
  "action:error": (payload: { message: string }) => void;
  /** Sent once right after table:join, most-recent-last, so the panel has scrollback without a separate REST call. */
  "chat:history": (messages: ChatMessageView[]) => void;
  /** One new message, broadcast to everyone in the room (including the sender) as it's sent. */
  "chat:message": (message: ChatMessageView) => void;
}
