import { GameDefinition, HandState, PotResult, TableState, getLegalActions, recentlyDealtCounts } from "@5lapnow/game-engine";
import { ClangRoundState, handValue } from "@5lapnow/clang-engine";
import { CardFlipRoundState, describePartialHand } from "@5lapnow/card-flip-engine";
import { Card, describeEvaluatedHand, evaluateBestHand, evaluateBestHandExact } from "@5lapnow/cards";
import {
  CardFlipLegalActions,
  CardFlipPlayerView,
  CardFlipRoundView,
  ClangLegalActions,
  ClangPlayerView,
  ClangRoundView,
  HandPlayerView,
  HandStrengthCategory,
  HandView,
  PublicSeatView,
  SeatRequestView,
  TableGameConfigOverrides,
  TableGameKind,
  TableSnapshot,
} from "@5lapnow/shared-types";

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
  /** "add"/"remove" are resolved against the live stack at apply time (immediately, or when flushed at the next hand/round start) — never against a stale snapshot taken when this was queued, since the stack can keep moving (wins/losses/eats) until then. "set" is the one genuinely absolute mode. */
  mode: "add" | "remove" | "set";
  amount: number;
}

/** Resolves a pending add/remove/set against `currentStack` — used both for the live "→ X next hand" snapshot preview (recomputed fresh every broadcast, so it tracks the stack as it moves) and for the real application at flush time. */
export function resolvePendingStackAdjustment(currentStack: number, adjustment: PendingStackAdjustment): number {
  if (adjustment.mode === "add") return currentStack + adjustment.amount;
  if (adjustment.mode === "remove") return Math.max(0, currentStack - adjustment.amount);
  return adjustment.amount;
}

export interface RuntimeTable {
  tableId: string;
  ownerId: string;
  /** Null until the owner has taken a seat (and thus picked a name) at their own table. */
  ownerDisplayName: string | null;
  gameKind: TableGameKind;
  /** The GameDefinition row this table is linked to — every table has one, poker or Clang. */
  gameDefinitionId: string;
  gameName: string;
  /** The parsed DeclarativeEngine-shaped definition; null for non-poker engines (e.g. Clang, which has no streets/blinds to parse). */
  gameDefinition: GameDefinition | null;
  table: TableState;
  hand: HandState | null;
  clangRound: ClangRoundState | null;
  cardFlipRound: CardFlipRoundState | null;
  /** Single sequence shared by all engines, so hand/round numbers stay one continuous timeline across engine switches (hand 1 NLH, hand 2 Clang, hand 3 Clang, ...). */
  gameCounter: number;
  /** Prefill hints for the owner's next "Deal" form. */
  clangLastStake: number | null;
  clangLastEatPaymentPerCard: number | null;
  pendingRequests: SeatRequestState[];
  /** Keyed by seatIndex; applied at the start of the next hand/round (see TablesService.startHand / ClangService.startRound). */
  pendingStackAdjustments: Map<number, PendingStackAdjustment>;
  /** One-hand game override set by the owner; cleared at the start of the next hand. Poker-only. */
  nextGameOverride: NextGameOverride | null;
  /** Owner-configured per-engine value overrides (blinds/ante, stake, ...) — see TableGameConfigOverrides. Persisted on Table.gameConfigOverrides, mirrored here for the hot path. */
  gameConfigOverrides: TableGameConfigOverrides;
  /**
   * Snapshot of every active seat's stack taken right before the current
   * hand/round's forced bets/stakes are posted (TablesService.startHand /
   * ClangService.startRound / CardFlipService.startRound) — read and cleared
   * at settlement time to persist `stackBefore` per seat for history/replay.
   * Null whenever no hand/round is in flight.
   */
  stacksBeforeCurrentRound: Array<{ seatIndex: number; userId: string; stack: number }> | null;
  /** `Date.now()` of the moment the most recently finished hand/round settled (poker: persistHandResult; Clang/Card Flip: settleIfComplete) — null until the table's first hand/round ever completes. Used only to enforce START_COOLDOWN_MS before the owner can start the next one. */
  roundEndedAt: number | null;
  /** Seats queued via TablesService.setSeatAwayAfterHand — consumed (flipped to sitting-out, then cleared) by TablesService.applyAwayAfterRound at the exact moment the live hand/round settles. */
  awayAfterHandSeats: Set<number>;
}

/** Cooldown after a hand/round completes before the owner can start the next one — see TablesService.assertStartCooldownElapsed. */
export const START_COOLDOWN_MS = 3000;

/** Captures every active, occupied seat's current stack — call right before forced bets/stakes are posted for a new hand/round. */
export function captureStacksBefore(table: TableState): Array<{ seatIndex: number; userId: string; stack: number }> {
  return table.seats
    .filter((s) => s.status === "active" && s.playerId !== null)
    .map((s) => ({ seatIndex: s.seatIndex, userId: s.playerId as string, stack: s.stack }));
}

