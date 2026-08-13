import { describe, expect, it } from "vitest";
import { Card } from "./card.js";
import {
  compareEvaluatedHands,
  evaluateBestHand,
  evaluateBestHandExact,
  evaluateQualifyingLow,
} from "./handEvaluator.js";

function c(spec: string): Card {
  // spec like "As", "Td", "9h", "2c"
  const rankChar = spec.slice(0, -1);
  const suitChar = spec.slice(-1);
  const rankMap: Record<string, number> = {
    A: 14,
    K: 13,
    Q: 12,
    J: 11,
    T: 10,
    "9": 9,
    "8": 8,
    "7": 7,
    "6": 6,
    "5": 5,
    "4": 4,
    "3": 3,
    "2": 2,
  };
  const suitMap: Record<string, Card["suit"]> = {
    s: "spades",
    h: "hearts",
    d: "diamonds",
    c: "clubs",
  };
  return { rank: rankMap[rankChar] as Card["rank"], suit: suitMap[suitChar] as Card["suit"] };
}

function cards(specs: string): Card[] {
  return specs.split(" ").map(c);
}

describe("evaluateBestHand (high)", () => {
  it("picks the best 5-card hand out of 7", () => {
    const hand = cards("As Ks Qs Js Ts 2c 3d"); // royal flush possible
    const result = evaluateBestHand(hand, "high");
    expect(result.score[0]).toBe(8); // straight flush (royal)
  });

  it("ranks categories correctly: quads beats full house", () => {
    const quads = evaluateBestHand(cards("9s 9h 9d 9c 2c"), "high");
    const fullHouse = evaluateBestHand(cards("8s 8h 8d Kc Kh"), "high");
    expect(compareEvaluatedHands(quads, fullHouse, "high")).toBeGreaterThan(0);
  });

  it("detects the wheel (A-2-3-4-5) as a 5-high straight", () => {
    const wheel = evaluateBestHand(cards("As 2h 3d 4c 5s"), "high");
    expect(wheel.score).toEqual([4, 5, 0, 0, 0, 0]);
  });

  it("breaks ties on kickers", () => {
    const hi = evaluateBestHand(cards("Ah Kh 9d 7c 4s"), "high");
    const lo = evaluateBestHand(cards("Ah Kh 9d 7c 3s"), "high");
    expect(compareEvaluatedHands(hi, lo, "high")).toBeGreaterThan(0);
  });
});

describe("evaluateBestHand (low-ace-to-five)", () => {
  it("treats the wheel as the best possible low hand", () => {
    const wheel = evaluateBestHand(cards("As 2h 3d 4c 5s"), "low-ace-to-five");
    const sevenLow = evaluateBestHand(cards("2s 3h 4d 5c 7s"), "low-ace-to-five");
    expect(compareEvaluatedHands(wheel, sevenLow, "low-ace-to-five")).toBeGreaterThan(0);
  });

  it("penalizes pairs", () => {
    const pairLow = evaluateBestHand(cards("2s 2h 3d 4c 5s"), "low-ace-to-five");
    const noPairLow = evaluateBestHand(cards("6s 3h 4d 7c 5s"), "low-ace-to-five");
    expect(compareEvaluatedHands(pairLow, noPairLow, "low-ace-to-five")).toBeLessThan(0);
  });
});

describe("evaluateBestHand (low-deuce-to-seven)", () => {
  it("treats ace as high only, so A-2-3-4-5 is not a straight", () => {
    const acePlusLow = evaluateBestHand(cards("As 2h 3d 4c 6s"), "low-deuce-to-seven");
    expect(acePlusLow.score[0]).not.toBe(4);
  });

  it("penalizes straights and flushes as bad for low", () => {
    const straight = evaluateBestHand(cards("7s 6h 5d 4c 3s"), "low-deuce-to-seven");
    const nonStraight = evaluateBestHand(cards("7s 6h 5d 4c 2s"), "low-deuce-to-seven");
    expect(compareEvaluatedHands(straight, nonStraight, "low-deuce-to-seven")).toBeLessThan(0);
  });
});

describe("evaluateBestHandExact (true Omaha: exactly N hole cards)", () => {
  it("excludes hands that would need fewer than N hole cards, unlike evaluateBestHand", () => {
    // Board has 4 spades; hand holds exactly 1 spade (As) plus 3 off-suit cards.
    // Combined best-5 finds an ace-high flush using just 1 hole card — illegal in Omaha.
    const hole = cards("As 7h 8c 9d");
    const board = cards("Ks Qs Js 2s 3d");

    const combined = evaluateBestHand([...hole, ...board], "high");
    expect(combined.score[0]).toBe(5); // flush, using only "As" from the hand

    const exact = evaluateBestHandExact(hole, board, 2, "high");
    expect(exact.score[0]).toBe(0); // no pairs across hole/board ranks: forced down to high card
  });

  it("finds the best legal combination, not just any", () => {
    // Board is a club royal flush by itself; hand holds a pair of aces plus off cards.
    // With exactly 2 hole cards required, the best legal hand is trip aces (using the
    // board's ace of clubs), not the board's untouchable royal flush.
    const hole = cards("Ah Ad 2c 3d");
    const board = cards("Ac Kc Qc Jc Tc");

    const exact = evaluateBestHandExact(hole, board, 2, "high");
    expect(exact.score[0]).toBe(3); // three of a kind (aces)
  });

  it("throws if there aren't enough hole or community cards", () => {
    expect(() => evaluateBestHandExact(cards("As Kh"), cards("Qs Js Ts 2c 3d"), 3, "high")).toThrow();
    expect(() => evaluateBestHandExact(cards("As Kh 2c"), cards("Qs Js"), 2, "high")).toThrow();
  });
});

describe("evaluateQualifyingLow", () => {
  it("returns null when no 8-or-better low exists", () => {
    const result = evaluateQualifyingLow(cards("As Ks Qh Jd 9c 8s 7h"), 8);
    expect(result).toBeNull();
  });

  it("returns the low hand when it qualifies", () => {
    const result = evaluateQualifyingLow(cards("As 2s 3h 4d 6c Ks Qh"), 8);
    expect(result).not.toBeNull();
  });
});
