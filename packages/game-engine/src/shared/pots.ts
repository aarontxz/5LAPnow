import { evaluateBestHand, evaluateQualifyingLow, compareEvaluatedHands, describeEvaluatedHand, Card } from "@5lapnow/cards";
import { TableState } from "./table.js";
import { HandState, PotResult, PotShare, ShowdownResult } from "./handState.js";

function withDescription(shares: PotShare[], description: string): PotShare[] {
  return shares.map((s) => ({ ...s, description }));
}

function splitAmountEvenly(amount: number, winnerSeatIndices: number[], remainderOrder: number[]): PotShare[] {
  const base = Math.floor(amount / winnerSeatIndices.length);
  let remainder = amount - base * winnerSeatIndices.length;
  const shares = new Map<number, number>();
  for (const seatIndex of winnerSeatIndices) shares.set(seatIndex, base);
  for (const seatIndex of remainderOrder) {
    if (remainder <= 0) break;
    if (!shares.has(seatIndex)) continue;
    shares.set(seatIndex, (shares.get(seatIndex) as number) + 1);
    remainder -= 1;
  }
  return [...shares.entries()].map(([seatIndex, amount]) => ({ seatIndex, amount }));
}

/**
 * Computes side pots from each player's total contribution this hand, then
 * (for each pot, richest-eligible-set-first order doesn't matter for award
 * correctness) determines winners by hand strength. Works identically for a
 * single remaining player (win-by-fold): every pot level has exactly one
 * eligible seat, so they receive the entire pot.
 */
export function settleShowdown(table: TableState, hand: HandState): ShowdownResult {
  const contributions = [...hand.players.values()]
    .filter((p) => p.totalContributed > 0)
    .map((p) => ({ seatIndex: p.seatIndex, amount: p.totalContributed, folded: p.folded }));

  const levels = [...new Set(contributions.map((c) => c.amount))].sort((a, b) => a - b);

  const pots: PotResult[] = [];
  let previousLevel = 0;
  for (const level of levels) {
    const contributingSeats = contributions.filter((c) => c.amount >= level);
    const potAmount = (level - previousLevel) * contributingSeats.length;
    previousLevel = level;
    if (potAmount <= 0) continue;
    const eligibleSeats = contributingSeats.filter((c) => !c.folded).map((c) => c.seatIndex);
    pots.push({ amount: potAmount, eligibleSeats, hiWinners: [], loWinners: [] });
  }

  const revealedSeats = [...hand.players.values()].filter((p) => !p.folded).map((p) => p.seatIndex);

  for (const pot of pots) {
    if (pot.eligibleSeats.length === 0) continue;
    if (pot.eligibleSeats.length === 1) {
      pot.hiWinners = [{ seatIndex: pot.eligibleSeats[0] as number, amount: pot.amount }];
      awardChips(table, pot.hiWinners);
      continue;
    }

    const mode = hand.gameDefinition.handRanking.mode;
    const cardsFor = (seatIndex: number): Card[] => [
      ...(hand.players.get(seatIndex)?.holeCards ?? []),
      ...hand.board,
    ];

    if (hand.gameDefinition.handRanking.splitPot === "hi-lo-8-or-better") {
      const potHalf = Math.floor(pot.amount / 2);
      const hiHalf = pot.amount - potHalf; // odd chip goes to the hi side by convention
      const hiEvals = pot.eligibleSeats.map((s) => ({ seatIndex: s, hand: evaluateBestHand(cardsFor(s), mode) }));
      const bestHi = hiEvals.reduce((best, cur) =>
        compareEvaluatedHands(cur.hand, best.hand, mode) > 0 ? cur : best
      );
      const hiWinnerSeats = hiEvals
        .filter((e) => compareEvaluatedHands(e.hand, bestHi.hand, mode) === 0)
        .map((e) => e.seatIndex);

      const loEvals = pot.eligibleSeats
        .map((s) => ({ seatIndex: s, low: evaluateQualifyingLow(cardsFor(s)) }))
        .filter((e): e is { seatIndex: number; low: NonNullable<ReturnType<typeof evaluateQualifyingLow>> } => e.low !== null);

      const hiDescription = describeEvaluatedHand(bestHi.hand, mode);
      if (loEvals.length === 0) {
        pot.hiWinners = withDescription(splitAmountEvenly(pot.amount, hiWinnerSeats, pot.eligibleSeats), hiDescription);
      } else {
        const bestLo = loEvals.reduce((best, cur) =>
          compareEvaluatedHands(cur.low, best.low, "low-ace-to-five") > 0 ? cur : best
        );
        const loWinnerSeats = loEvals
          .filter((e) => compareEvaluatedHands(e.low, bestLo.low, "low-ace-to-five") === 0)
          .map((e) => e.seatIndex);
        const loDescription = describeEvaluatedHand(bestLo.low, "low-ace-to-five");
        pot.hiWinners = withDescription(splitAmountEvenly(hiHalf, hiWinnerSeats, pot.eligibleSeats), hiDescription);
        pot.loWinners = withDescription(splitAmountEvenly(potHalf, loWinnerSeats, pot.eligibleSeats), loDescription);
      }
    } else {
      const evals = pot.eligibleSeats.map((s) => ({ seatIndex: s, hand: evaluateBestHand(cardsFor(s), mode) }));
      const best = evals.reduce((best, cur) => (compareEvaluatedHands(cur.hand, best.hand, mode) > 0 ? cur : best));
      const winnerSeats = evals
        .filter((e) => compareEvaluatedHands(e.hand, best.hand, mode) === 0)
        .map((e) => e.seatIndex);
      pot.hiWinners = withDescription(
        splitAmountEvenly(pot.amount, winnerSeats, pot.eligibleSeats),
        describeEvaluatedHand(best.hand, mode)
      );
    }

    awardChips(table, [...pot.hiWinners, ...pot.loWinners]);
  }

  return { pots, revealedSeats };
}

function awardChips(table: TableState, shares: PotShare[]): void {
  for (const share of shares) {
    const seat = table.seats[share.seatIndex];
    if (seat) seat.stack += share.amount;
  }
}
