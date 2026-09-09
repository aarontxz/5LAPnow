import { describe, expect, it } from "vitest";
import { Card } from "@5lapnow/cards";
import { createEmptyTable, seatPlayer, TableConfig } from "./table.js";
import { settleShowdown } from "./pots.js";
import { HandPlayerState, HandState } from "./handState.js";
import { NO_LIMIT_TEXAS_HOLDEM } from "../games/NLH.js";
import { POT_LIMIT_OMAHA } from "../games/PLO.js";
import { GameDefinition } from "./gameDefinition.js";

// The bounty is a table option, not a game of its own (see PokerConfigOverride
// .bountyEnabled) — the server layers it onto whatever poker variant a table
// is playing, which is exactly what these two do by hand.
const BOUNTY_HOLDEM: GameDefinition = { ...NO_LIMIT_TEXAS_HOLDEM, bounty: { ranks: [2, 7], payoutPerOpponent: 2 } };
const BOUNTY_OMAHA: GameDefinition = { ...POT_LIMIT_OMAHA, bounty: { ranks: [2, 7], payoutPerOpponent: 2 } };

const config: TableConfig = {
  id: "table-bounty",
  name: "Bounty Table",
  gameDefinitionId: BOUNTY_HOLDEM.id,
  smallBlind: 1,
  bigBlind: 2,
  minBuyIn: 100,
  maxBuyIn: 100,
};

function buildThreeHandedTable() {
  const table = createEmptyTable(config);
  seatPlayer(table, 0, "p1", "Alice", 100);
  seatPlayer(table, 1, "p2", "Bob", 100);
  seatPlayer(table, 2, "p3", "Carol", 100);
  return table;
}

function handPlayer(seatIndex: number, holeCards: Card[], folded: boolean, totalContributed: number): HandPlayerState {
  return {
    seatIndex,
    holeCards,
    folded,
    allIn: false,
    totalContributed,
    committedThisStreet: 0,
    hasActedThisRound: false,
    shown: false,
    foldedHoleCards: null,
  };
}

// settleShowdown only reads gameDefinition/players/board/boards — the rest of
// HandState is irrelevant to pot/bounty settlement, so this stubs it out
// rather than running a full dealt hand through the engine.
function buildHandState(players: HandPlayerState[], gameDefinition: GameDefinition = BOUNTY_HOLDEM): HandState {
  return {
    gameDefinition,
    handNumber: 1,
    buttonSeatIndex: 0,
    streetIndex: 3,
    board: [],
    boards: [[]],
    rabbitBoard: null,
    rabbitBoards: null,
    rabbitRevealedSeats: new Set(),
    deck: { peekRemaining: () => [] } as unknown as HandState["deck"],
    players: new Map(players.map((p) => [p.seatIndex, p])),
    seatOrder: players.map((p) => p.seatIndex),
    bettingRound: null,
    phase: "showdown",
    results: null,
    actions: [],
  };
}

const twoClubs: Card = { rank: 2, suit: "clubs" };
const aceSpades: Card = { rank: 14, suit: "spades" };
const threeHearts: Card = { rank: 3, suit: "hearts" };
const sevenDiamonds: Card = { rank: 7, suit: "diamonds" };
const sevenClubs: Card = { rank: 7, suit: "clubs" };
const kingSpades: Card = { rank: 13, suit: "spades" };
const queenHearts: Card = { rank: 12, suit: "hearts" };

describe("2-7 bounty", () => {
  it("pays the bounty from every other dealt-in seat when the winner holds 2-7 offsuit", () => {
    const table = buildThreeHandedTable();
    table.seats[0]!.stack = 98;
    table.seats[1]!.stack = 98;
    table.seats[2]!.stack = 98;
    const hand = buildHandState([
      handPlayer(0, [twoClubs, sevenDiamonds], false, 2),
      handPlayer(1, [kingSpades, queenHearts], true, 2),
      handPlayer(2, [kingSpades, queenHearts], true, 2),
    ]);

    const result = settleShowdown(table, hand);

    expect(result.bounty).toEqual({ seatIndex: 0, amount: 4, description: "2-7 bounty" });
    expect(table.seats[0]!.stack).toBe(104 + 4); // 98 + 6-chip pot + 4-chip bounty
    expect(table.seats[1]!.stack).toBe(96);
    expect(table.seats[2]!.stack).toBe(96);
    // Chip-conservation: nothing created or destroyed by the bounty side-payment.
    const totalChips = table.seats.reduce((sum, s) => sum + s.stack, 0);
    expect(totalChips).toBe(300);
  });

  it("pays a suited 2-7 exactly as it pays an offsuit one", () => {
    const table = buildThreeHandedTable();
    const hand = buildHandState([
      handPlayer(0, [twoClubs, sevenClubs], false, 2),
      handPlayer(1, [kingSpades, queenHearts], true, 2),
      handPlayer(2, [kingSpades, queenHearts], true, 2),
    ]);

    const result = settleShowdown(table, hand);

    expect(result.bounty).toEqual({ seatIndex: 0, amount: 4, description: "2-7 bounty" });
  });

  // The combo is a two-card hand: holding a 2 and a 7 among four Omaha cards
  // is not "having 2-7", so a bounty left switched on across a game change
  // must never pay out there.
  it("does not pay a four-card hand that merely contains a 2 and a 7", () => {
    const table = buildThreeHandedTable();
    const hand = buildHandState(
      [
        handPlayer(0, [twoClubs, sevenDiamonds, aceSpades, threeHearts], false, 2),
        handPlayer(1, [kingSpades, queenHearts, aceSpades, threeHearts], true, 2),
        handPlayer(2, [kingSpades, queenHearts, aceSpades, threeHearts], true, 2),
      ],
      BOUNTY_OMAHA
    );

    const result = settleShowdown(table, hand);

    expect(result.bounty).toBeNull();
    expect(table.seats[1]!.stack).toBe(100); // nobody was charged
    expect(table.seats[2]!.stack).toBe(100);
  });

  it("does not pay when the winner doesn't hold 2-7 at all", () => {
    const table = buildThreeHandedTable();
    const hand = buildHandState([
      handPlayer(0, [kingSpades, queenHearts], false, 2),
      handPlayer(1, [twoClubs, sevenDiamonds], true, 2),
      handPlayer(2, [kingSpades, queenHearts], true, 2),
    ]);

    const result = settleShowdown(table, hand);

    expect(result.bounty).toBeNull();
  });

  it("caps each payer's contribution at their remaining stack instead of going negative", () => {
    const table = buildThreeHandedTable();
    table.seats[1]!.stack = 1; // can only afford 1 of the 2-chip bounty
    const hand = buildHandState([
      handPlayer(0, [twoClubs, sevenDiamonds], false, 2),
      handPlayer(1, [kingSpades, queenHearts], true, 2),
      handPlayer(2, [kingSpades, queenHearts], true, 2),
    ]);

    const result = settleShowdown(table, hand);

    expect(table.seats[1]!.stack).toBe(0);
    expect(result.bounty?.amount).toBe(3); // 1 (capped) + 2 (full) instead of 4
  });
});
