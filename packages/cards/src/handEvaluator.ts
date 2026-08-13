import { Card } from "./card.js";

/**
 * score = [category, kicker1..kicker5]. Always length 6 so comparisons are
 * simple lexicographic array comparisons regardless of hand category.
 * Category numbering follows standard high-hand ranking (0=high card .. 8=straight flush);
 * low-hand evaluation reuses the same category numbers but callers compare in the
 * opposite direction (see compareEvaluatedHands).
 */
export type HandScore = [number, number, number, number, number, number];

export type HandRankingMode = "high" | "low-ace-to-five" | "low-deuce-to-seven";

export interface EvaluatedHand {
  score: HandScore;
  cards: Card[];
}

function kCombinations<T>(items: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (items.length < k) return [];
  const [first, ...rest] = items;
  const withFirst = kCombinations(rest, k - 1).map((combo) => [first as T, ...combo]);
  const withoutFirst = kCombinations(rest, k);
  return [...withFirst, ...withoutFirst];
}

function groupByRank(ranks: number[]): Array<[number, number]> {
  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
}

interface ScoreOptions {
  /** Ace counts as low (rank 1) instead of high (rank 14). */
  aceLow?: boolean;
  /** Whether flushes/straights are recognized as scoring categories. */
  recognizeStraightsAndFlushes?: boolean;
  /** Whether A-2-3-4-5 counts as a straight (only relevant when straights are recognized). */
  allowWheel?: boolean;
}

function scoreFiveCards(cards: Card[], options: ScoreOptions = {}): HandScore {
  const {
    aceLow = false,
    recognizeStraightsAndFlushes = true,
    allowWheel = true,
  } = options;

  const ranks = cards
    .map((c) => (aceLow && c.rank === 14 ? 1 : c.rank))
    .sort((a, b) => b - a);
  const suits = cards.map((c) => c.suit);
  const isFlush = recognizeStraightsAndFlushes && suits.every((s) => s === suits[0]);

  const uniqueDesc = [...new Set(ranks)];
  let straightHigh: number | null = null;
  if (recognizeStraightsAndFlushes && uniqueDesc.length === 5) {
    if ((uniqueDesc[0] as number) - (uniqueDesc[4] as number) === 4) {
      straightHigh = uniqueDesc[0] as number;
    } else if (allowWheel && uniqueDesc.join(",") === "14,5,4,3,2") {
      straightHigh = 5; // wheel: A-2-3-4-5 plays as a 5-high straight
    }
  }
  const isStraight = straightHigh !== null;

  const groups = groupByRank(ranks);
  const topCount = groups[0]?.[1] ?? 0;

  const pad = (nums: number[]): HandScore => {
    const arr = nums.slice(0, 5);
    while (arr.length < 5) arr.push(0);
    return [0, ...arr] as unknown as HandScore;
  };
  const withCategory = (category: number, kickers: number[]): HandScore => {
    const s = pad(kickers);
    s[0] = category;
    return s;
  };

  if (isStraight && isFlush) return withCategory(8, [straightHigh as number]);
  if (topCount === 4) {
    const quad = groups[0][0];
    const kicker = groups[1][0];
    return withCategory(7, [quad, kicker]);
  }
  if (topCount === 3 && groups[1]?.[1] === 2) {
    return withCategory(6, [groups[0][0], groups[1][0]]);
  }
  if (isFlush) return withCategory(5, ranks);
  if (isStraight) return withCategory(4, [straightHigh as number]);
  if (topCount === 3) {
    const kickers = groups.slice(1).map((g) => g[0]).sort((a, b) => b - a);
    return withCategory(3, [groups[0][0], ...kickers]);
  }
  if (topCount === 2 && groups[1]?.[1] === 2) {
    const pairs = [groups[0][0], groups[1][0]].sort((a, b) => b - a);
    const kicker = groups[2][0];
    return withCategory(2, [...pairs, kicker]);
  }
  if (topCount === 2) {
    const kickers = groups.slice(1).map((g) => g[0]).sort((a, b) => b - a);
    return withCategory(1, [groups[0][0], ...kickers]);
  }
  return withCategory(0, ranks);
}

function compareScoreArrays(a: HandScore, b: HandScore): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return (a[i] as number) - (b[i] as number);
  }
  return 0;
}

function modeConfig(mode: HandRankingMode): { scoreOptions: ScoreOptions; pickMax: boolean } {
  switch (mode) {
    case "high":
      return { scoreOptions: { recognizeStraightsAndFlushes: true, allowWheel: true }, pickMax: true };
    case "low-deuce-to-seven":
      // Ace always high, straights/flushes count against you; lower raw score wins.
      return { scoreOptions: { recognizeStraightsAndFlushes: true, allowWheel: false }, pickMax: false };
    case "low-ace-to-five":
      // Ace always low, straights/flushes are irrelevant; lower raw score wins.
      return { scoreOptions: { aceLow: true, recognizeStraightsAndFlushes: false }, pickMax: false };
  }
}

