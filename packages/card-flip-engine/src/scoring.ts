import { Card, compareEvaluatedHands, describeEvaluatedHand, evaluateBestHand, type EvaluatedHand, type HandScore } from "@5lapnow/cards";

/**
 * `@5lapnow/cards`' evaluator only scores exact 5-card combinations, so it
 * can't rank a 2- or 3-card hand — but Card Flip needs that: a pair beats no
 * pair before anyone has 5 cards. Below 5 cards, only high-card/pair/two
 * pair/three-of-a-kind/four-of-a-kind are even reachable (straight/flush/full
 * house all require 5 cards by definition), so this builds a same-shaped
 * `HandScore` by simple rank-group counting for that case only — everything
 * else (5+ cards, comparison, and the human-readable label) reuses poker's
 * own evaluator/comparator/describer directly, unchanged.
 */

/** Category + kickers for hands too small for `evaluateBestHand` (below 5 cards). */
function partialHandScore(cards: Card[]): HandScore {
  const counts = new Map<number, number>();
  for (const c of cards) counts.set(c.rank, (counts.get(c.rank) ?? 0) + 1);
  const groups = [...counts.entries()].sort(([rankA, countA], [rankB, countB]) => countB - countA || rankB - rankA);
  const top = groups[0] as [number, number];
  const second = groups[1];
  const kickers = (exclude: number[]) => groups.filter(([rank]) => !exclude.includes(rank)).map(([rank]) => rank);

  if (top[1] >= 4) {
    const k = kickers([top[0]]);
    return [7, top[0], k[0] ?? 0, 0, 0, 0];
  }
  if (top[1] === 3) {
    const k = kickers([top[0]]);
    return [3, top[0], k[0] ?? 0, k[1] ?? 0, 0, 0];
  }
  if (top[1] === 2 && second && second[1] === 2) {
    const k = kickers([top[0], second[0]]);
    return [2, top[0], second[0], k[0] ?? 0, 0, 0];
  }
  if (top[1] === 2) {
    const k = kickers([top[0]]);
    return [1, top[0], k[0] ?? 0, k[1] ?? 0, k[2] ?? 0, 0];
  }
  const k = groups.map(([rank]) => rank); // all counts are 1 here, already sorted by rank desc
  return [0, k[0] ?? 0, k[1] ?? 0, k[2] ?? 0, k[3] ?? 0, k[4] ?? 0];
}

export function evaluatePartialHand(cards: Card[]): EvaluatedHand {
  if (cards.length >= 5) return evaluateBestHand(cards, "high");
  return { score: partialHandScore(cards), cards };
}

/** >0 if `a` beats `b`, <0 if `b` beats `a`, 0 for an exact tie — same comparator poker showdowns use. */
export function comparePartialHands(a: EvaluatedHand, b: EvaluatedHand): number {
  return compareEvaluatedHands(a, b, "high");
}

/** Human-readable label, e.g. "Pair of Kings", "King High Flush", "9 High Straight" — same describer poker showdowns use. */
export function describePartialHand(cards: Card[]): string {
  return describeEvaluatedHand(evaluatePartialHand(cards), "high");
}

// Category indices match @5lapnow/cards' HandScore (0=high card .. 8=straight flush).
const FOUR_OF_A_KIND_CATEGORY = 7;
const STRAIGHT_FLUSH_CATEGORY = 8;

export function isFourOfAKind(cards: Card[]): boolean {
  return evaluatePartialHand(cards).score[0] === FOUR_OF_A_KIND_CATEGORY;
}

/** Only reachable at 5+ cards — straight and flush both require a full 5-card hand by definition. */
export function isStraightFlush(cards: Card[]): boolean {
  return evaluatePartialHand(cards).score[0] === STRAIGHT_FLUSH_CATEGORY;
}