/**
 * Seats that were forced to show their hand at showdown — a pure function of
 * already-persisted `results`, matching `pots.ts`'s own `settleShowdown`
 * formula exactly, so callers never need a separately-persisted field for
 * this. Used to redact a completed hand's `players[].holeCards` for anyone
 * who isn't that seat's own viewer: only a mustShow seat (or one that later
 * voluntarily revealed, tracked separately via `players[].shown`) may ever
 * have its hole cards shown to someone else.
 */
export function mustShowSeatsFromResults(results: PotResult[]): Set<number> {
  return new Set(results.filter((p) => p.eligibleSeats.length > 1).flatMap((p) => p.eligibleSeats));
}

function boardCategoryLabel(boardIndex: number, numBoards: number): string {
  if (numBoards <= 1) return "";
  if (numBoards === 2) return boardIndex === 0 ? "Top Board" : "Btm Board";
  return `Board ${boardIndex + 1}`;
}

/**
 * Live per-category hand-strength readout ("Pair of Kings", "Ace High") for
 * a poker seat's hole cards, one entry per category this game's own scoring
 * actually pays out on: one per board (using the game's `exactHoleCardsUsed`
 * rule if it has one, e.g. true Omaha), plus a hole-cards-only category for
 * point-race games that use one (`includeHandOnlyCategory`). A category's
 * `description` is null until enough cards are on the table to evaluate it
 * yet (e.g. before its board is dealt) — the category itself is always
 * present once hole cards are visible, so every applicable category shows
 * from the start of the hand, not just once a global threshold is met.
 */
function computeHandStrengthCategories(holeCards: Card[], hand: HandState, gameDefinition: GameDefinition): HandStrengthCategory[] {
  const { mode, exactHoleCardsUsed, includeHandOnlyCategory } = gameDefinition.handRanking;
  const boards = hand.boards.length > 0 ? hand.boards : [hand.board];

  const categories: HandStrengthCategory[] = boards.map((boardCards, boardIndex) => {
    let description: string | null = null;
    if (exactHoleCardsUsed !== undefined) {
      const requiredCommunity = Math.max(0, 5 - exactHoleCardsUsed);
      if (holeCards.length >= exactHoleCardsUsed && boardCards.length >= requiredCommunity) {
        description = describeEvaluatedHand(evaluateBestHandExact(holeCards, boardCards, exactHoleCardsUsed, mode), mode);
      }
    } else {
      const combined = [...holeCards, ...boardCards];
      if (combined.length >= 5) description = describeEvaluatedHand(evaluateBestHand(combined, mode), mode);
    }
    return { label: boardCategoryLabel(boardIndex, boards.length), description };
  });

  if (includeHandOnlyCategory) {
    const description = holeCards.length >= 5 ? describeEvaluatedHand(evaluateBestHand(holeCards, mode), mode) : null;
    categories.push({ label: "Hand Strength", description });
  }

  return categories;
}

function totalPot(hand: HandState): number {
  let sum = 0;
  for (const p of hand.players.values()) sum += p.totalContributed;
  return sum;
}

