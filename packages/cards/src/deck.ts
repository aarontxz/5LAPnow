import { Card, RANKS, Suit, SUITS } from "./card.js";
import { secureRandom } from "./random.js";

export interface DeckOptions {
  /** Number of jokers to include (each represented as rank 15). */
  jokers?: number;
  /** Injectable RNG for deterministic tests; defaults to secureRandom. */
  rng?: () => number;
}

export const JOKER_RANK = 15;

export function createStandardDeck(options: DeckOptions = {}): Card[] {
  const cards: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      cards.push({ rank, suit });
    }
  }
  const jokerCount = options.jokers ?? 0;
  for (let i = 0; i < jokerCount; i++) {
    // Jokers are suitless; suit is arbitrary and ignored by evaluators.
    cards.push({ rank: JOKER_RANK as Card["rank"], suit: SUITS[i % SUITS.length] as Suit });
  }
  return cards;
}

export function shuffle<T>(items: T[], rng: () => number = secureRandom): T[] {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j] as T, result[i] as T];
  }
  return result;
}

export class Deck {
  private cards: Card[];

  constructor(options: DeckOptions = {}) {
    this.cards = shuffle(createStandardDeck(options), options.rng ?? secureRandom);
  }

  get remaining(): number {
    return this.cards.length;
  }

  draw(count = 1): Card[] {
    if (count > this.cards.length) {
      throw new Error(`Cannot draw ${count} cards, only ${this.cards.length} remain`);
    }
    return this.cards.splice(0, count);
  }

  burn(): Card | undefined {
    return this.cards.shift();
  }
}
