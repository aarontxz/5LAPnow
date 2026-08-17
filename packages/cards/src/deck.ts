import { Card, RANKS, Suit, SUITS } from "./card.js";
import { secureRandom } from "./random.js";

export interface DeckOptions {
  /** Number of jokers to include (each represented as rank 15). */
  jokers?: number;
  /** Injectable RNG for deterministic tests; defaults to secureRandom. */
  rng?: () => number;
  /** Tags every card built by this call with `Card.deckIndex` — set only by a caller combining multiple decks into one shuffled pile (see ClangEngine.startRound), so otherwise-identical cards (same rank+suit) from different decks can still be told apart. Omit for every ordinary single-deck game. */
  deckIndex?: number;
}

export const JOKER_RANK = 15;

export function createStandardDeck(options: DeckOptions = {}): Card[] {
  const cards: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      cards.push(options.deckIndex !== undefined ? { rank, suit, deckIndex: options.deckIndex } : { rank, suit });
    }
  }
  const jokerCount = options.jokers ?? 0;
  for (let i = 0; i < jokerCount; i++) {
    // Jokers are suitless; suit is arbitrary and ignored by evaluators.
    const joker = { rank: JOKER_RANK as Card["rank"], suit: SUITS[i % SUITS.length] as Suit };
    cards.push(options.deckIndex !== undefined ? { ...joker, deckIndex: options.deckIndex } : joker);
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
  private readonly rng: () => number;

  constructor(options: DeckOptions = {}) {
    this.rng = options.rng ?? secureRandom;
    this.cards = shuffle(createStandardDeck(options), this.rng);
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

  /** Returns cards to the deck (e.g. a folded player's hole cards) and reshuffles. */
  returnAndShuffle(cards: Card[]): void {
    this.cards = shuffle([...this.cards, ...cards], this.rng);
  }

  /** Non-mutating snapshot of what's left, in order — for persisting a completed hand's leftover deck (e.g. for rabbit hunting later). */
  peekRemaining(): Card[] {
    return [...this.cards];
  }
}
