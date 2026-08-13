import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  computeRabbitReveal,
  createEmptyTable,
  DeclarativeEngine,
  GameDefinition,
  getLegalActions,
  HandActionLogEntry,
  PlayerAction,
  PotResult,
  RabbitReveal,
  seatPlayer,
  standPlayer,
  TableConfig,
} from "@5lapnow/game-engine";
import type { Card } from "@5lapnow/cards";
import type {
  CardFlipRoundLogEntry,
  CardFlipRoundReplayResponse,
  ChatMessageView,
  ClangRoundLogEntry,
  ClangRoundReplayResponse,
  CreateTableRequest,
  EffectiveGameConfig,
  HandLogEntry,
  HandLogPlayer,
  HandReplayResponse,
  PlayerLedgerEntry,
  SetGameConfigPayload,
  TableGameConfigOverrides,
  TableLedgerResponse,
  TableSummary,
} from "@5lapnow/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { GamesService } from "../games/games.service";
import {
  RuntimeTable,
  buildTableSnapshot,
  NextGameOverride,
  resolvePendingStackAdjustment,
  captureStacksBefore,
  mustShowSeatsFromResults,
} from "./table-snapshot";
import { buildPokerReplay } from "./replay/poker-replay";
import { buildClangReplay, ClangRoundReplayRow } from "./replay/clang-replay";
import { buildCardFlipReplay, CardFlipRoundReplayRow } from "./replay/cardflip-replay";

type TableChangeListener = (tableId: string) => void;

