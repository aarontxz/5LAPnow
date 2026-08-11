import { describe, expect, it } from "vitest";
import type { Card } from "@5lapnow/cards";
import { createEmptyTable, seatPlayer, TableConfig, TableState } from "@5lapnow/game-engine";
import { ClangEngine } from "./engine.js";

// Deterministic PRNG so shuffles are reproducible across test runs (same helper as packages/game-engine).
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

const config: TableConfig = { id: "table-1", smallBlind: 0, bigBlind: 0, minBuyIn: 0, maxBuyIn: 1000 };

function buildTable(playerCount: number): TableState {
  const table = createEmptyTable(config);
  for (let i = 0; i < playerCount; i++) seatPlayer(table, i, `p${i}`, `Player${i}`, 100);
  return table;
}

function card(rank: number): Card {
  return { rank: rank as Card["rank"], suit: "clubs" };
}

function totalChips(table: TableState): number {
  return table.seats.reduce((sum, s) => sum + s.stack, 0);
}

describe("ClangEngine", () => {
  it("deals 5 cards to each player and leaves the rest as the draw pile", () => {
    const table = buildTable(3);
    const engine = new ClangEngine(mulberry32(1));
    const round = engine.startRound(table, 1, 5, 2);

    expect(round.players).toHaveLength(3);
    for (const p of round.players) expect(p.hand).toHaveLength(5);
    expect(round.drawPile).toHaveLength(52 - 15);
    expect(round.discardPile).toHaveLength(0);
    expect(round.phase).toBe("instant-window");
    expect(round.turnOrder).toEqual([0, 1, 2]);
  });

  it("rejects fewer than 2 players", () => {
    const engine = new ClangEngine();
    expect(() => engine.startRoundWithDeck(buildTable(1), 1, 5, 2, [])).toThrow();
  });

  it("deals from two combined decks once there are more than 5 players", () => {
    const table = buildTable(6);
    const engine = new ClangEngine(mulberry32(3));
    const round = engine.startRound(table, 1, 5, 2);
    expect(round.players).toHaveLength(6);
    // 2 decks (104 cards) minus 30 dealt (6 players x 5 cards) = 74.
    expect(round.drawPile).toHaveLength(104 - 30);
  });

  it("settles an instant Clang: every other player pays the caller the stake", () => {
    const table = buildTable(2);
    const engine = new ClangEngine();
    const deck = [
      card(5), card(5), card(5), card(3), card(3), // seat0: 21
      card(2), card(2), card(2), card(2), card(2), // seat1: 10
    ];
    const round = engine.startRoundWithDeck(table, 1, 5, 2, deck);
    const before = totalChips(table);

    engine.callInstantClang(table, round, 0);

    expect(round.phase).toBe("complete");
    expect(round.result?.type).toBe("instant");
    expect(round.result?.winnerSeatIndices).toEqual([0]);
    expect(table.seats[0]?.stack).toBe(105);
    expect(table.seats[1]?.stack).toBe(95);
    expect(totalChips(table)).toBe(before);
  });

  it("resolves a simultaneous instant-21 race in favor of whichever call is processed first", () => {
    const table = buildTable(2);
    const engine = new ClangEngine();
    const deck = [
      card(5), card(5), card(5), card(3), card(3), // seat0: 21
      card(7), card(7), card(3), card(2), card(2), // seat1: 21
    ];
    const round = engine.startRoundWithDeck(table, 1, 5, 2, deck);

    engine.callInstantClang(table, round, 0);
    expect(() => engine.callInstantClang(table, round, 1)).toThrow();
    expect(round.result?.callerSeatIndex).toBe(0);
  });

  it("keeps a seat's instant-Clang window open until their own first turn, even after an earlier seat has already acted", () => {
    const table = buildTable(3); // turn order 0 -> 1 -> 2
    const engine = new ClangEngine();
    const deck = [
      card(4), card(4), card(4), card(4), card(4), // seat0: 20, draws first
      card(5), card(5), card(5), card(3), card(3), // seat1: 21, hasn't acted yet
      card(9), card(9), card(9), card(9), card(9), // seat2: 45
      card(6), // seat0's draw
    ];
    const round = engine.startRoundWithDeck(table, 1, 5, 2, deck);

    // Seat0 (first in turn order) takes their turn — this used to close the
    // global instant-Clang window for every other seat too.
    engine.draw(table, round, 0);
    expect(round.phase).toBe("awaiting-discard");

    // Seat1 hasn't had their own first turn yet, so they should still be able
    // to call an instant Clang on their 21.
    engine.callInstantClang(table, round, 1);

    expect(round.phase).toBe("complete");
    expect(round.result?.type).toBe("instant");
    expect(round.result?.winnerSeatIndices).toEqual([1]);
  });

  it("closes a seat's own instant-Clang window once they've taken their first turn", () => {
    const table = buildTable(2);
    const engine = new ClangEngine();
    const deck = [
      card(9), card(3), card(3), card(3), card(3), // seat0: 21 after drawing away from it, but acted already
      card(2), card(2), card(2), card(2), card(2), // seat1: 10
      card(4), // seat0's draw
    ];
    const round = engine.startRoundWithDeck(table, 1, 5, 2, deck);

    engine.draw(table, round, 0);
    expect(() => engine.callInstantClang(table, round, 0)).toThrow();
  });

  it("closes a seat's instant-Clang window once they've eaten, even before their own first turn", () => {
    const table = buildTable(2);
    const engine = new ClangEngine();
    const deck = [
      card(3), card(3), card(3), card(3), card(6), // seat0: draws, then discards all four 3s
      card(3), card(5), card(5), card(5), card(6), // seat1: eats the single 3, left holding 21
      card(9), // seat0's draw
    ];
    const round = engine.startRoundWithDeck(table, 1, 5, 2, deck);

    engine.draw(table, round, 0);
    engine.playRank(table, round, 0, 3);
    expect(round.phase).toBe("awaiting-eat");

    engine.eat(table, round, 1);

    // Seat1 never had their own first turn, but eating is itself an action —
    // their instant-Clang shot on the resulting 21 should already be gone.
    expect(() => engine.callInstantClang(table, round, 1)).toThrow();
  });

  it("rejects an instant Clang call from a hand that isn't exactly 21", () => {
    const table = buildTable(2);
    const engine = new ClangEngine();
    const deck = [
      card(2), card(2), card(2), card(2), card(2), // seat0: 10
      card(9), card(9), card(9), card(9), card(9), // seat1: 45
    ];
    const round = engine.startRoundWithDeck(table, 1, 5, 2, deck);
    expect(() => engine.callInstantClang(table, round, 0)).toThrow();
  });

  it("play with no eligible eater draws immediately and advances the turn by one", () => {
    const table = buildTable(2);
    const engine = new ClangEngine();
    const deck = [
      card(9), card(2), card(2), card(2), card(2), // seat0: has a 9
      card(4), card(4), card(4), card(4), card(4), // seat1: no 9s
      card(6), // seat0's draw
    ];
    const round = engine.startRoundWithDeck(table, 1, 5, 2, deck);

    engine.draw(table, round, 0);
    expect(round.phase).toBe("awaiting-discard");
    engine.playRank(table, round, 0, 9);

    expect(round.phase).toBe("turn");
    expect(round.turnIndex).toBe(1);
    expect(round.discardPile).toHaveLength(1);
    const p0 = round.players.find((p) => p.seatIndex === 0)!;
    expect(p0.hand).toHaveLength(5); // 4 remaining + 1 drawn
  });

  it("play into an eligible Eat: pays per-card, discarder still draws, eater's turn is skipped", () => {
    const table = buildTable(3); // turn order A(0) -> B(1) -> C(2)
    const engine = new ClangEngine();
    const deck = [
      card(9), card(2), card(2), card(2), card(2), // A: has a 9
      card(9), card(9), card(3), card(3), card(3), // B: has two 9s
      card(4), card(4), card(4), card(4), card(4), // C
      card(6), // A's draw
    ];
    const round = engine.startRoundWithDeck(table, 1, 5, 2, deck);
    const before = totalChips(table);

    engine.draw(table, round, 0);
    engine.playRank(table, round, 0, 9);
    expect(round.phase).toBe("awaiting-eat");
    expect(round.pendingEat).toEqual({ discarderSeatIndex: 0, eaterSeatIndex: 1, rank: 9, chainDepth: 0 });

    engine.eat(table, round, 1);

    expect(round.phase).toBe("turn");
    expect(round.turnIndex).toBe(2); // B (index 1) is skipped, lands on C (index 2)
    expect(round.pendingEat).toBeNull();
    expect(table.seats[0]?.stack).toBe(96); // A pays 2 * 2 cards eaten = 4
    expect(table.seats[1]?.stack).toBe(104);
    const a = round.players.find((p) => p.seatIndex === 0)!;
    expect(a.hand).toHaveLength(5); // discarded 1, drew 1
    const b = round.players.find((p) => p.seatIndex === 1)!;
    expect(b.hand).toHaveLength(3); // discarded both 9s, did not draw
    expect(totalChips(table)).toBe(before);
  });

  it("declining an available Eat still lets the decliner's own turn come up normally afterward", () => {
    const table = buildTable(2);
    const engine = new ClangEngine();
    const deck = [
      card(9), card(2), card(2), card(2), card(2), // seat0
      card(9), card(3), card(3), card(3), card(3), // seat1: eligible, will decline
      card(6), // seat0's draw
    ];
    const round = engine.startRoundWithDeck(table, 1, 5, 2, deck);

    engine.draw(table, round, 0);
    engine.playRank(table, round, 0, 9);
    expect(round.phase).toBe("awaiting-eat");

    engine.passEat(table, round, 1);

    expect(round.phase).toBe("turn");
    expect(round.turnIndex).toBe(1); // seat1's own turn, not skipped
    expect(table.seats[0]?.stack).toBe(100);
    expect(table.seats[1]?.stack).toBe(100);
  });

  it("force-ends the round in a neutral showdown when the draw pile is empty", () => {
    const table = buildTable(2);
    const engine = new ClangEngine();
    const deck = [
      card(9), card(2), card(2), card(2), card(2), // seat0: 9+2+2+2+2=17 (never gets to discard)
      card(4), card(4), card(4), card(4), card(4), // seat1: 20
    ]; // no cards left over for the draw pile
    const round = engine.startRoundWithDeck(table, 1, 5, 2, deck);
    expect(round.drawPile).toHaveLength(0);
    const before = totalChips(table);

    // Draw-first: seat0 must draw to take their turn at all, but the pile is
    // empty, so the round force-ends right here — the discard they would
    // have made never happens, and hands reveal exactly as dealt.
    engine.draw(table, round, 0);

    expect(round.phase).toBe("complete");
    expect(round.result?.type).toBe("forced");
    expect(round.result?.callerSeatIndex).toBeNull();
    expect(round.result?.winnerSeatIndices).toEqual([0]); // 8 < 20
    expect(table.seats[0]?.stack).toBe(105);
    expect(table.seats[1]?.stack).toBe(95);
    expect(totalChips(table)).toBe(before);
  });

  it("normal Call Clang: caller wins outright when they truly have the lowest hand", () => {
    const table = buildTable(3);
    const engine = new ClangEngine();
    const deck = [
      card(2), card(2), card(2), card(2), card(2), // seat0: 10 (lowest)
      card(9), card(9), card(9), card(9), card(9), // seat1: 45
      card(8), card(8), card(8), card(8), card(8), // seat2: 40
    ];
    const round = engine.startRoundWithDeck(table, 1, 5, 2, deck);

    engine.callClangNormal(table, round, 0);

    expect(round.result?.type).toBe("call");
    expect(round.result?.winnerSeatIndices).toEqual([0]);
    expect(table.seats[0]?.stack).toBe(110);
    expect(table.seats[1]?.stack).toBe(95);
    expect(table.seats[2]?.stack).toBe(95);
  });

  it("caller tied for lowest still wins outright", () => {
    const table = buildTable(2);
    const engine = new ClangEngine();
    const deck = [
      card(2), card(2), card(2), card(2), card(2), // seat0: 10
      card(2), card(2), card(2), card(2), card(2), // seat1: 10 (tie)
    ];
    const round = engine.startRoundWithDeck(table, 1, 5, 2, deck);

    engine.callClangNormal(table, round, 0);

    expect(round.result?.winnerSeatIndices).toEqual([0]);
    expect(table.seats[0]?.stack).toBe(105);
    expect(table.seats[1]?.stack).toBe(95);
  });

  it("caller not among the tied-lowest pays the full multiple, split across the tied-lowest players", () => {
    const table = buildTable(4);
    const engine = new ClangEngine();
    const deck = [
      card(9), card(9), card(9), card(9), card(9), // seat0 (caller): 45, wrong call
      card(2), card(2), card(2), card(2), card(2), // seat1: 10 (tied lowest)
      card(2), card(2), card(2), card(2), card(2), // seat2: 10 (tied lowest)
      card(8), card(8), card(8), card(8), card(8), // seat3: 40
    ];
    const round = engine.startRoundWithDeck(table, 1, 5, 2, deck);
    const before = totalChips(table);

    engine.callClangNormal(table, round, 0);

    expect(round.result?.type).toBe("call");
    expect([...round.result!.winnerSeatIndices].sort()).toEqual([1, 2]);
    const totalPaid = round.result!.payments.reduce((sum, p) => sum + p.amount, 0);
    expect(totalPaid).toBe(15); // stake(5) * (4 players - 1)
    expect(table.seats[0]?.stack).toBe(85); // caller pays the full 15
    const s1 = table.seats[1]!.stack;
    const s2 = table.seats[2]!.stack;
    expect(s1 + s2).toBe(100 + 100 + 15);
    expect(Math.abs(s1 - s2)).toBeLessThanOrEqual(1); // 15 split 2 ways: 7/8
    expect(totalChips(table)).toBe(before);
  });

  it("rejects illegal actions: out of turn, discarding an unheld rank, acting without a pending Eat", () => {
    const table = buildTable(2);
    const engine = new ClangEngine();
    const deck = [
      card(9), card(2), card(2), card(2), card(2),
      card(4), card(4), card(4), card(4), card(4),
      card(6),
    ];
    const round = engine.startRoundWithDeck(table, 1, 5, 2, deck);

    expect(() => engine.draw(table, round, 1)).toThrow(); // not seat1's turn
    expect(() => engine.playRank(table, round, 0, 9)).toThrow(); // haven't drawn yet this turn

    engine.draw(table, round, 0);
    expect(() => engine.playRank(table, round, 0, 7)).toThrow(); // seat0 holds no 7s
    expect(() => engine.eat(table, round, 1)).toThrow(); // no pending eat yet

    engine.playRank(table, round, 0, 9); // resolves immediately, no eligible eater

    expect(() => engine.callClangNormal(table, round, 0)).toThrow(); // no longer seat0's turn
    expect(() => engine.eat(table, round, 1)).toThrow(); // still no pending eat
  });
});
