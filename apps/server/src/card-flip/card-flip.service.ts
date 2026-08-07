import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { CardFlipEngine } from "@5lapnow/card-flip-engine";
import { PrismaService } from "../prisma/prisma.service";
import { TablesService } from "../tables/tables.service";
import { GamesService } from "../games/games.service";
import { RuntimeTable } from "../tables/table-snapshot";

/**
 * Owns the "10 Card Flip" round/turn state machine (via CardFlipEngine) while
 * reusing TablesService's seat/stack/ledger machinery and its RuntimeTable
 * map — same pattern as ClangService.
 */
@Injectable()
export class CardFlipService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tablesService: TablesService,
    private readonly gamesService: GamesService
  ) {}

  private requireCardFlipTable(tableId: string): RuntimeTable {
    const runtime = this.tablesService.getRuntimeTable(tableId);
    if (runtime.gameKind !== "cardflip") throw new BadRequestException("This is not a 10 Card Flip table");
    return runtime;
  }

  async startRound(tableId: string, requesterUserId: string, stake: number, cardsPerPlayer: number): Promise<void> {
    const runtime = this.tablesService.getRuntimeTable(tableId);
    if (requesterUserId !== runtime.ownerId) throw new ForbiddenException("Only the table owner can start a round");
    if (this.tablesService.isRoundInProgress(runtime)) {
      throw new BadRequestException("A hand or round is already in progress");
    }
    if (stake <= 0) throw new BadRequestException("Stake must be positive");
    if (cardsPerPlayer <= 0) throw new BadRequestException("Cards per player must be positive");

    // Flush any stack corrections queued while the previous round was live, exactly like poker's startHand does.
    for (const [seatIndex, adjustment] of runtime.pendingStackAdjustments) {
      const seat = runtime.table.seats[seatIndex];
      if (seat && seat.playerId === adjustment.userId) {
        await this.tablesService.applyStackAdjustment(runtime, seatIndex, adjustment.newStack);
      }
    }
    runtime.pendingStackAdjustments.clear();

    // Resolve the game for this round: one-off override falls back to current
    // game — which may itself be switching the table's engine.
    const targetGameDefinitionId = runtime.nextGameOverride?.gameDefinitionId ?? runtime.gameDefinitionId;
    runtime.nextGameOverride = null;
    const targetRow = await this.gamesService.getRow(targetGameDefinitionId);
    if (targetRow.engine !== "cardflip") throw new BadRequestException("Next game is not 10 Card Flip");

    if (runtime.gameKind !== "cardflip" || targetRow.id !== runtime.gameDefinitionId) {
      runtime.gameKind = "cardflip";
      runtime.gameDefinition = null;
      runtime.gameDefinitionId = targetRow.id;
      runtime.gameName = targetRow.name;
      runtime.hand = null;
      runtime.clangRound = null;
      await this.prisma.table.update({ where: { id: tableId }, data: { gameDefinitionId: targetRow.id } });
    }

    const engine = new CardFlipEngine();
    runtime.gameCounter += 1;
    runtime.cardFlipRound = engine.startRound(runtime.table, runtime.gameCounter, stake, cardsPerPlayer);

    await this.settleIfComplete(tableId, runtime);
    this.tablesService.notifyChanged(tableId);
  }

  async draw(tableId: string, seatIndex: number, pileIndex: number): Promise<void> {
    const runtime = this.requireCardFlipTable(tableId);
    const round = this.requireRound(runtime);
    new CardFlipEngine().draw(runtime.table, round, seatIndex, pileIndex);
    await this.settleIfComplete(tableId, runtime);
    this.tablesService.notifyChanged(tableId);
  }

  private requireRound(runtime: RuntimeTable) {
    if (!runtime.cardFlipRound) throw new BadRequestException("No round in progress");
    return runtime.cardFlipRound;
  }

  private async settleIfComplete(tableId: string, runtime: RuntimeTable): Promise<void> {
    const round = runtime.cardFlipRound;
    if (!round || round.phase !== "complete") return;

    await this.prisma.cardFlipRound.create({
      data: {
        tableId,
        roundNumber: round.roundNumber,
        stake: round.stake,
        cardsPerPlayer: round.cardsPerPlayer,
        outcome: JSON.parse(JSON.stringify(round.result)),
        players: JSON.parse(
          JSON.stringify(
            round.players.map((p) => {
              const seat = runtime.table.seats[p.seatIndex];
              return {
                seatIndex: p.seatIndex,
                userId: seat?.playerId ?? null,
                displayName: seat?.displayName ?? null,
                hand: p.hand,
                bestHandLabel: round.result?.reveal.find((r) => r.seatIndex === p.seatIndex)?.bestHandLabel ?? "",
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
