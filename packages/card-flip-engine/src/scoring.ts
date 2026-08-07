import type { Card } from "@5lapnow/cards";

/**
 * `@5lapnow/cards`' evaluator only scores exact 5-card combinations (it picks
 * the best 5 out of however many you hand it), so it can't rank a 2- or
 * 3-card hand — but Card Flip needs that: a pair beats no pair, three of a
 * kind beats a pair, two pair beats a pair, etc., all before anyone has 5
 * cards. This is a standalone evaluator over however many cards a player
 * currently holds (1 and up), using every card they hold (not a fixed
 * 5-card subset) — straights/flushes are naturally unreachable below 5
 * cards since those categories require 5 qualifying cards by definition.
 */

const CATEGORY_NAMES = [
  "High Card",
  "Pair",
  "Two Pair",
  "Three of a Kind",
  "Straight",
  "Flush",
  "Full House",
  "Four of a Kind",
  "Straight Flush",
] as const;

const RANK_LABELS: Record<number, string> = {
  2: "2", 3: "3", 4: "4", 5: "5", 6: "6", 7: "7", 8: "8", 9: "9", 10: "10",
  11: "Jack", 12: "Queen", 13: "King", 14: "Ace",
};

export interface PartialHandScore {
  /** 0 = High Card .. 8 = Straight Flush. */
  category: number;
  /** Ranks in descending (count, rank) order, expanded once per copy — a reasonable tie-break within the same category without needing full 5-card kicker precision. */
  tiebreak: number[];
}

function hasStraight(distinctRanksDesc: number[]): boolean {
  // Ace also counts low for the wheel (A-2-3-4-5).
  const ranks = new Set(distinctRanksDesc);
  if (ranks.has(14)) ranks.add(1);
  const sorted = [...ranks].sort((a, b) => b - a);
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    if ((sorted[i - 1] as number) - (sorted[i] as number) === 1) {
      run += 1;
      if (run >= 5) return true;
    } else if (sorted[i] !== sorted[i - 1]) {
      run = 1;
    }
  }
  return false;
}

export function evaluatePartialHand(cards: Card[]): PartialHandScore {
  const rankCounts = new Map<number, number>();
  const suitCounts = new Map<string, number>();
  for (const c of cards) {
    rankCounts.set(c.rank, (rankCounts.get(c.rank) ?? 0) + 1);
    suitCounts.set(c.suit, (suitCounts.get(c.suit) ?? 0) + 1);
  }

  const groups = [...rankCounts.entries()].sort(([rankA, countA], [rankB, countB]) => countB - countA || rankB - rankA);
  const top = groups[0];
  const second = groups[1];

  const flushSuit = [...suitCounts.entries()].find(([, count]) => count >= 5)?.[0];
  const isFlush = flushSuit !== undefined;
  const isStraight = hasStraight(groups.map(([rank]) => rank));
  const isStraightFlush = isFlush && hasStraight(cards.filter((c) => c.suit === flushSuit).map((c) => c.rank));

  let category: number;
  if (isStraightFlush) category = 8;
  else if (top && top[1] >= 4) category = 7;
  else if (top && top[1] >= 3 && second && second[1] >= 2) category = 6;
  else if (isFlush) category = 5;
  else if (isStraight) category = 4;
  else if (top && top[1] === 3) category = 3;
  else if (top && top[1] === 2 && second && second[1] === 2) category = 2;
  else if (top && top[1] === 2) category = 1;
  else category = 0;

  const tiebreak = groups.flatMap(([rank, count]) => Array(count).fill(rank) as number[]);
  return { category, tiebreak };
}

/** >0 if `a` beats `b`, <0 if `b` beats `a`, 0 for an exact tie. */
export function comparePartialHands(a: PartialHandScore, b: PartialHandScore): number {
  if (a.category !== b.category) return a.category - b.category;
  const len = Math.max(a.tiebreak.length, b.tiebreak.length);
  for (let i = 0; i < len; i++) {
    const diff = (a.tiebreak[i] ?? 0) - (b.tiebreak[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Human-readable label, e.g. "Pair of Kings", "Two Pair, Aces and Fives", "High Card, Jack". */
export function describePartialHand(cards: Card[]): string {
  const { category, tiebreak } = evaluatePartialHand(cards);
  const name = (rank: number) => RANK_LABELS[rank] ?? String(rank);
  switch (category) {
    case 8:
      return "Straight Flush";
    case 7:
      return `Four of a Kind, ${name(tiebreak[0] as number)}s`;
    case 6:
      return `Full House, ${name(tiebreak[0] as number)}s full of ${name(tiebreak[3] as number)}s`;
    case 5:
      return "Flush";
    case 4:
      return "Straight";
    case 3:
      return `Three of a Kind, ${name(tiebreak[0] as number)}s`;
    case 2:
      return `Two Pair, ${name(tiebreak[0] as number)}s and ${name(tiebreak[2] as number)}s`;
    case 1:
      return `Pair of ${name(tiebreak[0] as number)}s`;
    default:
      return `High Card, ${name(tiebreak[0] as number)}`;
  }
}

export const CARD_FLIP_CATEGORY_NAMES = CATEGORY_NAMES;
