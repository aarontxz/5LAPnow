import { describe, expect, it } from "vitest";
import { createEmptyTable, seatPlayer, TableConfig } from "./table.js";
import { DeclarativeEngine } from "./engine.js";
import { NO_LIMIT_TEXAS_HOLDEM } from "../games/NLH.js";
import { activeHandPlayers } from "./handState.js";

// Deterministic PRNG so shuffles are reproducible across test runs.
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

const config: TableConfig = {
  id: "table-1",
  name: "Test Table",
  gameDefinitionId: NO_LIMIT_TEXAS_HOLDEM.id,
  smallBlind: 1,
  bigBlind: 2,
  minBuyIn: 100,
  maxBuyIn: 200,
};

function buildThreeHandedTable() {
  const table = createEmptyTable(config);
  seatPlayer(table, 0, "p1", "Alice", 100);
  seatPlayer(table, 1, "p2", "Bob", 100);
  seatPlayer(table, 2, "p3", "Carol", 100);
  return table;
}

describe("DeclarativeEngine (No-Limit Hold'em)", () => {
  it("deals hole cards, posts blinds, and gives BB the option", () => {
    const table = buildThreeHandedTable();
    const engine = new DeclarativeEngine(NO_LIMIT_TEXAS_HOLDEM, mulberry32(42));
    const hand = engine.initHand(table, 1);

    for (const p of hand.players.values()) {
      expect(p.holeCards).toHaveLength(2);
    }
    // Total chips (stacks + committed) must always equal the buy-ins.
    const totalChips = table.seats.reduce((sum, s) => sum + s.stack, 0) + [...hand.players.values()].reduce((s, p) => s + p.totalContributed, 0);
    expect(totalChips).toBe(300);
    expect(hand.bettingRound?.currentBet).toBe(2);
  });

  it("plays a full hand to showdown when everyone checks/calls", () => {
    const table = buildThreeHandedTable();
    const engine = new DeclarativeEngine(NO_LIMIT_TEXAS_HOLDEM, mulberry32(7));
    const hand = engine.initHand(table, 1);

    let iterations = 0;
    while (hand.phase === "betting" && iterations < 100) {
      iterations++;
      const seatIndex = hand.bettingRound?.turnSeatIndex;
      if (seatIndex === null || seatIndex === undefined) break;
      const legal = engine.getLegalActions(table, hand, seatIndex);
      if (legal.canCheck) {
        engine.applyAction(table, hand, seatIndex, { type: "check" });
      } else if (legal.canCall) {
        engine.applyAction(table, hand, seatIndex, { type: "call" });
      } else {
        throw new Error("Expected to be able to check or call");
      }
    }

    expect(hand.phase).toBe("showdown");
    expect(hand.board).toHaveLength(5);

    const result = engine.evaluateShowdown(table, hand);
    expect(hand.phase).toBe("complete");
    const totalAwarded = result.pots.reduce((sum, p) => sum + p.amount, 0);
    expect(totalAwarded).toBe(6); // 3 players x 2 (big blind) with no raises

    const finalChips = table.seats.reduce((sum, s) => sum + s.stack, 0);
    expect(finalChips).toBe(300); // chip-conservation across the whole hand
  });

  it("awards the pot to the last player standing when everyone else folds", () => {
    const table = buildThreeHandedTable();
    const engine = new DeclarativeEngine(NO_LIMIT_TEXAS_HOLDEM, mulberry32(99));
    const hand = engine.initHand(table, 1);

    let iterations = 0;
    while (hand.phase === "betting" && iterations < 100) {
      iterations++;
      const seatIndex = hand.bettingRound?.turnSeatIndex;
      if (seatIndex === null || seatIndex === undefined) break;
      engine.applyAction(table, hand, seatIndex, { type: "fold" });
      if (activeHandPlayers(hand).length <= 1) break;
    }

    expect(hand.phase).toBe("showdown");
    const result = engine.evaluateShowdown(table, hand);
    // Every pot "level" (e.g. a forfeited blind vs. the rest) should go to the
    // same single remaining player, since everyone else folded.
    const winningSeats = new Set(result.pots.flatMap((p) => p.hiWinners.map((w) => w.seatIndex)));
    expect(winningSeats.size).toBe(1);
    const totalAwarded = result.pots.reduce((sum, p) => sum + p.amount, 0);
    expect(totalAwarded).toBe(3); // 1 (forfeited SB) + 2 (BB's own contribution)

    const finalChips = table.seats.reduce((sum, s) => sum + s.stack, 0);
    expect(finalChips).toBe(300);
  });
});
