import { evaluateBestHand, type Card } from "@5lapnow/cards";

/** Ace = 1, 2-10 = face value, J/Q/K = 10. */
export function cardPointValue(card: Card): number {
  if (card.rank === 14) return 1;
  if (card.rank >= 11) return 10;
  return card.rank;
}

export function handValue(hand: Card[]): number {
  return hand.reduce((sum, c) => sum + cardPointValue(c), 0);
}

/** Standard poker hand categories, used only for starting-hand bounty detection (not scoring/settlement). */
export type ClangHandCategory =
  | "highCard"
  | "pair"
  | "twoPair"
  | "threeOfAKind"
  | "straight"
  | "flush"
  | "fullHouse"
  | "fourOfAKind"
  | "straightFlush";

// Index matches @5lapnow/cards' HandScore category (0=high card .. 8=straight flush).
const CATEGORY_NAMES: readonly ClangHandCategory[] = [
  "highCard",
  "pair",
  "twoPair",
  "threeOfAKind",
  "straight",
  "flush",
  "fullHouse",
  "fourOfAKind",
  "straightFlush",
];

/** Classifies a 5-card hand by standard poker hand category — reuses the same evaluator poker hand-ranking uses. */
export function classifyHand(hand: Card[]): ClangHandCategory {
  const evaluated = evaluateBestHand(hand, "high");
  return CATEGORY_NAMES[evaluated.score[0]] as ClangHandCategory;
}

/**
 * Bounty payout per starting-hand category, paid by every other player to
 * whoever is dealt it in their initial 5 cards. Plain JSON-serializable
 * config (e.g. `{ "fourOfAKind": 20, "straightFlush": 50 }`) — omit a
 * category, or set it to 0, for "no bounty" on that hand.
 */
export type ClangBonusPayouts = Partial<Record<ClangHandCategory, number>>;

export const DEFAULT_BONUS_PAYOUTS: ClangBonusPayouts = {
  fourOfAKind: 20,
  straightFlush: 50,
};
