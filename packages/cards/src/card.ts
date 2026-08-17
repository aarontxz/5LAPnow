export const SUITS = ["clubs", "diamonds", "hearts", "spades"] as const;
export type Suit = (typeof SUITS)[number];

// 2-14, where 11=J, 12=Q, 13=K, 14=A
export const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14] as const;
export type Rank = (typeof RANKS)[number];

export interface Card {
  rank: Rank;
  suit: Suit;
  /**
   * Which physical deck this card came from — only set when a game combines
   * multiple decks into one shuffled pile (currently just Clang, once a
   * round exceeds SECOND_DECK_THRESHOLD players — see clang-engine). Every
   * single-deck game (poker, Card Flip, small Clang rounds) leaves this
   * undefined, since rank+suit alone is already a unique identity there.
   */
  deckIndex?: number;
}

export const RANK_LABELS: Record<Rank, string> = {
  2: "2",
  3: "3",
  4: "4",
  5: "5",
  6: "6",
  7: "7",
  8: "8",
  9: "9",
  10: "10",
  11: "J",
  12: "Q",
  13: "K",
  14: "A",
};

export const SUIT_SYMBOLS: Record<Suit, string> = {
  clubs: "♣",
  diamonds: "♦",
  hearts: "♥",
  spades: "♠",
};

export function cardToString(card: Card): string {
  return `${RANK_LABELS[card.rank]}${SUIT_SYMBOLS[card.suit]}`;
}

export function cardsEqual(a: Card, b: Card): boolean {
  return a.rank === b.rank && a.suit === b.suit && a.deckIndex === b.deckIndex;
}

/** Highest rank first (Ace, King, ... 2), suit as a stable tiebreaker — for displaying a hand sorted instead of in deal order. */
export function compareCardsForDisplay(a: Card, b: Card): number {
  if (a.rank !== b.rank) return b.rank - a.rank;
  return SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit);
}
