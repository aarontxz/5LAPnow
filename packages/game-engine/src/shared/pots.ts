import {
  evaluateBestHand,
  evaluateBestHandExact,
  evaluateQualifyingLow,
  evaluateQualifyingLowExact,
  compareEvaluatedHands,
  describeEvaluatedHand,
  Card,
  EvaluatedHand,
  RANK_LABELS,
  Rank,
} from "@5lapnow/cards";
import { Bounty } from "./gameDefinition.js";
import { TableState } from "./table.js";
import { HandState, PotResult, PotShare, ShowdownResult } from "./handState.js";

function withDescription(shares: PotShare[], description: string): PotShare[] {
  return shares.map((s) => ({ ...s, description }));
}

export function splitAmountEvenly(amount: number, winnerSeatIndices: number[], remainderOrder: number[]): PotShare[] {
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
  const mustShowSeats = [...new Set(pots.filter((p) => p.eligibleSeats.length > 1).flatMap((p) => p.eligibleSeats))];

  for (const pot of pots) {
    if (pot.eligibleSeats.length === 0) continue;
    if (pot.eligibleSeats.length === 1) {
      pot.hiWinners = [{ seatIndex: pot.eligibleSeats[0] as number, amount: pot.amount }];
      awardChips(table, pot.hiWinners);
      continue;
    }

    const mode = hand.gameDefinition.handRanking.mode;
    const exactHoleCardsUsed = hand.gameDefinition.handRanking.exactHoleCardsUsed;
    const holeCardsOf = (seatIndex: number): Card[] => hand.players.get(seatIndex)?.holeCards ?? [];
    // Omaha-style games (exactHoleCardsUsed set) must use exactly that many hole cards;
    // Hold'em-style games pick freely from hole + board combined.
    const bestHandOn = (seatIndex: number, boardCards: Card[]): EvaluatedHand =>
      exactHoleCardsUsed !== undefined
        ? evaluateBestHandExact(holeCardsOf(seatIndex), boardCards, exactHoleCardsUsed, mode)
        : evaluateBestHand([...holeCardsOf(seatIndex), ...boardCards], mode);
    const qualifyingLowOn = (seatIndex: number, boardCards: Card[]): EvaluatedHand | null =>
      exactHoleCardsUsed !== undefined
        ? evaluateQualifyingLowExact(holeCardsOf(seatIndex), boardCards, exactHoleCardsUsed)
        : evaluateQualifyingLow([...holeCardsOf(seatIndex), ...boardCards]);

    if (hand.gameDefinition.handRanking.splitPot === "hi-lo-8-or-better") {
      const potHalf = Math.floor(pot.amount / 2);
      const hiHalf = pot.amount - potHalf; // odd chip goes to the hi side by convention
      const hiEvals = pot.eligibleSeats.map((s) => ({ seatIndex: s, hand: bestHandOn(s, hand.board) }));
      const bestHi = hiEvals.reduce((best, cur) =>
        compareEvaluatedHands(cur.hand, best.hand, mode) > 0 ? cur : best
      );
      const hiWinnerSeats = hiEvals
        .filter((e) => compareEvaluatedHands(e.hand, bestHi.hand, mode) === 0)
        .map((e) => e.seatIndex);

      const loEvals = pot.eligibleSeats
        .map((s) => ({ seatIndex: s, low: qualifyingLowOn(s, hand.board) }))
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
    } else if (hand.gameDefinition.handRanking.scoring === "point-race") {
      // Each board (plus an optional hole-cards-only category) is worth 1 point,
      // split evenly among that category's tied winners; whoever has the
      // highest total points takes the *entire* pot (ties split the pot
      // evenly). Point totals are tracked as integer units (not floats) so
      // that e.g. three 1/3-splits sum to exactly a whole point.
      const numBoards = hand.boards.length;
      const POINT_SCALE = 2520; // lcm(1..10) — exact for any tie-group size up to the schema's 10-player max

      const pointUnits = new Map<number, number>(pot.eligibleSeats.map((s) => [s, 0]));
      const awardCategory = (evalFor: (seatIndex: number) => EvaluatedHand): void => {
        const evals = pot.eligibleSeats.map((s) => ({ seatIndex: s, hand: evalFor(s) }));
        const best = evals.reduce((a, b) => (compareEvaluatedHands(b.hand, a.hand, mode) > 0 ? b : a));
        const winners = evals.filter((e) => compareEvaluatedHands(e.hand, best.hand, mode) === 0).map((e) => e.seatIndex);
        const share = Math.floor(POINT_SCALE / winners.length);
        for (const seatIndex of winners) pointUnits.set(seatIndex, (pointUnits.get(seatIndex) as number) + share);
      };

      for (let bi = 0; bi < numBoards; bi++) {
        const boardCards = hand.boards[bi] ?? [];
        awardCategory((s) => bestHandOn(s, boardCards));
      }
      if (hand.gameDefinition.handRanking.includeHandOnlyCategory) {
        awardCategory((s) => evaluateBestHand(hand.players.get(s)?.holeCards ?? [], mode));
      }

      const maxUnits = Math.max(...pointUnits.values());
      const winnerSeats = [...pointUnits.entries()].filter(([, units]) => units === maxUnits).map(([s]) => s);
      pot.hiWinners = withDescription(
        splitAmountEvenly(pot.amount, winnerSeats, pot.eligibleSeats),
        `${(maxUnits / POINT_SCALE).toFixed(2)} points`
      ).map((s) => ({ ...s, points: maxUnits / POINT_SCALE }));
    } else if (hand.boards.length > 1) {
      // Split pot equally across boards; each board share goes to that board's best hand.
      const numBoards = hand.boards.length;
      const baseShare = Math.floor(pot.amount / numBoards);
      for (let bi = 0; bi < numBoards; bi++) {
        const share = bi === 0 ? pot.amount - baseShare * (numBoards - 1) : baseShare;
        const boardCards = hand.boards[bi] ?? [];
        const evals = pot.eligibleSeats.map((s) => ({ seatIndex: s, hand: bestHandOn(s, boardCards) }));
        const best = evals.reduce((a, b) => (compareEvaluatedHands(b.hand, a.hand, mode) > 0 ? b : a));
        const winnerSeats = evals.filter((e) => compareEvaluatedHands(e.hand, best.hand, mode) === 0).map((e) => e.seatIndex);
        const boardShares = withDescription(
          splitAmountEvenly(share, winnerSeats, pot.eligibleSeats),
          describeEvaluatedHand(best.hand, mode)
        ).map((s) => ({ ...s, boardIndex: bi }));
        pot.hiWinners.push(...boardShares);
      }
    } else {
      const evals = pot.eligibleSeats.map((s) => ({ seatIndex: s, hand: bestHandOn(s, hand.board) }));
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

  const bounty = settleBounty(table, hand, pots);

  return { pots, revealedSeats, mustShowSeats, bounty };
}

function awardChips(table: TableState, shares: PotShare[]): void {
  for (const share of shares) {
    const seat = table.seats[share.seatIndex];
    if (seat) seat.stack += share.amount;
  }
}

/**
 * A bounty combo is exactly two cards, so a hand of any other size can never
 * match — a four-card Omaha hand holding a 2 and a 7 alongside two other
 * cards does not qualify, and neither does a hand still short of its full
 * complement. Suits are ignored entirely: suited and offsuit both pay.
 */
function matchesBounty(holeCards: Card[], bounty: Bounty): boolean {
  if (holeCards.length !== 2) return false;
  const [a, b] = holeCards as [Card, Card];
  return (a.rank === bounty.ranks[0] && b.rank === bounty.ranks[1]) || (a.rank === bounty.ranks[1] && b.rank === bounty.ranks[0]);
}

/**
 * A bounty is a direct player-to-player side-payment, not a redistribution
 * of chips already collected into a pot — unlike `awardChips`, it debits the
 * paying seats itself, capped at whatever they still have (a bounty never
 * puts a seat's stack below zero). Only the lowest-seat-index qualifying
 * winner is paid per hand; two different winners both qualifying in the same
 * hand is rare enough in practice not to need split/double-charge handling.
 */
function settleBounty(table: TableState, hand: HandState, pots: PotResult[]): PotShare | null {
  const bountyRule = hand.gameDefinition.bounty;
  if (!bountyRule) return null;

  const winnerSeats = [...new Set(pots.flatMap((p) => p.hiWinners.map((s) => s.seatIndex)))].sort((a, b) => a - b);
  const winnerSeatIndex = winnerSeats.find((s) => matchesBounty(hand.players.get(s)?.holeCards ?? [], bountyRule));
  if (winnerSeatIndex === undefined) return null;

  let collected = 0;
  for (const payerSeatIndex of hand.players.keys()) {
    if (payerSeatIndex === winnerSeatIndex) continue;
    const payerSeat = table.seats[payerSeatIndex];
    if (!payerSeat) continue;
    const amount = Math.min(bountyRule.payoutPerOpponent, payerSeat.stack);
    if (amount <= 0) continue;
    payerSeat.stack -= amount;
    collected += amount;
  }
  if (collected <= 0) return null;

  const winnerSeat = table.seats[winnerSeatIndex];
  if (winnerSeat) winnerSeat.stack += collected;

  const label = `${RANK_LABELS[bountyRule.ranks[0] as Rank]}-${RANK_LABELS[bountyRule.ranks[1] as Rank]}`;
  return { seatIndex: winnerSeatIndex, amount: collected, description: `${label} bounty` };
}
