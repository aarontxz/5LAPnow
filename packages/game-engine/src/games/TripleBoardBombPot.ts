import { parseGameDefinition } from "../shared/gameDefinition.js";

export const TRIPLE_BOARD_BOMB_POT = parseGameDefinition({
  id: "builtin-tbbp",
  name: "Triple Board Bomb Pot",
  description:
    "Everyone posts a $3 ante; no preflop betting. Three community boards run simultaneously — each gets its own flop, turn, and river. The pot splits three ways between the best hand on each board.",
  source: "builtin",
  deck: { jokers: 0 },
  minPlayers: 2,
  maxPlayers: 9,
  bettingStructure: "no-limit",
  forcedBets: { ante: 3, smallBlind: 0, bigBlind: 0 },
  handRanking: { mode: "high", splitPot: "none" },
  boards: 3,
  streets: [
    { name: "preflop", dealHoleCards: 2, dealCommunityCards: 0, bettingRound: false },
    { name: "flop", dealHoleCards: 0, dealCommunityCards: 3, bettingRound: true },
    { name: "turn", dealHoleCards: 0, dealCommunityCards: 1, bettingRound: true },
    { name: "river", dealHoleCards: 0, dealCommunityCards: 1, bettingRound: true },
  ],
});
