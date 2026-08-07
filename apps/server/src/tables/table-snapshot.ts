import { GameDefinition, HandState, TableState, getLegalActions } from "@5lapnow/game-engine";
import { HandPlayerView, HandView, PublicSeatView, RotationSlot, SeatRequestView, TableSnapshot } from "@5lapnow/shared-types";

export interface RotationSlotRuntime {
  gameDefinitionId: string;
  gameName: string;
  count: number;
}

export interface NextGameOverride {
  gameDefinitionId: string;
  gameName: string;
}

export interface SeatRequestState {
  id: string;
  seatIndex: number;
  userId: string;
  displayName: string;
  requestedBuyIn: number;
}

export interface PendingStackAdjustment {
  userId: string;
  newStack: number;
}

export interface RuntimeTable {
  tableId: string;
  ownerId: string;
  /** Null until the owner has taken a seat (and thus picked a name) at their own table. */
  ownerDisplayName: string | null;
  gameDefinition: GameDefinition;
  table: TableState;
  hand: HandState | null;
  handCounter: number;
  pendingRequests: SeatRequestState[];
  /** Keyed by seatIndex; applied at the start of the next hand (see TablesService.startHand). */
  pendingStackAdjustments: Map<number, PendingStackAdjustment>;
  /** Seats (by seatIndex) that asked to stand up mid-hand; auto-check/folded until the hand completes, then evicted. */
  standRequests: Set<number>;
  rotation: RotationSlotRuntime[];
  rotationCursor: { slotIndex: number; handInSlot: number };
  /** One-hand game override set by the owner; cleared at the start of the next hand. */
  nextGameOverride: NextGameOverride | null;
}

function totalPot(hand: HandState): number {
  let sum = 0;
  for (const p of hand.players.values()) sum += p.totalContributed;
  return sum;
}

/**
 * Builds the per-viewer TableSnapshot: a player only ever sees their own
 * hole cards while a hand is live; everyone's cards are revealed once the
 * hand reaches "complete" (unless they folded, in which case they stay hidden).
 */
export function buildTableSnapshot(runtime: RuntimeTable, viewerUserId: string | null): TableSnapshot {
  const { table, hand, gameDefinition } = runtime;

  const seats: PublicSeatView[] = table.seats.map((s) => {
    const pending = runtime.pendingStackAdjustments.get(s.seatIndex);
    return {
      seatIndex: s.seatIndex,
      playerId: s.playerId,
      displayName: s.displayName,
      stack: s.stack,
      status: s.status,
      pendingStackAdjustment: pending && pending.userId === s.playerId ? pending.newStack : null,
      leavingAfterHand: runtime.standRequests.has(s.seatIndex),
    };
  });

  let handView: HandView | null = null;
  if (hand) {
    const street = gameDefinition.streets[hand.streetIndex];
    const players: HandPlayerView[] = [...hand.players.values()].map((p) => {
      const isOwnSeat = viewerUserId !== null && table.seats[p.seatIndex]?.playerId === viewerUserId;
      const revealAtComplete = hand.phase === "complete" && !p.folded;
      return {
        seatIndex: p.seatIndex,
        folded: p.folded,
        allIn: p.allIn,
        committedThisStreet: p.committedThisStreet,
        totalContributed: p.totalContributed,
        holeCardCount: p.holeCards.length,
        holeCards: isOwnSeat || revealAtComplete ? p.holeCards : null,
      };
    });

    const turnSeatIndex = hand.bettingRound?.turnSeatIndex ?? null;
    const viewerSeat = turnSeatIndex !== null ? table.seats[turnSeatIndex] : null;
    const legalActions =
      turnSeatIndex !== null && viewerSeat?.playerId === viewerUserId
        ? getLegalActions(table, hand, turnSeatIndex)
        : null;

    handView = {
      handNumber: hand.handNumber,
      streetName: street?.name ?? "showdown",
      phase: hand.phase,
      board: hand.board,
      boards: hand.boards.length > 1 ? hand.boards : null,
      rabbitBoard: hand.rabbitBoard,
      rabbitBoards: hand.rabbitBoards,
      pot: totalPot(hand),
      turnSeatIndex,
      players,
      results: hand.results?.pots ?? null,
      legalActions,
    };
  }

  const pendingRequests: SeatRequestView[] = runtime.pendingRequests.map((r) => ({
    id: r.id,
    seatIndex: r.seatIndex,
    userId: r.userId,
    displayName: r.displayName,
    requestedBuyIn: r.requestedBuyIn,
  }));

  const nextGame: NextGameOverride =
    runtime.nextGameOverride ??
    (runtime.rotation[runtime.rotationCursor.slotIndex]
      ? { gameDefinitionId: runtime.rotation[runtime.rotationCursor.slotIndex]!.gameDefinitionId, gameName: runtime.rotation[runtime.rotationCursor.slotIndex]!.gameName }
      : { gameDefinitionId: gameDefinition.id, gameName: gameDefinition.name });

  const rotation: RotationSlot[] = runtime.rotation.map((s) => ({
    gameDefinitionId: s.gameDefinitionId,
    gameName: s.gameName,
    count: s.count,
  }));

  return {
    tableId: runtime.tableId,
    gameDefinitionId: gameDefinition.id,
    gameName: gameDefinition.name,
    ownerId: runtime.ownerId,
    ownerDisplayName: runtime.ownerDisplayName,
    seats,
    pendingRequests,
    buttonSeatIndex: table.buttonSeatIndex,
    handInProgress: hand !== null && hand.phase !== "complete",
    hand: handView,
    rotation,
    nextGameDefinitionId: nextGame.gameDefinitionId,
    nextGameName: nextGame.gameName,
  };
}
