import { describe, expect, it } from "vitest";
import { Deck } from "./deck.js";

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("Deck.returnAndShuffle", () => {
  it("increases remaining count by exactly the returned cards", () => {
    const deck = new Deck({ rng: mulberry32(1) });
    const drawn = deck.draw(6);
    expect(deck.remaining).toBe(46);
    deck.returnAndShuffle(drawn);
    expect(deck.remaining).toBe(52);
  });

  it("returned cards are re-drawable and the deck stays free of duplicates", () => {
    const deck = new Deck({ rng: mulberry32(2) });
    const drawn = deck.draw(10);
    deck.returnAndShuffle(drawn.slice(0, 4));
    const rest = deck.draw(deck.remaining);
    const all = [...rest];
    const seen = new Set(all.map((c) => `${c.rank}-${c.suit}`));
    expect(seen.size).toBe(all.length); // no duplicates
    expect(all.length).toBe(46); // 52 - 10 + 4
  });

  it("returning the entire drawn deck reconstitutes exactly 52 unique cards", () => {
    const deck = new Deck({ rng: mulberry32(3) });
    const everything = deck.draw(52);
    expect(deck.remaining).toBe(0);
    deck.returnAndShuffle(everything);
    expect(deck.remaining).toBe(52);
    const redrawn = deck.draw(52);
    const seen = new Set(redrawn.map((c) => `${c.rank}-${c.suit}`));
    expect(seen.size).toBe(52);
  });
});