function buildClangRoundView(round: ClangRoundState, table: TableState, viewerUserId: string | null): ClangRoundView {
  const complete = round.phase === "complete";

  // The most recent draw (if any) is always the last card pushed onto that
  // seat's hand — cleared as soon as any other action happens (their next
  // discard/eat, or anyone else's turn), so this always points at whoever
  // last drew and is now the "current" state for everyone to see.
  const lastAction = round.actions[round.actions.length - 1];
  const justDrewSeatIndex = lastAction?.type === "draw" ? lastAction.seatIndex : null;
  const lastEat =
    lastAction?.type === "eat"
      ? {
          discarderSeatIndex: lastAction.discarderSeatIndex,
          eaterSeatIndex: lastAction.eaterSeatIndex,
          rank: lastAction.rank,
          amount: round.eatPaymentPerCard * lastAction.count,
          actionIndex: round.actions.length - 1,
        }
      : null;

  const players: ClangPlayerView[] = round.players.map((p) => {
    const isOwnSeat = viewerUserId !== null && table.seats[p.seatIndex]?.playerId === viewerUserId;
    const reveal = complete || isOwnSeat;
    return {
      seatIndex: p.seatIndex,
      handCardCount: p.hand.length,
      hand: reveal ? p.hand : null,
      handValue: reveal ? handValue(p.hand) : null,
      justDrewLastCard: reveal && p.seatIndex === justDrewSeatIndex && p.hand.length > 0,
    };
  });

  // "awaiting-discard" is still this seat's turn (turnIndex hasn't advanced yet — they've
  // drawn but not discarded), so it keeps the turn indicator/highlight lit the same as "turn".
  const turnSeatIndex =
    round.phase === "turn" || round.phase === "instant-window" || round.phase === "awaiting-discard"
      ? (round.turnOrder[round.turnIndex] ?? null)
      : null;

  const viewerSeatIndex = viewerUserId !== null ? (table.seats.find((s) => s.playerId === viewerUserId)?.seatIndex ?? null) : null;
  const viewerPlayer = viewerSeatIndex !== null ? round.players.find((p) => p.seatIndex === viewerSeatIndex) : undefined;

  let legalActions: ClangLegalActions | null = null;
  if (viewerPlayer && viewerSeatIndex !== null && !complete) {
    const isMyTurn = turnSeatIndex === viewerSeatIndex;
    // Draw first, then discard: canDraw covers the start of your turn (before you've
    // drawn); canPlay only opens up once you've drawn and must now discard.
    const canDraw = isMyTurn && (round.phase === "turn" || round.phase === "instant-window");
    const canPlay = isMyTurn && round.phase === "awaiting-discard";
    const isEligibleEater = round.phase === "awaiting-eat" && round.pendingEat?.eaterSeatIndex === viewerSeatIndex;
    const eaterHasMatch = isEligibleEater && round.pendingEat
      ? viewerPlayer.hand.some((c) => c.rank === round.pendingEat!.rank)
      : false;

    legalActions = {
      canDraw,
      canPlay,
      canCallClangNormal: canDraw,
      canCallInstantClang: !round.instantClangClosedSeats.includes(viewerSeatIndex) && handValue(viewerPlayer.hand) === 21,
      canEat: isEligibleEater && eaterHasMatch,
      canPassEat: isEligibleEater,
    };
  }

  return {
    roundNumber: round.roundNumber,
    stake: round.stake,
    eatPaymentPerCard: round.eatPaymentPerCard,
    phase: round.phase,
    turnSeatIndex,
    pendingEat: round.pendingEat,
    lastEat,
    players,
    bonusHits: round.bonusHits.map((h) => ({ seatIndex: h.seatIndex, category: h.category, payout: h.payout })),
    legalActions,
    result: round.result,
    drawPileCount: round.drawPile.length,
    topDiscard: round.lastDiscardCount > 0 ? round.discardPile.slice(-round.lastDiscardCount) : [],
    discardPileCount: round.discardPile.length,
  };
}

function buildCardFlipRoundView(round: CardFlipRoundState, table: TableState, viewerUserId: string | null): CardFlipRoundView {
  const complete = round.phase === "complete";

  // Unlike Clang/poker, every hand is public here — you need to see the
  // current leader's hand (and everyone else's) to know what you're up
  // against, since the beat-the-leader rule is the whole game.
  const lastAction = round.actions[round.actions.length - 1];
  const justDrewSeatIndex = lastAction?.type === "draw" ? lastAction.seatIndex : null;
  const lastDrawPileIndex = lastAction?.type === "draw" ? lastAction.pileIndex : null;

  const players: CardFlipPlayerView[] = round.players.map((p) => ({
    seatIndex: p.seatIndex,
    handCardCount: p.hand.length,
    hand: p.hand,
    handStrengthLabel: p.hand.length > 0 ? describePartialHand(p.hand) : null,
    justDrewLastCard: p.seatIndex === justDrewSeatIndex && p.hand.length > 0,
  }));
  const lastDrawnCard = justDrewSeatIndex !== null ? (round.players.find((p) => p.seatIndex === justDrewSeatIndex)?.hand.at(-1) ?? null) : null;

  const turnSeatIndex = round.phase === "turn" ? (round.turnOrder[round.turnIndex] ?? null) : null;
  const viewerSeatIndex = viewerUserId !== null ? (table.seats.find((s) => s.playerId === viewerUserId)?.seatIndex ?? null) : null;

  let legalActions: CardFlipLegalActions | null = null;
  if (viewerSeatIndex !== null && round.players.some((p) => p.seatIndex === viewerSeatIndex) && !complete) {
    legalActions = { canDraw: turnSeatIndex === viewerSeatIndex };
  }

  return {
    roundNumber: round.roundNumber,
    stake: round.stake,
    cardsPerPlayer: round.cardsPerPlayer,
    phase: round.phase,
    turnSeatIndex,
    leaderSeatIndex: round.leaderSeatIndex,
    pileCounts: round.piles.map((pile) => pile.length),
    lastDrawPileIndex,
    lastDrawnCard,
    players,
    legalActions,
    result: round.result,
  };
}

