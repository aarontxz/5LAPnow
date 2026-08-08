import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { ClangEngine, DEFAULT_BONUS_PAYOUTS } from "@5lapnow/clang-engine";
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

  async startRound(tableId: string, requesterUserId: string, stake: number, eatPaymentPerCard: number): Promise<void> {
    const runtime = this.tablesService.getRuntimeTable(tableId);
    if (requesterUserId !== runtime.ownerId) throw new ForbiddenException("Only the table owner can start a round");
    if (this.tablesService.isRoundInProgress(runtime)) {
      throw new BadRequestException("A hand or round is already in progress");
    }
    if (stake <= 0) throw new BadRequestException("Stake must be positive");
    if (eatPaymentPerCard < 0) throw new BadRequestException("Eat payment cannot be negative");

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
    runtime.clangRound = engine.startRound(runtime.table, runtime.gameCounter, stake, eatPaymentPerCard, DEFAULT_BONUS_PAYOUTS);
    runtime.clangLastStake = stake;
    runtime.clangLastEatPaymentPerCard = eatPaymentPerCard;

    await this.settleIfComplete(tableId, runtime);
    this.tablesService.notifyChanged(tableId);
  }

  async callInstantClang(tableId: string, seatIndex: number): Promise<void> {
    const runtime = this.requireClangTable(tableId);
    const round = this.requireRound(runtime);
    new ClangEngine().callInstantClang(runtime.table, round, seatIndex);
    await this.settleIfComplete(tableId, runtime);
    this.tablesService.notifyChanged(tableId);
  }

  async play(tableId: string, seatIndex: number, rank: number): Promise<void> {
    const runtime = this.requireClangTable(tableId);
    const round = this.requireRound(runtime);
    new ClangEngine().playRank(runtime.table, round, seatIndex, rank);
    await this.settleIfComplete(tableId, runtime);
    this.tablesService.notifyChanged(tableId);
  }

  async eat(tableId: string, seatIndex: number): Promise<void> {
    const runtime = this.requireClangTable(tableId);
    const round = this.requireRound(runtime);
    new ClangEngine().eat(runtime.table, round, seatIndex);
    await this.settleIfComplete(tableId, runtime);
    this.tablesService.notifyChanged(tableId);
  }

  async passEat(tableId: string, seatIndex: number): Promise<void> {
    const runtime = this.requireClangTable(tableId);
    const round = this.requireRound(runtime);
    new ClangEngine().passEat(runtime.table, round, seatIndex);
    await this.settleIfComplete(tableId, runtime);
    this.tablesService.notifyChanged(tableId);
  }

  async callClang(tableId: string, seatIndex: number): Promise<void> {
    const runtime = this.requireClangTable(tableId);
    const round = this.requireRound(runtime);
    new ClangEngine().callClangNormal(runtime.table, round, seatIndex);
    await this.settleIfComplete(tableId, runtime);
    this.tablesService.notifyChanged(tableId);
  }

  private requireRound(runtime: RuntimeTable) {
    if (!runtime.clangRound) throw new BadRequestException("No round in progress");
    return runtime.clangRound;
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

    await this.tablesService.settleStandRequests(runtime);
  }
}
