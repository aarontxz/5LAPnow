import { parseGameDefinition } from "../shared/gameDefinition.js";

export const ESG = parseGameDefinition({
  id: "builtin-esg",
  name: "ESG",
  description:
    "Everyone starts with 6 hole cards, 2 boards run simultaneously. After each street, hole cards redraw toward a growing target (9/12/15) as the deck allows. Showdown is a 3-point race: best hand on board 1, best hand on board 2 (both true Omaha, exactly 2 hole cards), and best 5-card hand from hole cards alone. Highest total points takes the whole pot.",
  source: "builtin",
  deck: { jokers: 0 },
  minPlayers: 2,
  maxPlayers: 6,
  bettingStructure: "pot-limit",
  forcedBets: { ante: 0, smallBlind: 1, bigBlind: 2 },
  handRanking: {
    mode: "high",
    splitPot: "none",
    exactHoleCardsUsed: 2,
    scoring: "point-race",
    includeHandOnlyCategory: true,
  },
  boards: 2,
  reshuffleFoldedCardsIntoDeck: true,
  streets: [
    { name: "preflop", dealHoleCards: 6, dealCommunityCards: 0, bettingRound: true },
    { name: "flop", dealHoleCards: 0, dealCommunityCards: 3, redrawHoleCardsTo: 9, bettingRound: true },
    { name: "turn", dealHoleCards: 0, dealCommunityCards: 1, redrawHoleCardsTo: 12, bettingRound: true },
    { name: "river", dealHoleCards: 0, dealCommunityCards: 1, redrawHoleCardsTo: 15, bettingRound: true },
  ],
});
