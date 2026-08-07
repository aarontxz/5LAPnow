import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  createEmptyTable,
  DeclarativeEngine,
  getLegalActions,
  PlayerAction,
  PotResult,
  seatPlayer,
  standPlayer,
  TableConfig,
} from "@5lapnow/game-engine";
import type { Card } from "@5lapnow/cards";
import type { CreateTableRequest, HandLogEntry, PlayerLedgerEntry, TableLedgerResponse, TableSummary } from "@5lapnow/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { GamesService } from "../games/games.service";
import { RuntimeTable, buildTableSnapshot, NextGameOverride } from "./table-snapshot";

type TableChangeListener = (tableId: string) => void;

@Injectable()
export class TablesService implements OnModuleInit {
  private readonly runtimeTables = new Map<string, RuntimeTable>();
  private readonly listeners = new Set<TableChangeListener>();

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
    const [rows, handCounts] = await Promise.all([
      this.prisma.table.findMany({ include: { seats: { include: { user: true } }, owner: true } }),
      this.prisma.hand.groupBy({ by: ["tableId"], _max: { handNumber: true } }),
    ]);
    const maxHandNumberByTable = new Map(handCounts.map((h) => [h.tableId, h._max.handNumber ?? 0]));

    for (const row of rows) {
      let gameDefinition;
      try {
        gameDefinition = await this.gamesService.getDefinition(row.gameDefinitionId);
      } catch {
        continue; // game definition is gone (or invalid) — can't run this table, skip it
      }

      const config: TableConfig = {
        id: row.id,
        gameDefinitionId: row.gameDefinitionId,
        smallBlind: row.smallBlind,
        bigBlind: row.bigBlind,
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
        gameDefinition,
        table,
        hand: null,
        handCounter: maxHandNumberByTable.get(row.id) ?? 0,
        pendingRequests: [],
        pendingStackAdjustments: new Map(),
        standRequests: new Set(),
        nextGameOverride: null,
      });
    }
  }

  onTableChanged(listener: TableChangeListener): void {
    this.listeners.add(listener);
  }

  private emitChanged(tableId: string): void {
    for (const listener of this.listeners) listener(tableId);
  }

  async createTable(dto: CreateTableRequest, ownerId: string, ownerDisplayName: string | null): Promise<TableSummary> {
    const gameDefinition = await this.gamesService.getDefinition(dto.gameDefinitionId);

    const row = await this.prisma.table.create({
      data: {
        gameDefinitionId: gameDefinition.id,
        ownerId,
        smallBlind: dto.smallBlind,
        bigBlind: dto.bigBlind,
        minBuyIn: dto.minBuyIn,
        maxBuyIn: dto.maxBuyIn,
      },
    });

    const config: TableConfig = {
      id: row.id,
      gameDefinitionId: gameDefinition.id,
      smallBlind: dto.smallBlind,
      bigBlind: dto.bigBlind,
      minBuyIn: dto.minBuyIn,
      maxBuyIn: dto.maxBuyIn,
    };

    this.runtimeTables.set(row.id, {
      tableId: row.id,
      ownerId,
      ownerDisplayName,
      gameDefinition,
      table: createEmptyTable(config),
      hand: null,
      handCounter: 0,
      pendingRequests: [],
      pendingStackAdjustments: new Map(),
      standRequests: new Set(),
      nextGameOverride: null,
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

  /**
   * Standing up mid-hand can't remove the seat immediately — the live hand's
   * betting round and pot math still reference it. Instead the seat is
   * flagged to auto-check (or auto-fold, if facing a bet) on its turns for
   * the rest of THIS hand; `advanceHand` evicts it once the hand completes.
   */
  async stand(tableId: string, seatIndex: number, userId: string): Promise<void> {
    const runtime = this.getRuntimeTable(tableId);
    const seat = runtime.table.seats[seatIndex];
    if (!seat || seat.playerId !== userId) throw new ForbiddenException("You are not seated there");

    const handInProgress = runtime.hand !== null && runtime.hand.phase !== "complete";
    if (!handInProgress) {
      await this.clearSeat(runtime, seatIndex, userId);
      this.emitChanged(tableId);
      return;
    }

    runtime.standRequests.add(seatIndex);
    await this.advanceHand(tableId, runtime);
    this.emitChanged(tableId);
  }

  /** Owner-only forced removal — same accounting as a self-service stand. */
  async removePlayer(tableId: string, seatIndex: number, ownerUserId: string): Promise<void> {
    const runtime = this.getRuntimeTable(tableId);
    if (ownerUserId !== runtime.ownerId) throw new ForbiddenException("Only the table owner can remove players");
    if (runtime.hand && runtime.hand.phase !== "complete") {
      throw new BadRequestException("Cannot remove a player while a hand is in progress");
    }
    const seat = runtime.table.seats[seatIndex];
    if (!seat || !seat.playerId) throw new BadRequestException("Seat is not occupied");

    await this.clearSeat(runtime, seatIndex, seat.playerId);
    this.emitChanged(tableId);
  }

  private async clearSeat(runtime: RuntimeTable, seatIndex: number, userId: string): Promise<void> {
    const remainingStack = standPlayer(runtime.table, seatIndex);
    runtime.pendingStackAdjustments.delete(seatIndex);
    runtime.standRequests.delete(seatIndex);

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
   * already in progress.
   */
  async setSeatAway(tableId: string, seatIndex: number, ownerUserId: string, away: boolean): Promise<void> {
    const runtime = this.getRuntimeTable(tableId);
    if (ownerUserId !== runtime.ownerId) throw new ForbiddenException("Only the table owner can do this");
    const seat = runtime.table.seats[seatIndex];
    if (!seat || !seat.playerId) throw new BadRequestException("Seat is not occupied");

    seat.status = away ? "sitting-out" : "active";
    await this.prisma.seat.update({
      where: { tableId_seatIndex: { tableId, seatIndex } },
      data: { status: away ? "sitting_out" : "active" },
    });

    this.emitChanged(tableId);
  }

  /**
   * Owner-only correction to a seated player's stack. Modeled as a buy-in
   * (stack goes up) or cash-out (stack goes down) of the delta amount, so the
   * ledger's net-up/down math stays accurate — a top-up isn't a "win" and a
   * clawback isn't a "loss". Mutating a stack mid-hand would corrupt the live
   * pot/contribution accounting, so while a hand is in progress the change is
   * queued instead and applied at the start of the next hand.
   */
  async adjustStack(tableId: string, seatIndex: number, approverUserId: string, newStack: number): Promise<void> {
    const runtime = this.getRuntimeTable(tableId);
    if (approverUserId !== runtime.ownerId) throw new ForbiddenException("Only the table owner can adjust stacks");
    const seat = runtime.table.seats[seatIndex];
    if (!seat || seat.status !== "active" || !seat.playerId) throw new BadRequestException("Seat is not occupied");
    if (newStack < 0) throw new BadRequestException("Stack cannot be negative");

    const handInProgress = runtime.hand !== null && runtime.hand.phase !== "complete";
    if (handInProgress) {
      runtime.pendingStackAdjustments.set(seatIndex, { userId: seat.playerId, newStack });
    } else {
      await this.applyStackAdjustment(runtime, seatIndex, newStack);
    }
    this.emitChanged(tableId);
  }

  private async applyStackAdjustment(runtime: RuntimeTable, seatIndex: number, newStack: number): Promise<void> {
    const seat = runtime.table.seats[seatIndex];
    if (!seat || !seat.playerId) return;
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

  async startHand(tableId: string, requesterUserId: string): Promise<void> {
    const runtime = this.getRuntimeTable(tableId);
    if (requesterUserId !== runtime.ownerId) throw new ForbiddenException("Only the table owner can start a hand");
    if (runtime.hand && runtime.hand.phase !== "complete") {
      throw new BadRequestException("A hand is already in progress");
    }

    for (const [seatIndex, adjustment] of runtime.pendingStackAdjustments) {
      const seat = runtime.table.seats[seatIndex];
      if (seat && seat.playerId === adjustment.userId) {
        await this.applyStackAdjustment(runtime, seatIndex, adjustment.newStack);
      }
    }
    runtime.pendingStackAdjustments.clear();

    // Resolve the game for this hand: one-off override falls back to current game.
    let gameDefinition = runtime.gameDefinition;
    if (runtime.nextGameOverride) {
      gameDefinition = await this.gamesService.getDefinition(runtime.nextGameOverride.gameDefinitionId);
      runtime.nextGameOverride = null;
    }
    if (gameDefinition.id !== runtime.gameDefinition.id) {
      runtime.gameDefinition = gameDefinition;
      await this.prisma.table.update({ where: { id: tableId }, data: { gameDefinitionId: gameDefinition.id } });
    }

    const engine = new DeclarativeEngine(gameDefinition);
    runtime.handCounter += 1;
    runtime.hand = engine.initHand(runtime.table, runtime.handCounter);

    await this.advanceHand(tableId, runtime);
    this.emitChanged(tableId);
  }

  async setNextGame(tableId: string, requesterUserId: string, gameDefinitionId: string): Promise<void> {
    const runtime = this.getRuntimeTable(tableId);
    if (requesterUserId !== runtime.ownerId) throw new ForbiddenException("Only the table owner can set the next game");
    const def = await this.gamesService.getDefinition(gameDefinitionId);
    runtime.nextGameOverride = { gameDefinitionId: def.id, gameName: def.name };
    this.emitChanged(tableId);
  }

  async revealRabbit(tableId: string, requesterUserId: string): Promise<void> {
    const runtime = this.getRuntimeTable(tableId);
    const hand = runtime.hand;
    if (!hand || hand.phase !== "complete") throw new BadRequestException("No completed hand to rabbit hunt");
    if (hand.rabbitBoard !== null) return; // already revealed
    if (!runtime.table.seats.some((s) => s.playerId === requesterUserId)) {
      throw new ForbiddenException("Only seated players can reveal rabbit cards");
    }

    const remainingStreets = hand.gameDefinition.streets
      .slice(hand.streetIndex + 1)
      .filter((s) => s.dealCommunityCards > 0);
    if (remainingStreets.length === 0) return; // all community cards were already dealt

    const numBoards = hand.boards.length;
    if (numBoards > 1) {
      const rabbitBoards: Card[][] = hand.boards.map(() => []);
      for (const street of remainingStreets) {
        hand.deck.burn();
        for (const board of rabbitBoards) board.push(...hand.deck.draw(street.dealCommunityCards));
      }
      hand.rabbitBoards = rabbitBoards;
      hand.rabbitBoard = rabbitBoards.flat();
    } else {
      const rabbitBoard: Card[] = [];
      for (const street of remainingStreets) {
        hand.deck.burn();
        rabbitBoard.push(...hand.deck.draw(street.dealCommunityCards));
      }
      hand.rabbitBoard = rabbitBoard;
      hand.rabbitBoards = null;
    }
    this.emitChanged(tableId);
  }

  async applyAction(tableId: string, seatIndex: number, userId: string, action: PlayerAction): Promise<void> {
    const runtime = this.getRuntimeTable(tableId);
    if (!runtime.hand) throw new BadRequestException("No hand in progress");
    const seat = runtime.table.seats[seatIndex];
    if (!seat || seat.playerId !== userId) throw new ForbiddenException("You are not seated there");
    if (runtime.hand.bettingRound?.turnSeatIndex !== seatIndex) throw new ForbiddenException("It is not your turn");

    const engine = new DeclarativeEngine(runtime.gameDefinition);
    engine.applyAction(runtime.table, runtime.hand, seatIndex, action);

    await this.advanceHand(tableId, runtime);
    this.emitChanged(tableId);
  }

  /**
   * Auto-checks/folds through any seats that asked to stand up mid-hand,
   * settles the showdown once the hand reaches it, and — once the hand is
   * fully complete — actually evicts every seat still waiting to leave.
   * Called after every real action and at hand start, so a deferred stand
   * request never stalls the table waiting for a player who already left.
   */
  private async advanceHand(tableId: string, runtime: RuntimeTable): Promise<void> {
    const hand = runtime.hand;
    if (!hand) return;
    const engine = new DeclarativeEngine(runtime.gameDefinition);

    while (
      hand.phase === "betting" &&
      hand.bettingRound &&
      hand.bettingRound.turnSeatIndex !== null &&
      runtime.standRequests.has(hand.bettingRound.turnSeatIndex)
    ) {
      const seatIndex = hand.bettingRound.turnSeatIndex;
      const legal = getLegalActions(runtime.table, hand, seatIndex);
      engine.applyAction(runtime.table, hand, seatIndex, legal.canCheck ? { type: "check" } : { type: "fold" });
    }

    if (hand.phase === "showdown") {
      const result = engine.evaluateShowdown(runtime.table, hand);
      await this.persistHandResult(tableId, runtime, result.pots);
    }

    if (hand.phase === "complete") {
      await this.settleStandRequests(runtime);
    }
  }

  private async settleStandRequests(runtime: RuntimeTable): Promise<void> {
    for (const seatIndex of [...runtime.standRequests]) {
      const seat = runtime.table.seats[seatIndex];
      if (seat?.playerId) {
        await this.clearSeat(runtime, seatIndex, seat.playerId);
      } else {
        runtime.standRequests.delete(seatIndex);
      }
    }
  }

  private async persistHandResult(tableId: string, runtime: RuntimeTable, pots: PotResult[]): Promise<void> {
    const hand = runtime.hand;
    if (!hand) return;

    const players = [...hand.players.entries()].map(([seatIndex, handPlayer]) => {
      const seat = runtime.table.seats[seatIndex];
      return {
        seatIndex,
        userId: seat?.playerId ?? null,
        displayName: seat?.displayName ?? null,
        totalContributed: handPlayer.totalContributed,
      };
    });

    await this.prisma.hand.create({
      data: {
        tableId,
        gameDefinitionId: runtime.gameDefinition.id,
        handNumber: hand.handNumber,
        board: JSON.parse(JSON.stringify(hand.board)),
        results: JSON.parse(JSON.stringify(pots)),
        players: JSON.parse(JSON.stringify(players)),
        actions: JSON.parse(JSON.stringify(hand.actions)),
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

  async getLedger(tableId: string): Promise<TableLedgerResponse> {
    const runtime = this.getRuntimeTable(tableId);

    const [hands, transactions] = await Promise.all([
      this.prisma.hand.findMany({ where: { tableId }, orderBy: { handNumber: "asc" } }),
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
      hands: hands.map((h) => ({
        handNumber: h.handNumber,
        board: h.board as unknown as HandLogEntry["board"],
        results: h.results as unknown as HandLogEntry["results"],
        players: h.players as unknown as HandLogEntry["players"],
        actions: h.actions as unknown as HandLogEntry["actions"],
        playedAt: h.playedAt.toISOString(),
      })),
      players,
    };
  }
}