@Injectable()
export class TablesService implements OnModuleInit {
  private readonly runtimeTables = new Map<string, RuntimeTable>();
  private readonly listeners = new Set<TableChangeListener>();
  /** Tail of the in-flight chain of table-scoped operations, keyed by tableId — see `withTableLock`. */
  private readonly tableLocks = new Map<string, Promise<unknown>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly gamesService: GamesService
  ) {}

  /**
   * Rebuilds in-memory RuntimeTables from the DB on boot, so a server
   * restart doesn't orphan every existing table. Seats/stacks are restored
   * as of their last DB sync point; any hand that was mid-play at the time
   * of the restart is NOT recoverable (hole cards/deck/betting round are
   * never persisted) and is simply dropped — players keep the stacks they
   * had going into that hand, as if it never happened.
   */
  async onModuleInit(): Promise<void> {
    const [rows, handCounts, clangRoundCounts, cardFlipRoundCounts] = await Promise.all([
      this.prisma.table.findMany({ include: { seats: { include: { user: true } }, owner: true, gameDefinition: true } }),
      this.prisma.hand.groupBy({ by: ["tableId"], _max: { handNumber: true } }),
      this.prisma.clangRound.groupBy({ by: ["tableId"], _max: { roundNumber: true } }),
      this.prisma.cardFlipRound.groupBy({ by: ["tableId"], _max: { roundNumber: true } }),
    ]);
    // Hand/round numbers share one sequence across all engines, so the resumed
    // counter must be the max of whichever engine was played most recently at
    // that table, not the max within one engine alone.
    const maxGameNumberByTable = new Map<string, number>();
    for (const h of handCounts) {
      maxGameNumberByTable.set(h.tableId, Math.max(maxGameNumberByTable.get(h.tableId) ?? 0, h._max.handNumber ?? 0));
    }
    for (const r of clangRoundCounts) {
      maxGameNumberByTable.set(r.tableId, Math.max(maxGameNumberByTable.get(r.tableId) ?? 0, r._max.roundNumber ?? 0));
    }
    for (const r of cardFlipRoundCounts) {
      maxGameNumberByTable.set(r.tableId, Math.max(maxGameNumberByTable.get(r.tableId) ?? 0, r._max.roundNumber ?? 0));
    }

    for (const row of rows) {
      const gameKind = row.gameDefinition.engine;
      let gameDefinition = null;
      if (gameKind === "poker") {
        try {
          gameDefinition = await this.gamesService.getDefinition(row.gameDefinitionId);
        } catch {
          continue; // game definition is gone (or invalid) — can't run this table, skip it
        }
      }

      const config: TableConfig = {
        id: row.id,
        gameDefinitionId: row.gameDefinitionId,
        smallBlind: row.smallBlind ?? 0,
        bigBlind: row.bigBlind ?? 0,
        minBuyIn: row.minBuyIn,
        maxBuyIn: row.maxBuyIn,
      };
      const table = createEmptyTable(config);
      table.buttonSeatIndex = row.buttonSeatIndex;

      for (const seatRow of row.seats) {
        const seat = table.seats[seatRow.seatIndex];
        if (!seat) continue;
        seat.playerId = seatRow.userId;
        seat.displayName = seatRow.user?.displayName ?? null;
        seat.stack = seatRow.stack;
        seat.status = seatRow.status === "sitting_out" ? "sitting-out" : seatRow.status;
      }

      this.runtimeTables.set(row.id, {
        tableId: row.id,
        ownerId: row.ownerId,
        ownerDisplayName: row.owner.displayName ?? "Guest",
        gameKind,
        gameDefinitionId: row.gameDefinitionId,
        gameName: row.gameDefinition.name,
        gameDefinition,
        table,
        hand: null,
        // Any hand/round in progress at restart time is unrecoverable (live
        // deal state is never persisted) and is simply dropped, mirroring the
        // same precedent across every game kind.
        clangRound: null,
        cardFlipRound: null,
        gameCounter: maxGameNumberByTable.get(row.id) ?? 0,
        clangLastStake: null,
        clangLastEatPaymentPerCard: null,
        pendingRequests: [],
        pendingStackAdjustments: new Map(),
        nextGameOverride: null,
        gameConfigOverrides: (row.gameConfigOverrides as TableGameConfigOverrides | null) ?? {},
        stacksBeforeCurrentRound: null,
      });
    }
  }

  onTableChanged(listener: TableChangeListener): void {
    this.listeners.add(listener);
  }

  private emitChanged(tableId: string): void {
    for (const listener of this.listeners) listener(tableId);
  }

  /** Public entry point for ClangService (which mutates a RuntimeTable it doesn't own the map for) to trigger a snapshot broadcast. */
  notifyChanged(tableId: string): void {
    this.emitChanged(tableId);
  }

  async createTable(dto: CreateTableRequest, ownerId: string, ownerDisplayName: string | null): Promise<TableSummary> {
    const defRow = await this.gamesService.getRow(dto.gameDefinitionId);
    if (!(await this.gamesService.canAccessGameDefinition(ownerId, defRow))) {
      throw new ForbiddenException(`You don't have access to host "${defRow.name}"`);
    }
    const gameKind = defRow.engine;
    const gameDefinition = gameKind === "poker" ? await this.gamesService.getDefinition(defRow.id) : null;

    const row = await this.prisma.table.create({
      data: {
        name: "",
        gameDefinitionId: defRow.id,
        ownerId,
        smallBlind: gameKind === "poker" ? dto.smallBlind : null,
        bigBlind: gameKind === "poker" ? dto.bigBlind : null,
        minBuyIn: dto.minBuyIn,
        maxBuyIn: dto.maxBuyIn,
      },
    });

    const config: TableConfig = {
      id: row.id,
      gameDefinitionId: defRow.id,
      smallBlind: dto.smallBlind ?? 0,
      bigBlind: dto.bigBlind ?? 0,
      minBuyIn: dto.minBuyIn,
      maxBuyIn: dto.maxBuyIn,
    };

    this.runtimeTables.set(row.id, {
      tableId: row.id,
      ownerId,
      ownerDisplayName,
      gameKind,
      gameDefinitionId: defRow.id,
      gameName: defRow.name,
      gameDefinition,
      table: createEmptyTable(config),
      hand: null,
      clangRound: null,
      cardFlipRound: null,
      gameCounter: 0,
      clangLastStake: null,
      clangLastEatPaymentPerCard: null,
      pendingRequests: [],
      pendingStackAdjustments: new Map(),
      nextGameOverride: null,
      gameConfigOverrides: {},
      stacksBeforeCurrentRound: null,
    });

    return this.toSummary(row.id);
  }

  private async toSummary(tableId: string): Promise<TableSummary> {
    const row = await this.prisma.table.findUniqueOrThrow({
      where: { id: tableId },
      include: { gameDefinition: true },
    });
    const runtime = this.getRuntimeTable(tableId);
    return {
      id: row.id,
      gameKind: row.gameDefinition.engine,
      gameDefinitionId: row.gameDefinitionId,
      gameName: row.gameDefinition.name,
      smallBlind: row.smallBlind,
      bigBlind: row.bigBlind,
      minBuyIn: row.minBuyIn,
      maxBuyIn: row.maxBuyIn,
      seatedCount: runtime.table.seats.filter((s) => s.status === "active").length,
    };
  }

  getRuntimeTable(tableId: string): RuntimeTable {
    const runtime = this.runtimeTables.get(tableId);
    if (!runtime) throw new NotFoundException(`Table ${tableId} not found (or the server restarted since it was created)`);
    return runtime;
  }

  /**
   * Runs `fn` after every previously-queued operation for this table has
   * finished, and before any later one starts — a strict single-file line per
   * table. Every mutating gateway action funnels through this (see
   * TablesGateway.guard), which is what actually enforces it: without it,
   * two concurrent requests for the same table (e.g. a player's real move
   * landing while another player's "away" toggle is mid-flight through its
   * own multi-step settlement/sync work) could interleave their reads and
   * writes of the same in-memory `RuntimeTable` and DB rows, corrupting stack
   * values with no trace in any log — exactly how a stray chip discrepancy
   * happened in production.
   */
  async withTableLock<T>(tableId: string, fn: () => Promise<T>): Promise<T> {
    const tail = this.tableLocks.get(tableId) ?? Promise.resolve();
    const result = tail.then(fn, fn);
    this.tableLocks.set(tableId, result.then(
      () => undefined,
      () => undefined
    ));
    return result;
  }

  getSnapshot(tableId: string, viewerUserId: string | null) {
    return buildTableSnapshot(this.getRuntimeTable(tableId), viewerUserId);
  }

  /**
   * True if `displayName` (case-insensitive) is already in use by another
   * seated player or pending requester at this table — names only need to
   * be unique within a table, not globally.
   */
  private isNameTakenAtTable(runtime: RuntimeTable, displayName: string, excludeUserId: string): boolean {
    const normalized = displayName.trim().toLowerCase();
    const seatTaken = runtime.table.seats.some(
      (s) => s.playerId !== null && s.playerId !== excludeUserId && s.displayName?.trim().toLowerCase() === normalized
    );
    if (seatTaken) return true;
    return runtime.pendingRequests.some(
      (r) => r.userId !== excludeUserId && r.displayName.trim().toLowerCase() === normalized
    );
  }

  /**
   * A non-owner's request queues for the owner's approval; the owner's own
   * request (and any approval) seats the player immediately. The owner has
   * final say on buy-in size, so approved amounts bypass the table's
   * min/max range — that range is just a default hint shown to requesters.
   * The display name is chosen right here (not at guest-session time) and
   * must be unique among this table's current seats/pending requests.
   */
  async requestSeat(tableId: string, seatIndex: number, userId: string, displayName: string, buyIn: number): Promise<void> {
    const runtime = this.getRuntimeTable(tableId);
    const seat = runtime.table.seats[seatIndex];
    if (!seat) throw new BadRequestException(`Invalid seat index ${seatIndex}`);
    if (seat.status !== "empty") throw new BadRequestException("Seat is already occupied");
    if (runtime.table.seats.some((s) => s.playerId === userId)) {
      throw new BadRequestException("You are already seated at this table");
    }
    if (runtime.pendingRequests.some((r) => r.userId === userId)) {
      throw new BadRequestException("You already have a pending seat request");
    }
    const trimmedName = displayName.trim();
    if (!trimmedName) throw new BadRequestException("A display name is required to sit down");
    if (this.isNameTakenAtTable(runtime, trimmedName, userId)) {
      throw new BadRequestException(`"${trimmedName}" is already taken at this table`);
    }

    if (userId === runtime.ownerId) {
      await this.seatPlayerDirect(runtime, seatIndex, userId, trimmedName, buyIn);
    } else {
      runtime.pendingRequests.push({ id: randomUUID(), seatIndex, userId, displayName: trimmedName, requestedBuyIn: buyIn });
    }
    this.emitChanged(tableId);
  }

  async approveSeatRequest(tableId: string, requestId: string, approverUserId: string, buyIn: number): Promise<void> {
    const runtime = this.getRuntimeTable(tableId);
    if (approverUserId !== runtime.ownerId) throw new ForbiddenException("Only the table owner can approve seat requests");
    const index = runtime.pendingRequests.findIndex((r) => r.id === requestId);
    if (index === -1) throw new NotFoundException("Seat request not found");
    const request = runtime.pendingRequests[index] as RuntimeTable["pendingRequests"][number];
    // Re-check in case someone else claimed this name (e.g. sat directly) in the gap since the request was made.
    if (this.isNameTakenAtTable(runtime, request.displayName, request.userId)) {
      throw new BadRequestException(`"${request.displayName}" was taken by another player before this request could be approved`);
    }
    runtime.pendingRequests.splice(index, 1);

    await this.seatPlayerDirect(runtime, request.seatIndex, request.userId, request.displayName, buyIn);
    this.emitChanged(tableId);
  }

  async rejectSeatRequest(tableId: string, requestId: string, approverUserId: string): Promise<void> {
    const runtime = this.getRuntimeTable(tableId);
    if (approverUserId !== runtime.ownerId) throw new ForbiddenException("Only the table owner can reject seat requests");
    const before = runtime.pendingRequests.length;
    runtime.pendingRequests = runtime.pendingRequests.filter((r) => r.id !== requestId);
    if (runtime.pendingRequests.length === before) throw new NotFoundException("Seat request not found");
    this.emitChanged(tableId);
  }

  async cancelSeatRequest(tableId: string, requestId: string, userId: string): Promise<void> {
    const runtime = this.getRuntimeTable(tableId);
    const before = runtime.pendingRequests.length;
    runtime.pendingRequests = runtime.pendingRequests.filter((r) => !(r.id === requestId && r.userId === userId));
    if (runtime.pendingRequests.length === before) throw new NotFoundException("Seat request not found");
    this.emitChanged(tableId);
  }

  private async seatPlayerDirect(
    runtime: RuntimeTable,
    seatIndex: number,
    userId: string,
    displayName: string,
    buyIn: number
  ): Promise<void> {
    seatPlayer(runtime.table, seatIndex, userId, displayName, buyIn, { skipBuyInRangeCheck: true });
    // The owner may not have had a name yet at table-creation time (name is
    // now collected at seat-request time); sync it once they actually sit.
    if (userId === runtime.ownerId) runtime.ownerDisplayName = displayName;

    await this.prisma.seat.upsert({
      where: { tableId_seatIndex: { tableId: runtime.tableId, seatIndex } },
      create: { tableId: runtime.tableId, seatIndex, userId, stack: buyIn, status: "active" },
      update: { userId, stack: buyIn, status: "active" },
    });
    await this.prisma.chipTransaction.create({
      data: { userId, tableId: runtime.tableId, type: "buy_in", amount: buyIn },
    });
  }

  /** Owner-only: removes a seated player. Blocked while a hand/round is actually live — the pot/turn-order math still references that seat mid-hand — but fine any time between hands. */
  async removePlayer(tableId: string, seatIndex: number, ownerUserId: string): Promise<void> {
    const runtime = this.getRuntimeTable(tableId);
    if (ownerUserId !== runtime.ownerId) throw new ForbiddenException("Only the table owner can remove players");
    if (this.isRoundInProgress(runtime)) {
      throw new BadRequestException("Cannot remove a player while a hand is in progress");
    }
    const seat = runtime.table.seats[seatIndex];
    if (!seat || !seat.playerId) throw new BadRequestException("Seat is not occupied");

    await this.clearSeat(runtime, seatIndex, seat.playerId);
    this.emitChanged(tableId);
  }

  /** True if a poker hand, Clang round, or Card Flip round is currently live (not just dealt-and-settled) at this table. */
  isRoundInProgress(runtime: RuntimeTable): boolean {
    if (runtime.gameKind === "poker") return runtime.hand !== null && runtime.hand.phase !== "complete";
    if (runtime.gameKind === "clang") return runtime.clangRound !== null && runtime.clangRound.phase !== "complete";
    return runtime.cardFlipRound !== null && runtime.cardFlipRound.phase !== "complete";
  }

  private async clearSeat(runtime: RuntimeTable, seatIndex: number, userId: string): Promise<void> {
    const remainingStack = standPlayer(runtime.table, seatIndex);
    runtime.pendingStackAdjustments.delete(seatIndex);

    await this.prisma.seat.update({
      where: { tableId_seatIndex: { tableId: runtime.tableId, seatIndex } },
      data: { userId: null, stack: 0, status: "empty" },
    });
    await this.prisma.chipTransaction.create({
      data: { userId, tableId: runtime.tableId, type: "cash_out", amount: remainingStack },
    });
  }

  /** Hands the table's owner privileges to another seated player. */
  async transferOwnership(tableId: string, seatIndex: number, currentOwnerUserId: string): Promise<void> {
    const runtime = this.getRuntimeTable(tableId);
    if (currentOwnerUserId !== runtime.ownerId) throw new ForbiddenException("Only the table owner can transfer ownership");
    const seat = runtime.table.seats[seatIndex];
    if (!seat || !seat.playerId || !seat.displayName) throw new BadRequestException("Seat is not occupied");

    runtime.ownerId = seat.playerId;
    runtime.ownerDisplayName = seat.displayName;
    await this.prisma.table.update({ where: { id: tableId }, data: { ownerId: seat.playerId } });

    this.emitChanged(tableId);
  }

  /**
   * Marks a seated player away (or back active). Sitting-out seats keep their
   * stack but are skipped when the next hand is dealt (DeclarativeEngine only
   * deals `activeSeats`) — safe to flip anytime since it never touches a hand
   * already in progress. If they're already dealt into a hand that's live
   * right now, `advanceHand` will auto-check/fold through their turns for the
   * rest of that hand (see its `shouldAutoPlay`) so they never stall it —
   * including immediately, if it's their turn the moment they go away.
   */
  async setSeatAway(tableId: string, seatIndex: number, requesterUserId: string, away: boolean): Promise<void> {
    const runtime = this.getRuntimeTable(tableId);
    const seat = runtime.table.seats[seatIndex];
    if (!seat || !seat.playerId) throw new BadRequestException("Seat is not occupied");
    // Owner can mark anyone away; a player can only toggle their own seat.
    if (requesterUserId !== runtime.ownerId && seat.playerId !== requesterUserId) {
      throw new ForbiddenException("You can only set your own seat away");
    }

    seat.status = away ? "sitting-out" : "active";
    await this.prisma.seat.update({
      where: { tableId_seatIndex: { tableId, seatIndex } },
      data: { status: away ? "sitting_out" : "active" },
    });

    if (away && runtime.gameKind === "poker") {
      await this.advanceHand(tableId, runtime);
    }
    this.emitChanged(tableId);
  }

  /**
   * Owner-only correction to a seated player's stack. Modeled as a buy-in
   * (stack goes up) or cash-out (stack goes down) of the delta amount, so the
   * ledger's net-up/down math stays accurate — a top-up isn't a "win" and a
   * clawback isn't a "loss". Mutating a stack mid-hand would corrupt the live
   * pot/contribution accounting, so while a hand/round is in progress the
   * change is queued instead and applied at the start of the next one.
   *
   * "add"/"remove" are stored as a mode+amount, not a resolved target — the
   * stack can keep moving (wins, Clang eats, Card Flip settlement) for the
   * rest of the current hand/round after this is queued, so resolving against
   * today's stack now and reapplying that stale absolute number later would
   * silently discard whatever happened in between. Resolution against the
   * live stack happens at actual apply time in `applyStackAdjustment`. "set"
   * is the one mode that's genuinely meant to be an absolute override.
   */
  async adjustStack(tableId: string, seatIndex: number, approverUserId: string, mode: "add" | "remove" | "set", amount: number): Promise<void> {
    const runtime = this.getRuntimeTable(tableId);
    if (approverUserId !== runtime.ownerId) throw new ForbiddenException("Only the table owner can adjust stacks");
    const seat = runtime.table.seats[seatIndex];
    if (!seat || seat.status !== "active" || !seat.playerId) throw new BadRequestException("Seat is not occupied");
    if (amount < 0) throw new BadRequestException("Amount cannot be negative");

    const handInProgress = this.isRoundInProgress(runtime);
    if (handInProgress) {
      runtime.pendingStackAdjustments.set(seatIndex, { userId: seat.playerId, mode, amount });
    } else {
      await this.applyStackAdjustment(runtime, seatIndex, mode, amount);
    }
    this.emitChanged(tableId);
  }

  async applyStackAdjustment(runtime: RuntimeTable, seatIndex: number, mode: "add" | "remove" | "set", amount: number): Promise<void> {
    const seat = runtime.table.seats[seatIndex];
    if (!seat || !seat.playerId) return;
    const newStack = resolvePendingStackAdjustment(seat.stack, { userId: seat.playerId, mode, amount });
    const delta = newStack - seat.stack;
    if (delta === 0) return;
    const playerId = seat.playerId;

    seat.stack = newStack;
    await this.prisma.seat.update({
      where: { tableId_seatIndex: { tableId: runtime.tableId, seatIndex } },
      data: { stack: newStack },
    });
    await this.prisma.chipTransaction.create({
      data: {
        userId: playerId,
        tableId: runtime.tableId,
        type: delta > 0 ? "buy_in" : "cash_out",
        amount: Math.abs(delta),
      },
    });
  }

  /** Which engine the owner's next "Start" click will actually run — the queued override, or the table's current game. Drives TablesGateway's routing between startHand/ClangService.startRound/CardFlipService.startRound. */
  async resolveNextGameKind(tableId: string): Promise<"poker" | "clang" | "cardflip"> {
    const runtime = this.getRuntimeTable(tableId);
    const targetId = runtime.nextGameOverride?.gameDefinitionId ?? runtime.gameDefinitionId;
    const row = await this.gamesService.getRow(targetId);
    return row.engine;
  }

  async startHand(tableId: string, requesterUserId: string): Promise<void> {
    const runtime = this.getRuntimeTable(tableId);
    if (requesterUserId !== runtime.ownerId) throw new ForbiddenException("Only the table owner can start a hand");
    if (this.isRoundInProgress(runtime)) {
      throw new BadRequestException("A hand or round is already in progress");
    }

    for (const [seatIndex, adjustment] of runtime.pendingStackAdjustments) {
      const seat = runtime.table.seats[seatIndex];
      if (seat && seat.playerId === adjustment.userId) {
        await this.applyStackAdjustment(runtime, seatIndex, adjustment.mode, adjustment.amount);
      }
    }
    runtime.pendingStackAdjustments.clear();

    // Resolve the game for this hand: one-off override falls back to current game
    // — which may itself be switching the table's engine (e.g. coming from Clang or Card Flip).
    const targetGameDefinitionId = runtime.nextGameOverride?.gameDefinitionId ?? runtime.gameDefinitionId;
    runtime.nextGameOverride = null;
    const baseGameDefinition = await this.gamesService.getDefinition(targetGameDefinitionId);
    // Owner's Settings override (blinds/ante) layered on top — never mutates the
    // (globally shared) GameDefinition row itself, see TablesService.setGameConfig.
    const pokerOverride = runtime.gameConfigOverrides.poker;
    const gameDefinition = pokerOverride
      ? { ...baseGameDefinition, forcedBets: { ...baseGameDefinition.forcedBets, ...pokerOverride } }
      : baseGameDefinition;

    if (runtime.gameKind !== "poker" || gameDefinition.id !== runtime.gameDefinitionId) {
      runtime.gameKind = "poker";
      runtime.gameDefinition = gameDefinition;
      runtime.gameDefinitionId = gameDefinition.id;
      runtime.gameName = gameDefinition.name;
      runtime.clangRound = null;
      runtime.cardFlipRound = null;
      await this.prisma.table.update({ where: { id: tableId }, data: { gameDefinitionId: gameDefinition.id } });
    }

    // Must snapshot before initHand posts antes/blinds — this is what persistHandResult
    // reads back as each seat's stackBefore.
    runtime.stacksBeforeCurrentRound = captureStacksBefore(runtime.table);

    const engine = new DeclarativeEngine(gameDefinition);
    runtime.gameCounter += 1;
    runtime.hand = engine.initHand(runtime.table, runtime.gameCounter);

    await this.advanceHand(tableId, runtime);
    this.emitChanged(tableId);
  }

  /** Queues which game plays next (any engine) — applied by startHand/ClangService.startRound whichever actually runs next. */
  async setNextGame(tableId: string, requesterUserId: string, gameDefinitionId: string): Promise<void> {
    const runtime = this.getRuntimeTable(tableId);
    if (requesterUserId !== runtime.ownerId) throw new ForbiddenException("Only the table owner can set the next game");
    const row = await this.gamesService.getRow(gameDefinitionId);
    if (!(await this.gamesService.canAccessGameDefinition(requesterUserId, row))) {
      throw new ForbiddenException(`You don't have access to host "${row.name}"`);
    }
    runtime.nextGameOverride = { gameDefinitionId: row.id, gameName: row.name };
    this.emitChanged(tableId);
  }

  /** The GameDefinition id this table would actually play with right now — the queued one-off override if set, otherwise its current game. */
  private targetGameDefinitionId(runtime: RuntimeTable): string {
    return runtime.nextGameOverride?.gameDefinitionId ?? runtime.gameDefinitionId;
  }

  /** What the settings modal fetches to pre-fill: GameDefinition defaults merged with any owner override, for whichever game this table would play next. */
  async getGameConfig(tableId: string): Promise<EffectiveGameConfig> {
    const runtime = this.getRuntimeTable(tableId);
    const targetId = this.targetGameDefinitionId(runtime);
    const row = await this.gamesService.getRow(targetId);
    const overrides = runtime.gameConfigOverrides;

    if (row.engine === "poker") {
      const def = await this.gamesService.getDefinition(targetId);
      const o = overrides.poker ?? {};
      return {
        kind: "poker",
        smallBlind: o.smallBlind ?? def.forcedBets.smallBlind,
        bigBlind: o.bigBlind ?? def.forcedBets.bigBlind,
        ante: o.ante ?? def.forcedBets.ante,
      };
    }
    if (row.engine === "clang") {
      const def = await this.gamesService.getClangDefinition(targetId);
      const o = overrides.clang ?? {};
      return {
        kind: "clang",
        stake: o.stake ?? def.stake,
        eatPaymentPerCard: o.eatPaymentPerCard ?? def.eatPaymentPerCard,
      };
    }
    const def = await this.gamesService.getCardFlipDefinition(targetId);
    const o = overrides.cardflip ?? {};
    return {
      kind: "cardflip",
      stake: o.stake ?? def.stake,
      cardsPerPlayer: o.cardsPerPlayer ?? def.cardsPerPlayer,
      fourOfAKindBonus: o.fourOfAKindBonus ?? def.fourOfAKindBonus,
      unopenedCardBonus: o.unopenedCardBonus ?? def.unopenedCardBonus,
      straightFlushBonus: o.straightFlushBonus ?? def.straightFlushBonus,
    };
  }

  /**
   * Owner-only: overrides specific values for the table's current/queued
   * game — layered on top of the GameDefinition at round-start time
   * (TablesService.startHand / ClangService.startRound / CardFlipService.startRound),
   * never mutating the GameDefinition row itself (builtin rows are shared
   * across every table playing that game). Rejected mid-round, same as
   * removePlayer — the values in play for the CURRENT hand/round must never
   * shift underneath it.
   */
  async setGameConfig(tableId: string, requesterUserId: string, payload: SetGameConfigPayload): Promise<void> {
    const runtime = this.getRuntimeTable(tableId);
    if (requesterUserId !== runtime.ownerId) throw new ForbiddenException("Only the table owner can change game settings");
    if (this.isRoundInProgress(runtime)) {
      throw new BadRequestException("Cannot change settings while a hand or round is in progress");
    }
    const targetId = this.targetGameDefinitionId(runtime);
    const row = await this.gamesService.getRow(targetId);

    const overrides: TableGameConfigOverrides = { ...runtime.gameConfigOverrides };
    if (row.engine === "poker") {
      overrides.poker = {
        smallBlind: this.validatedNonNegative("smallBlind", payload.smallBlind),
        bigBlind: this.validatedNonNegative("bigBlind", payload.bigBlind),
        ante: this.validatedNonNegative("ante", payload.ante),
      };
    } else if (row.engine === "clang") {
      overrides.clang = {
        stake: this.validatedPositive("stake", payload.stake),
        eatPaymentPerCard: this.validatedNonNegative("eatPaymentPerCard", payload.eatPaymentPerCard),
      };
    } else {
      overrides.cardflip = {
        stake: this.validatedPositive("stake", payload.stake),
        cardsPerPlayer: this.validatedPositive("cardsPerPlayer", payload.cardsPerPlayer),
        fourOfAKindBonus: this.validatedNonNegative("fourOfAKindBonus", payload.fourOfAKindBonus),
        unopenedCardBonus: this.validatedNonNegative("unopenedCardBonus", payload.unopenedCardBonus),
        straightFlushBonus: this.validatedNonNegative("straightFlushBonus", payload.straightFlushBonus),
      };
    }

    runtime.gameConfigOverrides = overrides;
    await this.prisma.table.update({
      where: { id: tableId },
      data: { gameConfigOverrides: JSON.parse(JSON.stringify(overrides)) },
    });
    this.emitChanged(tableId);
  }

  /** Undefined passes through untouched (field left at its GameDefinition default); anything provided must be a finite number >= 0. */
  private validatedNonNegative(field: string, value: number | undefined): number | undefined {
    if (value === undefined) return undefined;
    if (!Number.isFinite(value) || value < 0) throw new BadRequestException(`${field} must be a non-negative number`);
    return value;
  }

  /** Same as validatedNonNegative, but rejects 0 too — for values that must be strictly positive (stake, cardsPerPlayer). */
  private validatedPositive(field: string, value: number | undefined): number | undefined {
    if (value === undefined) return undefined;
    if (!Number.isFinite(value) || value <= 0) throw new BadRequestException(`${field} must be a positive number`);
    return value;
  }

  /**
   * Any seated player can rabbit hunt for themselves independently — the drawn
   * cards are the same for everyone (drawn once, off the first requester), but
   * `rabbitRevealedSeats` gates who actually gets to see them: `table-snapshot.ts`
   * only includes `rabbitBoard`/`rabbitBoards` in a viewer's snapshot once their
   * own seat is in that set.
   */
  async revealRabbit(tableId: string, requesterUserId: string): Promise<void> {
    const runtime = this.getRuntimeTable(tableId);
    const hand = runtime.hand;
    if (!hand || hand.phase !== "complete") throw new BadRequestException("No completed hand to rabbit hunt");
    const seat = runtime.table.seats.find((s) => s.playerId === requesterUserId);
    if (!seat) throw new ForbiddenException("Only seated players can reveal rabbit cards");
    if (hand.rabbitRevealedSeats.has(seat.seatIndex)) return; // already revealed for this player

    const alreadyComputed = hand.rabbitBoard !== null;
    if (!alreadyComputed) {
      const { rabbitBoard, rabbitBoards } = computeRabbitReveal(
        hand.gameDefinition,
        hand.streetIndex,
        hand.boards.length,
        hand.deck.peekRemaining()
      );
      if (rabbitBoard.length === 0) return; // all community cards were already dealt
      hand.rabbitBoard = rabbitBoard;
      hand.rabbitBoards = rabbitBoards;
    }
    hand.rabbitRevealedSeats.add(seat.seatIndex);

    if (!alreadyComputed) {
      // Persist once, the first time anyone reveals it — so a later replay doesn't
      // need to recompute it from `remainingDeck` (though it still could).
      await this.prisma.hand.updateMany({
        where: { tableId, handNumber: hand.handNumber },
        data: {
          rabbitBoard: JSON.parse(JSON.stringify(hand.rabbitBoard)),
          rabbitBoards: hand.rabbitBoards ? JSON.parse(JSON.stringify(hand.rabbitBoards)) : undefined,
        },
      });
    }
    this.emitChanged(tableId);
  }

  /**
   * Lets a player who wasn't forced to show at showdown (won uncontested, or
   * folded before the hand completed) voluntarily reveal their hole cards to
   * everyone. `table-snapshot.ts` reads `HandPlayerState.shown` alongside the
   * engine-computed `mustShowSeats` to decide who gets revealed once a hand
   * is complete — this just flips that flag for the requester's own seat.
   */
  async showCards(tableId: string, requesterUserId: string): Promise<void> {
    const runtime = this.getRuntimeTable(tableId);
    const hand = runtime.hand;
    if (!hand || hand.phase !== "complete") throw new BadRequestException("No completed hand to show cards for");
    const seat = runtime.table.seats.find((s) => s.playerId === requesterUserId);
    if (!seat) throw new ForbiddenException("Only seated players can show their cards");
    const player = hand.players.get(seat.seatIndex);
    if (!player) throw new BadRequestException("You were not dealt into this hand");
    if (player.shown) return; // already shown
    player.shown = true;

    // Patch the already-persisted row's `players` array so replay's read-time
    // redaction treats this seat as revealed too, not just the live viewer.
    const row = await this.prisma.hand.findUnique({ where: { tableId_handNumber: { tableId, handNumber: hand.handNumber } } });
    if (row) {
      const players = (row.players as Array<{ seatIndex: number; shown: boolean }>).map((p) =>
        p.seatIndex === seat.seatIndex ? { ...p, shown: true } : p
      );
      await this.prisma.hand.update({ where: { id: row.id }, data: { players } });
    }

    this.emitChanged(tableId);
  }

  async applyAction(tableId: string, seatIndex: number, userId: string, action: PlayerAction): Promise<void> {
    const runtime = this.getRuntimeTable(tableId);
    if (!runtime.hand || !runtime.gameDefinition) throw new BadRequestException("No hand in progress");
    const seat = runtime.table.seats[seatIndex];
    if (!seat || seat.playerId !== userId) throw new ForbiddenException("You are not seated there");
    if (runtime.hand.bettingRound?.turnSeatIndex !== seatIndex) throw new ForbiddenException("It is not your turn");

    const engine = new DeclarativeEngine(runtime.gameDefinition);
    engine.applyAction(runtime.table, runtime.hand, seatIndex, action);

    await this.advanceHand(tableId, runtime);
    this.emitChanged(tableId);
  }

  /**
   * Auto-checks/folds through any seats currently marked away — an away
   * player already dealt into this hand shouldn't be able to stall everyone
   * else waiting on their turn — and settles the showdown once the hand
   * reaches it. Called after every real action and at hand start, so an
   * away player never stalls the table.
   */
  private async advanceHand(tableId: string, runtime: RuntimeTable): Promise<void> {
    const hand = runtime.hand;
    if (!hand || !runtime.gameDefinition) return;
    const engine = new DeclarativeEngine(runtime.gameDefinition);

    const shouldAutoPlay = (seatIndex: number) => runtime.table.seats[seatIndex]?.status === "sitting-out";

    while (
      hand.phase === "betting" &&
      hand.bettingRound &&
      hand.bettingRound.turnSeatIndex !== null &&
      shouldAutoPlay(hand.bettingRound.turnSeatIndex)
    ) {
      const seatIndex = hand.bettingRound.turnSeatIndex;
      const legal = getLegalActions(runtime.table, hand, seatIndex);
      engine.applyAction(runtime.table, hand, seatIndex, legal.canCheck ? { type: "check" } : { type: "fold" });
    }

    if (hand.phase === "showdown") {
      const result = engine.evaluateShowdown(runtime.table, hand);
      await this.persistHandResult(tableId, runtime, result.pots);
    }
  }

  private async persistHandResult(tableId: string, runtime: RuntimeTable, pots: PotResult[]): Promise<void> {
    const hand = runtime.hand;
    if (!hand || !runtime.gameDefinition) return;

    const stacksBefore = new Map((runtime.stacksBeforeCurrentRound ?? []).map((s) => [s.seatIndex, s.stack]));
    runtime.stacksBeforeCurrentRound = null;

    const players = [...hand.players.entries()].map(([seatIndex, handPlayer]) => {
      const seat = runtime.table.seats[seatIndex];
      return {
        seatIndex,
        userId: seat?.playerId ?? null,
        displayName: seat?.displayName ?? null,
        totalContributed: handPlayer.totalContributed,
        stackBefore: stacksBefore.get(seatIndex) ?? null,
        stackAfter: seat?.stack ?? null,
        // Persisted for every seat unconditionally — visibility is enforced when a hand is
        // served for replay (only the owning viewer, or a seat that was actually revealed,
        // ever gets this back), never at write time. `foldedHoleCards` covers the one case
        // (ESG's reshuffle-on-fold) where `holeCards` itself gets cleared mid-hand.
        holeCards: handPlayer.foldedHoleCards ?? handPlayer.holeCards,
        // Always false here — a voluntary reveal only ever happens after the hand is
        // already complete and persisted; showCards() patches this field in afterward.
        shown: false,
      };
    });

    await this.prisma.hand.create({
      data: {
        tableId,
        gameDefinitionId: runtime.gameDefinition.id,
        handNumber: hand.handNumber,
        board: JSON.parse(JSON.stringify(hand.board)),
        boards: hand.boards.length > 1 ? JSON.parse(JSON.stringify(hand.boards)) : undefined,
        results: JSON.parse(JSON.stringify(pots)),
        players: JSON.parse(JSON.stringify(players)),
        actions: JSON.parse(JSON.stringify(hand.actions)),
        remainingDeck: JSON.parse(JSON.stringify(hand.deck.peekRemaining())),
      },
    });

    for (const pot of pots ?? []) {
      for (const winner of [...pot.hiWinners, ...pot.loWinners]) {
        const seat = runtime.table.seats[winner.seatIndex];
        if (!seat?.playerId) continue;
        await this.prisma.chipTransaction.create({
          data: { userId: seat.playerId, tableId, type: "win", amount: winner.amount },
        });
      }
    }

    for (const seat of runtime.table.seats) {
      if (seat.status === "active") {
        await this.prisma.seat.update({
          where: { tableId_seatIndex: { tableId, seatIndex: seat.seatIndex } },
          data: { stack: seat.stack },
        });
      }
    }
  }

  async getLedger(tableId: string, viewerUserId: string): Promise<TableLedgerResponse> {
    const runtime = this.getRuntimeTable(tableId);

    const [hands, clangRounds, cardFlipRounds, transactions] = await Promise.all([
      this.prisma.hand.findMany({ where: { tableId }, orderBy: { handNumber: "asc" }, include: { gameDefinition: true } }),
      this.prisma.clangRound.findMany({ where: { tableId }, orderBy: { roundNumber: "asc" } }),
      this.prisma.cardFlipRound.findMany({ where: { tableId }, orderBy: { roundNumber: "asc" } }),
      this.prisma.chipTransaction.findMany({ where: { tableId }, include: { user: true }, orderBy: { createdAt: "asc" } }),
    ]);

    const byUser = new Map<string, { displayName: string | null; totalBuyIn: number; totalCashOut: number }>();
    for (const tx of transactions) {
      const entry = byUser.get(tx.userId) ?? { displayName: tx.user.displayName, totalBuyIn: 0, totalCashOut: 0 };
      if (tx.type === "buy_in") entry.totalBuyIn += tx.amount;
      if (tx.type === "cash_out") entry.totalCashOut += tx.amount;
      byUser.set(tx.userId, entry);
    }

    const players: PlayerLedgerEntry[] = [...byUser.entries()].map(([userId, entry]) => {
      const seat = runtime.table.seats.find((s) => s.playerId === userId);
      const currentStack = seat?.stack ?? 0;
      return {
        userId,
        displayName: entry.displayName,
        totalBuyIn: entry.totalBuyIn,
        totalCashOut: entry.totalCashOut,
        currentStack,
        net: entry.totalCashOut + currentStack - entry.totalBuyIn,
        isSeated: seat !== undefined,
      };
    });

    return {
      hands: hands.map((h) => {
        const results = h.results as unknown as HandLogEntry["results"];
        const mustShow = mustShowSeatsFromResults(results);
        const players = (h.players as unknown as HandLogPlayer[]).map((p) => ({
          ...p,
          holeCards: p.userId === viewerUserId || mustShow.has(p.seatIndex) || p.shown ? p.holeCards : null,
        }));
        return {
          handNumber: h.handNumber,
          gameName: h.gameDefinition.name,
          board: h.board as unknown as HandLogEntry["board"],
          boards: (h.boards as unknown as HandLogEntry["boards"]) ?? null,
          results,
          players,
          actions: h.actions as unknown as HandLogEntry["actions"],
          playedAt: h.playedAt.toISOString(),
        };
      }),
      clangRounds: clangRounds.map((r) => ({
        roundNumber: r.roundNumber,
        stake: r.stake,
        eatPaymentPerCard: r.eatPaymentPerCard,
        outcome: r.outcome as unknown as ClangRoundLogEntry["outcome"],
        bonusHits: r.bonusHits as unknown as ClangRoundLogEntry["bonusHits"],
        players: r.players as unknown as ClangRoundLogEntry["players"],
        actions: r.actions as unknown as ClangRoundLogEntry["actions"],
        playedAt: r.playedAt.toISOString(),
      })),
      cardFlipRounds: cardFlipRounds.map((r) => ({
        roundNumber: r.roundNumber,
        stake: r.stake,
        cardsPerPlayer: r.cardsPerPlayer,
        outcome: r.outcome as unknown as CardFlipRoundLogEntry["outcome"],
        players: r.players as unknown as CardFlipRoundLogEntry["players"],
        actions: r.actions as unknown as CardFlipRoundLogEntry["actions"],
        playedAt: r.playedAt.toISOString(),
      })),
      players,
    };
  }

  async getHandReplay(tableId: string, handNumber: number, viewerUserId: string | null): Promise<HandReplayResponse> {
    const row = await this.prisma.hand.findUnique({
      where: { tableId_handNumber: { tableId, handNumber } },
      include: { gameDefinition: true },
    });
    if (!row) throw new NotFoundException(`Hand ${handNumber} not found for table ${tableId}`);
    const [previous, next] = await Promise.all([
      this.prisma.hand.findFirst({ where: { tableId, handNumber: { lt: handNumber } }, orderBy: { handNumber: "desc" }, select: { handNumber: true } }),
      this.prisma.hand.findFirst({ where: { tableId, handNumber: { gt: handNumber } }, orderBy: { handNumber: "asc" }, select: { handNumber: true } }),
    ]);
    const gameDefinition = await this.gamesService.getDefinition(row.gameDefinitionId);
    const players = row.players as unknown as HandLogPlayer[];
    const steps = buildPokerReplay(
      {
        handNumber: row.handNumber,
        gameName: row.gameDefinition.name,
        board: row.board as unknown as Card[],
        boards: (row.boards as unknown as Card[][] | null) ?? null,
        results: row.results as unknown as PotResult[],
        players,
        actions: row.actions as unknown as HandActionLogEntry[],
        remainingDeck: row.remainingDeck as unknown as Card[],
        rabbitBoard: (row.rabbitBoard as unknown as Card[] | null) ?? null,
        rabbitBoards: (row.rabbitBoards as unknown as Card[][] | null) ?? null,
      },
      gameDefinition,
      viewerUserId
    );
    return {
      handNumber: row.handNumber,
      gameName: row.gameDefinition.name,
      players: players.map((p) => ({ seatIndex: p.seatIndex, userId: p.userId, displayName: p.displayName, stackBefore: p.stackBefore, stackAfter: p.stackAfter })),
      steps,
      previousHandNumber: previous?.handNumber ?? null,
      nextHandNumber: next?.handNumber ?? null,
    };
  }

  async getClangRoundReplay(tableId: string, roundNumber: number): Promise<ClangRoundReplayResponse> {
    const row = await this.prisma.clangRound.findUnique({ where: { tableId_roundNumber: { tableId, roundNumber } } });
    if (!row) throw new NotFoundException(`Clang round ${roundNumber} not found for table ${tableId}`);
    const [previous, next] = await Promise.all([
      this.prisma.clangRound.findFirst({
        where: { tableId, roundNumber: { lt: roundNumber } },
        orderBy: { roundNumber: "desc" },
        select: { roundNumber: true },
      }),
      this.prisma.clangRound.findFirst({
        where: { tableId, roundNumber: { gt: roundNumber } },
        orderBy: { roundNumber: "asc" },
        select: { roundNumber: true },
      }),
    ]);
    const players = row.players as unknown as ClangRoundReplayRow["players"];
    const steps = buildClangReplay({
      roundNumber: row.roundNumber,
      stake: row.stake,
      eatPaymentPerCard: row.eatPaymentPerCard,
      outcome: row.outcome as unknown as ClangRoundReplayRow["outcome"],
      bonusHits: row.bonusHits as unknown as ClangRoundReplayRow["bonusHits"],
      players,
      actions: row.actions as unknown as ClangRoundReplayRow["actions"],
    });
    return {
      roundNumber: row.roundNumber,
      players: players.map((p) => ({ seatIndex: p.seatIndex, userId: p.userId, displayName: p.displayName, stackBefore: p.stackBefore, stackAfter: p.stackAfter })),
      steps,
      previousRoundNumber: previous?.roundNumber ?? null,
      nextRoundNumber: next?.roundNumber ?? null,
    };
  }

  async getCardFlipRoundReplay(tableId: string, roundNumber: number): Promise<CardFlipRoundReplayResponse> {
    const row = await this.prisma.cardFlipRound.findUnique({ where: { tableId_roundNumber: { tableId, roundNumber } } });
    if (!row) throw new NotFoundException(`Card Flip round ${roundNumber} not found for table ${tableId}`);
    const [previous, next] = await Promise.all([
      this.prisma.cardFlipRound.findFirst({
        where: { tableId, roundNumber: { lt: roundNumber } },
        orderBy: { roundNumber: "desc" },
        select: { roundNumber: true },
      }),
      this.prisma.cardFlipRound.findFirst({
        where: { tableId, roundNumber: { gt: roundNumber } },
        orderBy: { roundNumber: "asc" },
        select: { roundNumber: true },
      }),
    ]);
    const players = row.players as unknown as CardFlipRoundReplayRow["players"];
    const steps = buildCardFlipReplay({
      roundNumber: row.roundNumber,
      stake: row.stake,
      cardsPerPlayer: row.cardsPerPlayer,
      outcome: row.outcome as unknown as CardFlipRoundReplayRow["outcome"],
      players,
      actions: row.actions as unknown as CardFlipRoundReplayRow["actions"],
    });
    return {
      roundNumber: row.roundNumber,
      players: players.map((p) => ({ seatIndex: p.seatIndex, userId: p.userId, displayName: p.displayName, stackBefore: p.stackBefore, stackAfter: p.stackAfter })),
      steps,
      previousRoundNumber: previous?.roundNumber ?? null,
      nextRoundNumber: next?.roundNumber ?? null,
    };
  }

  /** The street a completed hand's action log actually reached — not persisted directly, so derived from the last street name any action names. */
  private deriveFinalStreetIndex(actions: HandActionLogEntry[], gameDefinition: GameDefinition): number {
    let maxIndex = 0;
    for (const action of actions) {
      const streetName = "streetName" in action ? action.streetName : null;
      if (!streetName) continue;
      const index = gameDefinition.streets.findIndex((s) => s.name === streetName);
      if (index > maxIndex) maxIndex = index;
    }
    return maxIndex;
  }

  /** Computes (and persists, the first time) a rabbit hunt for a hand nobody ever revealed it for live — works even though the live runtime hand is long gone, using the persisted `remainingDeck`. */
  async replayRevealRabbit(tableId: string, handNumber: number): Promise<RabbitReveal> {
    const row = await this.prisma.hand.findUnique({ where: { tableId_handNumber: { tableId, handNumber } } });
    if (!row) throw new NotFoundException(`Hand ${handNumber} not found for table ${tableId}`);
    if (row.rabbitBoard) {
      return {
        rabbitBoard: row.rabbitBoard as unknown as Card[],
        rabbitBoards: (row.rabbitBoards as unknown as Card[][] | null) ?? null,
      };
    }

    const gameDefinition = await this.gamesService.getDefinition(row.gameDefinitionId);
    const finalStreetIndex = this.deriveFinalStreetIndex(row.actions as unknown as HandActionLogEntry[], gameDefinition);
    const boardsCount = (row.boards as unknown as Card[][] | null)?.length ?? 1;
    const reveal = computeRabbitReveal(gameDefinition, finalStreetIndex, boardsCount, row.remainingDeck as unknown as Card[]);

    if (reveal.rabbitBoard.length > 0) {
      await this.prisma.hand.update({
        where: { id: row.id },
        data: {
          rabbitBoard: JSON.parse(JSON.stringify(reveal.rabbitBoard)),
          rabbitBoards: reveal.rabbitBoards ? JSON.parse(JSON.stringify(reveal.rabbitBoards)) : undefined,
        },
      });
    }
    return reveal;
  }

  private readonly CHAT_HISTORY_LIMIT = 50;
  private readonly CHAT_MESSAGE_MAX_LENGTH = 500;

  /** Seated players use their seat's name; a not-yet-approved requester uses whatever name they requested with — covers everyone actually able to reach the table. */
  private resolveChatDisplayName(runtime: RuntimeTable, userId: string): string {
    const seat = runtime.table.seats.find((s) => s.playerId === userId);
    if (seat?.displayName) return seat.displayName;
    const pending = runtime.pendingRequests.find((r) => r.userId === userId);
    if (pending) return pending.displayName;
    return "Guest";
  }

  async sendChatMessage(tableId: string, userId: string, body: string): Promise<ChatMessageView> {
    const runtime = this.getRuntimeTable(tableId); // also validates the table exists
    const trimmed = body.trim().slice(0, this.CHAT_MESSAGE_MAX_LENGTH);
    if (!trimmed) throw new BadRequestException("Message cannot be empty");

    const row = await this.prisma.chatMessage.create({
      data: { tableId, userId, displayName: this.resolveChatDisplayName(runtime, userId), body: trimmed },
    });
    return { id: row.id, userId: row.userId, displayName: row.displayName, body: row.body, createdAt: row.createdAt.toISOString() };
  }

  /** Most-recent-last, capped at CHAT_HISTORY_LIMIT — sent once on table:join so a panel opened mid-game still has scrollback. */
  async getRecentChatMessages(tableId: string): Promise<ChatMessageView[]> {
    const rows = await this.prisma.chatMessage.findMany({
      where: { tableId },
      orderBy: { createdAt: "desc" },
      take: this.CHAT_HISTORY_LIMIT,
    });
    return rows
      .reverse()
      .map((row) => ({ id: row.id, userId: row.userId, displayName: row.displayName, body: row.body, createdAt: row.createdAt.toISOString() }));
  }
}
