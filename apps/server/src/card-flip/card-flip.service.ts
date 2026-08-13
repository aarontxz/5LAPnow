import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { CardFlipEngine, CardFlipRoundState } from "@5lapnow/card-flip-engine";
import { TableState } from "@5lapnow/game-engine";
import { PrismaService } from "../prisma/prisma.service";
import { TablesService } from "../tables/tables.service";
import { GamesService } from "../games/games.service";
import { RuntimeTable, captureStacksBefore } from "../tables/table-snapshot";

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

  async startRound(tableId: string, requesterUserId: string): Promise<void> {
    const runtime = this.tablesService.getRuntimeTable(tableId);
    if (requesterUserId !== runtime.ownerId) throw new ForbiddenException("Only the table owner can start a round");
    if (this.tablesService.isRoundInProgress(runtime)) {
      throw new BadRequestException("A hand or round is already in progress");
    }
    this.tablesService.assertStartCooldownElapsed(runtime);

    // Flush any stack corrections queued while the previous round was live, exactly like poker's startHand does.
    for (const [seatIndex, adjustment] of runtime.pendingStackAdjustments) {
      const seat = runtime.table.seats[seatIndex];
      if (seat && seat.playerId === adjustment.userId) {
        await this.tablesService.applyStackAdjustment(runtime, seatIndex, adjustment.mode, adjustment.amount);
      }
    }
    runtime.pendingStackAdjustments.clear();

    // Resolve the game for this round: one-off override falls back to current
    // game — which may itself be switching the table's engine.
    const targetGameDefinitionId = runtime.nextGameOverride?.gameDefinitionId ?? runtime.gameDefinitionId;
    runtime.nextGameOverride = null;
    const targetRow = await this.gamesService.getRow(targetGameDefinitionId);
    if (targetRow.engine !== "cardflip") throw new BadRequestException("Next game is not 10 Card Flip");
    const baseConfig = await this.gamesService.getCardFlipDefinition(targetRow.id);
    // Owner's Settings override layered on top — never mutates the (globally
    // shared) GameDefinition row itself, see TablesService.setGameConfig.
    const config = { ...baseConfig, ...runtime.gameConfigOverrides.cardflip };

    if (runtime.gameKind !== "cardflip" || targetRow.id !== runtime.gameDefinitionId) {
      runtime.gameKind = "cardflip";
      runtime.gameDefinition = null;
      runtime.gameDefinitionId = targetRow.id;
      runtime.gameName = targetRow.name;
      runtime.hand = null;
      runtime.clangRound = null;
      await this.prisma.table.update({ where: { id: tableId }, data: { gameDefinitionId: targetRow.id } });
    }

    // Must snapshot before startRound (mirrors poker/Clang) — read back in
    // settleIfComplete as each seat's stackBefore.
    runtime.stacksBeforeCurrentRound = captureStacksBefore(runtime.table);

    const engine = new CardFlipEngine();
    runtime.gameCounter += 1;
    runtime.cardFlipRound = engine.startRound(runtime.table, runtime.gameCounter, config);

    await this.finish(tableId, runtime);
  }

  async draw(tableId: string, seatIndex: number, pileIndex: number): Promise<void> {
    const runtime = this.requireCardFlipTable(tableId);
    const round = this.requireRound(runtime);
    new CardFlipEngine().draw(runtime.table, round, seatIndex, pileIndex);
    await this.finish(tableId, runtime);
  }

  private requireRound(runtime: RuntimeTable) {
    if (!runtime.cardFlipRound) throw new BadRequestException("No round in progress");
    return runtime.cardFlipRound;
  }

  /** Shared tail for every action: auto-draw through any away seats, settle if the round just ended, then broadcast. */
  private async finish(tableId: string, runtime: RuntimeTable): Promise<void> {
    this.resolveAwayTurns(runtime.table, runtime.cardFlipRound);
    await this.settleIfComplete(tableId, runtime);
    this.tablesService.notifyChanged(tableId);
  }

  /**
   * Owner-only: called right when a seat is marked away, in case it's their
   * turn right now — otherwise nobody else could act and the round would
   * stall. Safe to call anytime; a no-op if this isn't a Card Flip table or
   * no round is live.
   */
  async advanceAwaySeats(tableId: string): Promise<void> {
    const runtime = this.tablesService.getRuntimeTable(tableId);
    // Nothing to resolve once the round has already finished and been settled —
    // avoids pointlessly re-entering the settlement path on every later "away"
    // toggle at this table (it used to be harmless-but-wasteful; now it's just unnecessary).
    if (runtime.gameKind !== "cardflip" || !runtime.cardFlipRound || runtime.cardFlipRound.settled) return;
    await this.finish(tableId, runtime);
  }

  /**
   * Auto-draws through any seat currently up whose turn is marked away, so an
   * AFK player never stalls the table — mirrors poker's away auto-check/fold.
   * Which pile doesn't matter (each pile is just an arbitrary slice of one
   * shuffled deck — see the pile-choice discussion elsewhere), so this always
   * draws from the first non-empty one; the beat-the-leader rule itself
   * decides whether that single draw ends their turn or forces another.
   */
  private resolveAwayTurns(table: TableState, round: CardFlipRoundState | null): void {
    if (!round) return;
    const engine = new CardFlipEngine();
    const isAway = (seatIndex: number) => table.seats[seatIndex]?.status === "sitting-out";

    while (round.phase === "turn") {
      const seatIndex = round.turnOrder[round.turnIndex] as number;
      if (!isAway(seatIndex)) break;
      const pileIndex = round.piles.findIndex((pile) => pile.length > 0);
      if (pileIndex === -1) break; // no cards left anywhere; let the normal draw path surface that
      engine.draw(table, round, seatIndex, pileIndex);
    }
  }

  private async settleIfComplete(tableId: string, runtime: RuntimeTable): Promise<void> {
    const round = runtime.cardFlipRound;
    // `round.settled` guards against re-persisting the same round — `finish()` can be
    // re-entered for an already-complete round any time before the next `startRound`
    // (e.g. `advanceAwaySeats` fires on every "away" toggle, with no phase check of its
    // own), and without this guard each re-entry inserted another duplicate round row.
    if (!round || round.phase !== "complete" || round.settled) return;
    round.settled = true;
    runtime.roundEndedAt = Date.now();
    await this.tablesService.applyAwayAfterRound(runtime);

    const stacksBefore = new Map((runtime.stacksBeforeCurrentRound ?? []).map((s) => [s.seatIndex, s.stack]));
    runtime.stacksBeforeCurrentRound = null;

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
                stackBefore: stacksBefore.get(p.seatIndex) ?? null,
                stackAfter: seat?.stack ?? null,
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
