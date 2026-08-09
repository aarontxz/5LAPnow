import { z } from "zod";

/**
 * Data-only config for a "10 Card Flip" `GameDefinition` row — mirrors how
 * poker variants (packages/game-engine) bake their own rules into a JSON
 * blob instead of taking them as ad hoc per-round input. A table's owner
 * picks which GameDefinition to play; this is everything that definition
 * pins down for a Card Flip round.
 */
export const CardFlipGameDefinitionSchema = z.object({
  /** Max cards a player may draw on their turn before being forced to stop — the "10" in "10 Card Flip". */
  cardsPerPlayer: z.number().int().min(1).default(10),
  /** Flat amount every other player pays the round's winning leader. */
  stake: z.number().positive().default(5),
  /**
   * Extra amount each other player pays the winner per card of
   * `cardsPerPlayer` they never had to draw — rewards taking (and holding)
   * the lead without needing every allotted flip.
   */
  unopenedCardBonus: z.number().min(0).default(0),
  /** Extra amount each other player pays the winner if their final hand is a straight flush. */
  straightFlushBonus: z.number().min(0).default(0),
  /** Extra amount each other player pays the winner if their final hand is four of a kind. */
  fourOfAKindBonus: z.number().min(0).default(0),
});
export type CardFlipGameDefinition = z.infer<typeof CardFlipGameDefinitionSchema>;

export function parseCardFlipGameDefinition(input: unknown): CardFlipGameDefinition {
  return CardFlipGameDefinitionSchema.parse(input ?? {});
}

export function safeParseCardFlipGameDefinition(input: unknown): ReturnType<typeof CardFlipGameDefinitionSchema.safeParse> {
  return CardFlipGameDefinitionSchema.safeParse(input ?? {});
}
