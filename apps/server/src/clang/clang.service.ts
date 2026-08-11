import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { ClangEngine, ClangRoundState, DEFAULT_BONUS_PAYOUTS, cardPointValue } from "@5lapnow/clang-engine";
import type { Card } from "@5lapnow/cards";
import { TableState } from "@5lapnow/game-engine";
import { PrismaService } from "../prisma/prisma.service";
import { TablesService } from "../tables/tables.service";
import { GamesService } from "../games/games.service";
import { RuntimeTable } from "../tables/table-snapshot";

/**
 * Owns the Clang round/turn state machine (via ClangEngine) while reusing
 * TablesService's seat/stack/ledger machinery and its RuntimeTable map — it
 * doesn't keep any state of its own beyond what it reads/mutates on the
 * shared RuntimeTable through TablesService.getRuntimeTable/notifyChanged.
 */
@Injectable()
export class ClangService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tablesService: TablesService,
    private readonly gamesService: GamesService
  ) {}

  private requireClangTable(tableId: string): RuntimeTable {
    const runtime = this.tablesService.getRuntimeTable(tableId);
    if (runtime.gameKind !== "clang") throw new BadRequestException("This is not a Clang table");
    return runtime;
  }

  async startRound(tableId: string, requesterUserId: string): Promise<void> {
    const runtime = this.tablesService.getRuntimeTable(tableId);
    if (requesterUserId !== runtime.ownerId) throw new ForbiddenException("Only the table owner can start a round");
    if (this.tablesService.isRoundInProgress(runtime)) {
      throw new BadRequestException("A hand or round is already in progress");
    }

    // Flush any stack corrections queued while the previous round was live, exactly like poker's startHand does.
    for (const [seatIndex, adjustment] of runtime.pendingStackAdjustments) {
      const seat = runtime.table.seats[seatIndex];
      if (seat && seat.playerId === adjustment.userId) {
        await this.tablesService.applyStackAdjustment(runtime, seatIndex, adjustment.mode, adjustment.amount);
      }
    }
    runtime.pendingStackAdjustments.clear();

    // Resolve the game for this round: one-off override falls back to current
    // game — which may itself be switching the table's engine (e.g. from poker).
    const targetGameDefinitionId = runtime.nextGameOverride?.gameDefinitionId ?? runtime.gameDefinitionId;
    runtime.nextGameOverride = null;
    const targetRow = await this.gamesService.getRow(targetGameDefinitionId);
    if (targetRow.engine !== "clang") throw new BadRequestException("Next game is not Clang");
    const baseConfig = await this.gamesService.getClangDefinition(targetRow.id);
    // Owner's Settings override layered on top — never mutates the (globally
    // shared) GameDefinition row itself, see TablesService.setGameConfig.
    const config = { ...baseConfig, ...runtime.gameConfigOverrides.clang };

    if (runtime.gameKind !== "clang" || targetRow.id !== runtime.gameDefinitionId) {
      runtime.gameKind = "clang";
      runtime.gameDefinition = null;
      runtime.gameDefinitionId = targetRow.id;
      runtime.gameName = targetRow.name;
      runtime.hand = null;
      await this.prisma.table.update({ where: { id: tableId }, data: { gameDefinitionId: targetRow.id } });
    }

    const engine = new ClangEngine();
    runtime.gameCounter += 1;
    runtime.clangRound = engine.startRound(
      runtime.table,
      runtime.gameCounter,
      config.stake,
      config.eatPaymentPerCard,
      DEFAULT_BONUS_PAYOUTS
    );
    runtime.clangLastStake = config.stake;
    runtime.clangLastEatPaymentPerCard = config.eatPaymentPerCard;

    await this.finish(tableId, runtime);
  }

  async callInstantClang(tableId: string, seatIndex: number): Promise<void> {
    const runtime = this.requireClangTable(tableId);
    const round = this.requireRound(runtime);
    new ClangEngine().callInstantClang(runtime.table, round, seatIndex);
    await this.finish(tableId, runtime);
  }

  async draw(tableId: string, seatIndex: number): Promise<void> {
    const runtime = this.requireClangTable(tableId);
    const round = this.requireRound(runtime);
    new ClangEngine().draw(runtime.table, round, seatIndex);
    await this.finish(tableId, runtime);
  }

  async play(tableId: string, seatIndex: number, rank: number): Promise<void> {
    const runtime = this.requireClangTable(tableId);
    const round = this.requireRound(runtime);
    new ClangEngine().playRank(runtime.table, round, seatIndex, rank);
    await this.finish(tableId, runtime);
  }

  async eat(tableId: string, seatIndex: number): Promise<void> {
    const runtime = this.requireClangTable(tableId);
    const round = this.requireRound(runtime);
    new ClangEngine().eat(runtime.table, round, seatIndex);
    await this.finish(tableId, runtime);
  }

  async passEat(tableId: string, seatIndex: number): Promise<void> {
    const runtime = this.requireClangTable(tableId);
    const round = this.requireRound(runtime);
    new ClangEngine().passEat(runtime.table, round, seatIndex);
    await this.finish(tableId, runtime);
  }

  async callClang(tableId: string, seatIndex: number): Promise<void> {
    const runtime = this.requireClangTable(tableId);
    const round = this.requireRound(runtime);
    new ClangEngine().callClangNormal(runtime.table, round, seatIndex);
    await this.finish(tableId, runtime);
  }

  private requireRound(runtime: RuntimeTable) {
    if (!runtime.clangRound) throw new BadRequestException("No round in progress");
    return runtime.clangRound;
  }

  /** Shared tail for every action: auto-play through any away seats, settle if the round just ended, then broadcast. */
  private async finish(tableId: string, runtime: RuntimeTable): Promise<void> {
    this.resolveAwayTurns(runtime.table, runtime.clangRound);
    await this.settleIfComplete(tableId, runtime);
    this.tablesService.notifyChanged(tableId);
  }

  /**
   * Owner-only: called right when a seat is marked away, in case it's their
   * turn (or eat decision) right now — otherwise nobody else could act and
   * the round would stall waiting on a player who just stepped away. Safe to
   * call anytime; a no-op if this isn't a Clang table or no round is live.
   */
  async advanceAwaySeats(tableId: string): Promise<void> {
    const runtime = this.tablesService.getRuntimeTable(tableId);
    if (runtime.gameKind !== "clang" || !runtime.clangRound) return;
    await this.finish(tableId, runtime);
  }

  /**
   * Auto-plays through any seat currently up (turn or eat decision) that's
   * marked away, so an AFK player never stalls the table — mirrors poker's
   * away auto-check/fold. On your turn: draw, then discard your
   * highest-value rank (Clang scores low, so this is the "least harmful to
   * hold onto" default, not an arbitrary one). On an eat decision: always
   * decline, since passing is always legal and commits to nothing.
   */
  private resolveAwayTurns(table: TableState, round: ClangRoundState | null): void {
    if (!round) return;
    const engine = new ClangEngine();
    const isAway = (seatIndex: number) => table.seats[seatIndex]?.status === "sitting-out";

    while (round.phase !== "complete") {
      if (round.phase === "awaiting-eat" && round.pendingEat) {
        if (!isAway(round.pendingEat.eaterSeatIndex)) break;
        engine.passEat(table, round, round.pendingEat.eaterSeatIndex);
        continue;
      }
      if (round.phase === "turn" || round.phase === "instant-window") {
        const seatIndex = round.turnOrder[round.turnIndex] as number;
        if (!isAway(seatIndex)) break;
        engine.draw(table, round, seatIndex);
        continue; // empty pile still moves to awaiting-discard — let the loop re-check phase
      }
      if (round.phase === "awaiting-discard") {
        const seatIndex = round.turnOrder[round.turnIndex] as number;
        if (!isAway(seatIndex)) break;
        const player = round.players.find((p) => p.seatIndex === seatIndex);
        if (!player || player.hand.length === 0) break;
        engine.playRank(table, round, seatIndex, this.defaultRankToPlay(player.hand));
        continue;
      }
      break;
    }
  }

  /** Highest point-value rank in the hand — Clang scores low, so this is the card an away player would least want to keep. */
  private defaultRankToPlay(hand: Card[]): number {
    let bestRank = hand[0]!.rank;
    let bestValue = -1;
    for (const card of hand) {
      const value = cardPointValue(card);
      if (value > bestValue) {
        bestValue = value;
        bestRank = card.rank;
      }
    }
    return bestRank;
  }

  private async settleIfComplete(tableId: string, runtime: RuntimeTable): Promise<void> {
    const round = runtime.clangRound;
    if (!round || round.phase !== "complete") return;

    await this.prisma.clangRound.create({
      data: {
        tableId,
        roundNumber: round.roundNumber,
        stake: round.stake,
        eatPaymentPerCard: round.eatPaymentPerCard,
        outcome: JSON.parse(JSON.stringify(round.result)),
        bonusHits: JSON.parse(JSON.stringify(round.bonusHits)),
        players: JSON.parse(
          JSON.stringify(
            round.players.map((p) => {
              const seat = runtime.table.seats[p.seatIndex];
              return {
                seatIndex: p.seatIndex,
                userId: seat?.playerId ?? null,
                displayName: seat?.displayName ?? null,
                hand: p.hand,
                handValue: round.result?.reveal.find((r) => r.seatIndex === p.seatIndex)?.value ?? null,
              };
            })
          )
        ),
        actions: JSON.parse(JSON.stringify(round.actions)),
      },
    });

    for (const seat of runtime.table.seats) {
      if (seat.status === "active") {
        await this.prisma.seat.update({
          where: { tableId_seatIndex: { tableId, seatIndex: seat.seatIndex } },
          data: { stack: seat.stack },
        });
      }
    }
  }
}
