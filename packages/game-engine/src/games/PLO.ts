import { parseGameDefinition } from "../shared/gameDefinition.js";

export const POT_LIMIT_OMAHA = parseGameDefinition({
  id: "builtin-plo",
  name: "Pot-Limit Omaha",
  description: "Four private hole cards, five shared community cards, best 5-card hand wins.",
  source: "builtin",
  deck: { jokers: 0 },
  minPlayers: 2,
  maxPlayers: 10,
  bettingStructure: "pot-limit",
  forcedBets: { ante: 0, smallBlind: 1, bigBlind: 2 },
  handRanking: { mode: "high", splitPot: "none" },
  streets: [
    { name: "preflop", dealHoleCards: 4, dealCommunityCards: 0, bettingRound: true },
    { name: "flop", dealHoleCards: 0, dealCommunityCards: 3, bettingRound: true },
    { name: "turn", dealHoleCards: 0, dealCommunityCards: 1, bettingRound: true },
    { name: "river", dealHoleCards: 0, dealCommunityCards: 1, bettingRound: true },
  ],
});
