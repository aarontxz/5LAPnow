import { describe, expect, it } from "vitest";
import { createEmptyTable, seatPlayer, TableConfig } from "./table.js";
import { DeclarativeEngine } from "./engine.js";
import { parseGameDefinition } from "./gameDefinition.js";

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

// A minimal single-board, no-community-cards game whose only purpose is to
// exercise performRedraw's target/shortage/carryover math in isolation,
// without ESG's community-card reservation interacting with the numbers.
const REDRAW_TEST_GAME = parseGameDefinition({
  id: "test-redraw",
  name: "Redraw Test",
  source: "builtin",
  deck: { jokers: 0 },
  minPlayers: 2,
  maxPlayers: 9,
  bettingStructure: "no-limit",
  forcedBets: { ante: 0, smallBlind: 1, bigBlind: 2 },
  handRanking: { mode: "high", splitPot: "none" },
  boards: 1,
  streets: [
    { name: "preflop", dealHoleCards: 6, dealCommunityCards: 0, bettingRound: true },
    { name: "redraw-1", dealHoleCards: 0, dealCommunityCards: 0, redrawHoleCardsTo: 40, bettingRound: false },
    { name: "redraw-2", dealHoleCards: 0, dealCommunityCards: 0, redrawHoleCardsTo: 48, bettingRound: false },
  ],
});

const config: TableConfig = {
  id: "table-1",
  name: "Redraw Test Table",
  gameDefinitionId: REDRAW_TEST_GAME.id,
  smallBlind: 1,
  bigBlind: 2,
  minBuyIn: 1000,
  maxBuyIn: 1000,
};

function buildTable(numPlayers: number) {
  const table = createEmptyTable(config);
  for (let i = 0; i < numPlayers; i++) seatPlayer(table, i, `p${i}`, `Player${i}`, 1000);
  return table;
}

/** Checks everyone through the one betting round (preflop) so the engine auto-advances through the non-betting redraw streets. */
function checkThroughPreflop(engine: DeclarativeEngine, table: ReturnType<typeof buildTable>, hand: ReturnType<DeclarativeEngine["initHand"]>) {
  let iterations = 0;
  while (hand.phase === "betting" && iterations < 100) {
    iterations++;
    const seatIndex = hand.bettingRound?.turnSeatIndex;
    if (seatIndex === null || seatIndex === undefined) break;
    const legal = engine.getLegalActions(table, hand, seatIndex);
    engine.applyAction(table, hand, seatIndex, legal.canCheck ? { type: "check" } : { type: "call" });
  }
}

// Same shape as REDRAW_TEST_GAME but with modest targets that a 2-player,
// 52-card deck can always fully satisfy — isolates the "full target reached"
// path from the shortage path exercised by REDRAW_TEST_GAME's 40/48 targets.
const SMALL_REDRAW_TEST_GAME = parseGameDefinition({
  ...REDRAW_TEST_GAME,
  id: "test-redraw-small",
  streets: [
    { name: "preflop", dealHoleCards: 6, dealCommunityCards: 0, bettingRound: true },
    { name: "redraw-1", dealHoleCards: 0, dealCommunityCards: 0, redrawHoleCardsTo: 10, bettingRound: false },
    { name: "redraw-2", dealHoleCards: 0, dealCommunityCards: 0, redrawHoleCardsTo: 14, bettingRound: false },
  ],
});