function pickBest(combos: Card[][], scoreOptions: ScoreOptions, pickMax: boolean): EvaluatedHand {
  let best: EvaluatedHand | null = null;
  for (const combo of combos) {
    const score = scoreFiveCards(combo, scoreOptions);
    if (
      !best ||
      (pickMax ? compareScoreArrays(score, best.score) > 0 : compareScoreArrays(score, best.score) < 0)
    ) {
      best = { score, cards: combo };
    }
  }
  if (!best) throw new Error("No card combinations to evaluate");
  return best;
}

function bestCombination(
  cards: Card[],
  handSize: number,
  scoreOptions: ScoreOptions,
  pickMax: boolean
): EvaluatedHand {
  if (cards.length < handSize) {
    throw new Error(`Need at least ${handSize} cards to evaluate a hand, got ${cards.length}`);
  }
  const combos = cards.length === handSize ? [cards] : kCombinations(cards, handSize);
  return pickBest(combos, scoreOptions, pickMax);
}

/**
 * Finds the best 5-card hand from the given cards for the given ranking mode.
 * The returned score is directly comparable via compareEvaluatedHands for that
 * same mode (do not compare scores from different modes to each other).
 */
export function evaluateBestHand(cards: Card[], mode: HandRankingMode = "high"): EvaluatedHand {
  const { scoreOptions, pickMax } = modeConfig(mode);
  return bestCombination(cards, 5, scoreOptions, pickMax);
}

/**
 * Omaha-style evaluation: the best 5-card hand using exactly `exactHoleCount`
 * hole cards combined with the rest from `communityCards` (unlike
 * evaluateBestHand, which picks freely from all cards combined).
 */
export function evaluateBestHandExact(
  holeCards: Card[],
  communityCards: Card[],
  exactHoleCount: number,
  mode: HandRankingMode = "high"
): EvaluatedHand {
  const communityCount = 5 - exactHoleCount;
  if (exactHoleCount < 0 || communityCount < 0) {
    throw new Error(`exactHoleCount must be between 0 and 5, got ${exactHoleCount}`);
  }
  if (holeCards.length < exactHoleCount) {
    throw new Error(`Need at least ${exactHoleCount} hole cards, got ${holeCards.length}`);
  }
  if (communityCards.length < communityCount) {
    throw new Error(`Need at least ${communityCount} community cards, got ${communityCards.length}`);
  }

  const holeCombos = kCombinations(holeCards, exactHoleCount);
  const communityCombos = kCombinations(communityCards, communityCount);
  const combos: Card[][] = [];
  for (const h of holeCombos) {
    for (const c of communityCombos) {
      combos.push([...h, ...c]);
    }
  }

  const { scoreOptions, pickMax } = modeConfig(mode);
  return pickBest(combos, scoreOptions, pickMax);
}

/** Returns >0 if `a` beats `b`, <0 if `b` beats `a`, 0 for a tie (chop). */
export function compareEvaluatedHands(a: EvaluatedHand, b: EvaluatedHand, mode: HandRankingMode): number {
  const raw = compareScoreArrays(a.score, b.score);
  const higherRawWins = mode === "high" || mode === "low-deuce-to-seven" ? mode === "high" : false;
  return higherRawWins ? raw : -raw;
}

const RANK_NAMES: Record<number, string> = {
  2: "2", 3: "3", 4: "4", 5: "5", 6: "6", 7: "7", 8: "8", 9: "9", 10: "10",
  11: "Jack", 12: "Queen", 13: "King", 14: "Ace",
};

function rankName(rank: number): string {
  return RANK_NAMES[rank] ?? String(rank);
}

/** Human-readable label for a showdown hand, e.g. "Full House, Kings full of Fives" or "7-5-4-3-2 Low". */
export function describeEvaluatedHand(hand: EvaluatedHand, mode: HandRankingMode): string {
  if (mode !== "high") {
    const ranks = hand.cards
      .map((c) => (mode === "low-ace-to-five" && c.rank === 14 ? 1 : c.rank))
      .sort((a, b) => b - a);
    return `${ranks.map((r) => (r === 1 ? "A" : rankName(r))).join("-")} Low`;
  }

  const [category, k1, k2] = hand.score;
  switch (category) {
    case 8:
      return `Straight Flush, ${rankName(k1)} High`;
    case 7:
      return `Four of a Kind, ${rankName(k1)}s`;
    case 6:
      return `Full House, ${rankName(k1)}s full of ${rankName(k2)}s`;
    case 5:
      return `Flush, ${rankName(k1)} High`;
    case 4:
      return `Straight, ${rankName(k1)} High`;
    case 3:
      return `Three of a Kind, ${rankName(k1)}s`;
    case 2:
      return `Two Pair, ${rankName(k1)}s and ${rankName(k2)}s`;
    case 1:
      return `Pair of ${rankName(k1)}s`;
    default:
      return `${rankName(k1)} High`;
  }
}

/**
 * Ace-to-five low with an "8-or-better" qualifier: returns null if no
 * qualifying low hand exists among the given cards (used by hi-lo split games).
 */
export function evaluateQualifyingLow(
  cards: Card[],
  qualifier = 8
): EvaluatedHand | null {
  const best = evaluateBestHand(cards, "low-ace-to-five");
  const [category, ...kickers] = best.score;
  if (category !== 0) return null; // any pair or better disqualifies an 8-or-better low
  const highestKicker = Math.max(...kickers);
  if (highestKicker > qualifier) return null;
  return best;
}
