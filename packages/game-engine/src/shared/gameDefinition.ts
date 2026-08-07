import { z } from "zod";

/**
 * A single "street" in a hand: an optional deal step followed by an optional
 * betting round. Every poker variant this engine can run — hardcoded or
 * AI-generated — is expressed purely as an ordered list of these, plus a
 * handful of global rules (betting structure, forced bets, hand ranking).
 * There is no per-variant code: `DeclarativeEngine` walks this list for
 * every game equally.
 */
export const StreetSchema = z.object({
  name: z.string().min(1),
  /** Hole (private) cards dealt to each active player at this street. */
  dealHoleCards: z.number().int().min(0).default(0),
  /** Community cards revealed at this street. */
  dealCommunityCards: z.number().int().min(0).default(0),
  /** Whether a betting round happens after dealing this street. */
  bettingRound: z.boolean().default(true),
});
export type Street = z.infer<typeof StreetSchema>;

export const ForcedBetsSchema = z.object({
  ante: z.number().min(0).default(0),
  smallBlind: z.number().min(0).default(0),
  bigBlind: z.number().min(0).default(0),
});
export type ForcedBets = z.infer<typeof ForcedBetsSchema>;

export const HandRankingSchema = z.object({
  mode: z.enum(["high", "low-ace-to-five", "low-deuce-to-seven"]),
  /** Hi-lo split games award half the pot to the best qualifying low hand. */
  splitPot: z.enum(["none", "hi-lo-8-or-better"]).default("none"),
  /**
   * If set, a showdown hand must use exactly this many hole cards plus the
   * rest from the community cards (Omaha-style). If omitted, any
   * combination of hole + community cards may be used (Hold'em-style).
   */
  exactHoleCardsUsed: z.number().int().min(0).optional(),
});
export type HandRanking = z.infer<typeof HandRankingSchema>;

export const GameDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(""),
  source: z.enum(["builtin", "ai_generated"]),
  deck: z.object({ jokers: z.number().int().min(0).max(4).default(0) }).default({ jokers: 0 }),
  minPlayers: z.number().int().min(2).default(2),
  maxPlayers: z.number().int().min(2).max(10).default(9),
  streets: z.array(StreetSchema).min(1),
  bettingStructure: z.enum(["no-limit", "pot-limit", "fixed-limit"]),
  forcedBets: ForcedBetsSchema,
  handRanking: HandRankingSchema,
  /** Number of simultaneous community boards; pot is split equally among board winners. */
  boards: z.number().int().min(1).max(4).default(1),
});
export type GameDefinition = z.infer<typeof GameDefinitionSchema>;

export function parseGameDefinition(input: unknown): GameDefinition {
  return GameDefinitionSchema.parse(input);
}

export function safeParseGameDefinition(input: unknown): ReturnType<typeof GameDefinitionSchema.safeParse> {
  return GameDefinitionSchema.safeParse(input);
}
