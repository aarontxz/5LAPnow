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
  /**
   * If set, every active (non-folded) player's hole cards are topped up
   * toward this absolute count after this street's community cards are
   * dealt (deck permitting) and before the betting round. Used by draw-style
   * variants; omitted streets don't redraw.
   */
  redrawHoleCardsTo: z.number().int().min(0).optional(),
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
   * Consulted for every board category, under both `scoring: "best-hand"`
   * and `"point-race"`, and for both sides of a `"hi-lo-8-or-better"` split —
   * the hand-only category (`includeHandOnlyCategory`) always picks freely
   * from hole cards alone.
   */
  exactHoleCardsUsed: z.number().int().min(0).optional(),
  /**
   * "best-hand" (default): each pot is split among the board(s)' best-hand
   * winners (see `boards` below). "point-race": each board is worth 1 point
   * (tied board winners split that point), plus 1 more point for the
   * hand-only category if `includeHandOnlyCategory` is set; whoever has the
   * highest total points takes the *entire* pot (ties split the pot evenly).
   */
  scoring: z.enum(["best-hand", "point-race"]).default("best-hand"),
  /** Only meaningful under `scoring: "point-race"`: adds a category worth 1 point for the best 5-card hand using hole cards alone (no board). */
  includeHandOnlyCategory: z.boolean().default(false),
}).refine((v) => v.scoring !== "point-race" || v.splitPot === "none", {
  message: "handRanking.splitPot must be \"none\" when scoring is \"point-race\"",
  path: ["splitPot"],
});
export type HandRanking = z.infer<typeof HandRankingSchema>;

/**
 * A per-hand bonus side-payment, independent of normal pot winnings: if a
 * player wins a pot while holding exactly these two hole-card ranks (e.g.
 * 2 and 7 for a "2-7 bounty" game), every other player dealt into that hand
 * pays them `payoutPerOpponent` chips directly, on top of whatever they won
 * from the pot itself. Suits are irrelevant — a suited 2-7 qualifies just as
 * an offsuit one does.
 *
 * This is a *two-card* combo by construction, so it can only ever be made in
 * a game that deals exactly two hole cards: a four-card hand (Omaha) holding
 * a 2 and a 7 alongside two other cards does NOT qualify. `matchesBounty` in
 * pots.ts enforces that at settlement, and `dealsTwoHoleCards` below is what
 * callers use to decide whether offering a bounty for a game makes sense at
 * all.
 */
export const BountySchema = z.object({
  ranks: z.tuple([z.number().int().min(2).max(14), z.number().int().min(2).max(14)]),
  payoutPerOpponent: z.number().min(0),
});
export type Bounty = z.infer<typeof BountySchema>;

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
  /** If true, a folded player's hole cards are immediately returned to the deck and reshuffled in. */
  reshuffleFoldedCardsIntoDeck: z.boolean().default(false),
  /** Optional bonus side-payment for winning a pot with a specific two-card hole-card combo (e.g. 2-7). Usually set per-table rather than per-game — see PokerConfigOverride.bountyEnabled in @5lapnow/shared-types. */
  bounty: BountySchema.optional(),
});
export type GameDefinition = z.infer<typeof GameDefinitionSchema>;

/**
 * The most hole cards any one player can hold at once during a hand: the sum
 * of every street's `dealHoleCards`, raised to any street's `redrawHoleCardsTo`
 * (which tops a hand up *toward* an absolute count rather than adding to it).
 */
export function maxHoleCards(def: GameDefinition): number {
  let count = 0;
  for (const street of def.streets) {
    count += street.dealHoleCards;
    if (street.redrawHoleCardsTo !== undefined) count = Math.max(count, street.redrawHoleCardsTo);
  }
  return count;
}

/** Whether a two-card combo (i.e. a `bounty`) is even makeable in this game — see BountySchema. */
export function dealsTwoHoleCards(def: GameDefinition): boolean {
  return maxHoleCards(def) === 2;
}

export function parseGameDefinition(input: unknown): GameDefinition {
  return GameDefinitionSchema.parse(input);
}

export function safeParseGameDefinition(input: unknown): ReturnType<typeof GameDefinitionSchema.safeParse> {
  return GameDefinitionSchema.safeParse(input);
}