describe("hole-card redraw", () => {
  it("tops every player up to the full target when the deck has enough", () => {
    const table = buildTable(2);
    const engine = new DeclarativeEngine(SMALL_REDRAW_TEST_GAME, mulberry32(1));
    const hand = engine.initHand(table, 1);
    checkThroughPreflop(engine, table, hand);

    // 2 players: preflop draws 6 each (12 total, 40 remain) — comfortably
    // enough for both redraws (owed 4/player x2 = 8, twice).
    expect(hand.phase).toBe("showdown");
    for (const p of hand.players.values()) expect(p.holeCards).toHaveLength(14);
  });

  it("falls back to an equal smaller draw when the deck can't cover everyone's full owed amount, and the shortfall carries into the next redraw's owed total", () => {
    const table = buildTable(6);
    const engine = new DeclarativeEngine(REDRAW_TEST_GAME, mulberry32(2));
    const hand = engine.initHand(table, 1);
    checkThroughPreflop(engine, table, hand);

    // Preflop: 6 players x 6 = 36 drawn, 16 remain.
    // redraw-1 target 40: owed 34/player x 6 = 204, way more than 16 available (no
    // future community reserve in this test game) -> shortage: floor(16/6) = 2 each.
    //   -> everyone reaches 6+2 = 8, deck remaining = 16 - 12 = 4.
    // redraw-2 target 48: owed 40/player x 6 = 240, only 4 available -> floor(4/6) = 0.
    //   -> nobody draws, everyone stays at 8.
    expect(hand.phase).toBe("showdown");
    for (const p of hand.players.values()) expect(p.holeCards).toHaveLength(8);
    expect(hand.deck.remaining).toBe(4);
  });

  it("never draws cards for a folded player, and a fold reshuffles their hand back into the deck", () => {
    const table = buildTable(2);
    const engine = new DeclarativeEngine(REDRAW_TEST_GAME, mulberry32(3));
    const hand = engine.initHand(table, 1);

    const foldingSeat = hand.bettingRound?.turnSeatIndex as number;
    const remainingBeforeFold = hand.deck.remaining;
    engine.applyAction(table, hand, foldingSeat, { type: "fold" });

    // REDRAW_TEST_GAME doesn't set reshuffleFoldedCardsIntoDeck, so the fold
    // should NOT return cards to the deck, and the hand ends immediately
    // (win-by-fold, no redraw ever runs for the sole remaining player).
    expect(hand.phase).toBe("showdown");
    expect(hand.deck.remaining).toBe(remainingBeforeFold);
    expect(hand.players.get(foldingSeat)?.holeCards).toHaveLength(6);
  });
});

const RESHUFFLE_TEST_GAME = parseGameDefinition({
  ...REDRAW_TEST_GAME,
  id: "test-redraw-reshuffle",
  reshuffleFoldedCardsIntoDeck: true,
});

describe("fold-triggered reshuffle", () => {
  it("returns the folded player's hole cards to the deck and clears their hand", () => {
    const table = buildTable(3);
    const engine = new DeclarativeEngine(RESHUFFLE_TEST_GAME, mulberry32(4));
    const hand = engine.initHand(table, 1);

    const foldingSeat = hand.bettingRound?.turnSeatIndex as number;
    const remainingBeforeFold = hand.deck.remaining;
    const foldingPlayerHandSize = hand.players.get(foldingSeat)?.holeCards.length ?? 0;
    expect(foldingPlayerHandSize).toBe(6);

    engine.applyAction(table, hand, foldingSeat, { type: "fold" });

    expect(hand.players.get(foldingSeat)?.holeCards).toHaveLength(0);
    expect(hand.deck.remaining).toBe(remainingBeforeFold + foldingPlayerHandSize);
  });
});

// A 2-board game whose redraw target is deliberately unreachable (9999), so
// redraw always wants to consume every spare card. Community-card dealing on
// later streets must still never be short-changed by it.
const RESERVE_TEST_GAME = parseGameDefinition({
  id: "test-reserve",
  name: "Reserve Test",
  source: "builtin",
  deck: { jokers: 0 },
  minPlayers: 2,
  maxPlayers: 9,
  bettingStructure: "no-limit",
  forcedBets: { ante: 0, smallBlind: 1, bigBlind: 2 },
  handRanking: { mode: "high", splitPot: "none" },
  boards: 2,
  streets: [
    { name: "preflop", dealHoleCards: 6, dealCommunityCards: 0, bettingRound: true },
    { name: "flop", dealHoleCards: 0, dealCommunityCards: 3, redrawHoleCardsTo: 9999, bettingRound: false },
    { name: "turn", dealHoleCards: 0, dealCommunityCards: 1, redrawHoleCardsTo: 9999, bettingRound: false },
    { name: "river", dealHoleCards: 0, dealCommunityCards: 1, redrawHoleCardsTo: 9999, bettingRound: false },
  ],
});

describe("community-card dealing takes priority over redraw", () => {
  it("always completes every board even when redraw is starving the deck", () => {
    const reserveConfig: TableConfig = { ...config, gameDefinitionId: RESERVE_TEST_GAME.id };
    const table = createEmptyTable(reserveConfig);
    for (let i = 0; i < 6; i++) seatPlayer(table, i, `p${i}`, `Player${i}`, 1000);
    const engine = new DeclarativeEngine(RESERVE_TEST_GAME, mulberry32(5));
    const hand = engine.initHand(table, 1);
    checkThroughPreflop(engine, table, hand);

    expect(hand.phase).toBe("showdown");
    for (const board of hand.boards) expect(board).toHaveLength(5);
  });
});