/**
 * Builds the per-viewer TableSnapshot: a player only ever sees their own
 * hole cards (poker) or hand (Clang/Card Flip) while a hand/round is live.
 * Once a poker hand reaches "complete", a seat's hole cards are revealed to
 * everyone only if that seat had to show (part of a pot compared against
 * another live hand) or chose to voluntarily reveal via `showCards` —
 * uncontested winners and folders stay hidden by default.
 */
export function buildTableSnapshot(runtime: RuntimeTable, viewerUserId: string | null): TableSnapshot {
  const { table, hand, gameDefinition, gameKind } = runtime;

  const seats: PublicSeatView[] = table.seats.map((s) => {
    const pending = runtime.pendingStackAdjustments.get(s.seatIndex);
    return {
      seatIndex: s.seatIndex,
      playerId: s.playerId,
      displayName: s.displayName,
      stack: s.stack,
      status: s.status,
      pendingStackAdjustment: pending && pending.userId === s.playerId ? resolvePendingStackAdjustment(s.stack, pending) : null,
      awayAfterHand: runtime.awayAfterHandSeats.has(s.seatIndex),
    };
  });

  let handView: HandView | null = null;
  if (hand && gameDefinition) {
    const street = gameDefinition.streets[hand.streetIndex];
    const viewerSeatIndex = viewerUserId !== null ? (table.seats.find((s) => s.playerId === viewerUserId)?.seatIndex ?? null) : null;
    const mustShowSeats = new Set(hand.results?.mustShowSeats ?? []);
    const dealtCounts = recentlyDealtCounts(hand.actions);
    const players: HandPlayerView[] = [...hand.players.values()].map((p) => {
      const isOwnSeat = viewerUserId !== null && table.seats[p.seatIndex]?.playerId === viewerUserId;
      // Only seats that lost a real card comparison (contested pot) are forced to show;
      // everyone else — uncontested winners and folders — stays hidden unless they opt in via `shown`.
      const revealAtComplete = hand.phase === "complete" && (mustShowSeats.has(p.seatIndex) || p.shown);
      const holeCardsVisible = isOwnSeat || revealAtComplete;
      return {
        seatIndex: p.seatIndex,
        folded: p.folded,
        allIn: p.allIn,
        committedThisStreet: p.committedThisStreet,
        totalContributed: p.totalContributed,
        holeCardCount: p.holeCards.length,
        holeCards: holeCardsVisible ? p.holeCards : null,
        canShow: isOwnSeat && hand.phase === "complete" && !revealAtComplete && p.holeCards.length > 0,
        handStrengthCategories: holeCardsVisible ? computeHandStrengthCategories(p.holeCards, hand, gameDefinition) : null,
        recentlyDealtCount: dealtCounts.get(p.seatIndex) ?? 0,
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
      // Same drawn cards for everyone, but only shown to a viewer once their own seat has revealed.
      rabbitBoard: viewerSeatIndex !== null && hand.rabbitRevealedSeats.has(viewerSeatIndex) ? hand.rabbitBoard : null,
      rabbitBoards: viewerSeatIndex !== null && hand.rabbitRevealedSeats.has(viewerSeatIndex) ? hand.rabbitBoards : null,
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
    runtime.nextGameOverride ?? { gameDefinitionId: runtime.gameDefinitionId, gameName: runtime.gameName };

  const clangRound = runtime.clangRound ? buildClangRoundView(runtime.clangRound, table, viewerUserId) : null;
  const cardFlipRound = runtime.cardFlipRound ? buildCardFlipRoundView(runtime.cardFlipRound, table, viewerUserId) : null;

  const handInProgress =
    gameKind === "poker"
      ? hand !== null && hand.phase !== "complete"
      : gameKind === "clang"
        ? runtime.clangRound !== null && runtime.clangRound.phase !== "complete"
        : runtime.cardFlipRound !== null && runtime.cardFlipRound.phase !== "complete";

  return {
    tableId: runtime.tableId,
    gameKind,
    gameDefinitionId: runtime.gameDefinitionId,
    gameName: runtime.gameName,
    ownerId: runtime.ownerId,
    ownerDisplayName: runtime.ownerDisplayName,
    seats,
    pendingRequests,
    buttonSeatIndex: table.buttonSeatIndex,
    handInProgress,
    hand: handView,
    nextGameDefinitionId: nextGame.gameDefinitionId,
    nextGameName: nextGame.gameName,
    clangRound,
    clangLastStake: runtime.clangLastStake,
    clangLastEatPaymentPerCard: runtime.clangLastEatPaymentPerCard,
    cardFlipRound,
    canStartAt: runtime.roundEndedAt === null ? null : runtime.roundEndedAt + START_COOLDOWN_MS,
  };
}
