import { z } from "zod";

/**
 * Data-only config for a Clang `GameDefinition` row — mirrors how poker
 * variants (packages/game-engine) bake their own rules into a JSON blob
 * instead of taking them as ad hoc per-round input.
 */
export const ClangGameDefinitionSchema = z.object({
  /** Flat amount every other player pays the round's winner. */
  stake: z.number().positive().default(5),
  /** Chips paid per card the eater discards when they Eat (independent of `stake`). */
  eatPaymentPerCard: z.number().min(0).default(2),
});
export type ClangGameDefinition = z.infer<typeof ClangGameDefinitionSchema>;

export function parseClangGameDefinition(input: unknown): ClangGameDefinition {
  return ClangGameDefinitionSchema.parse(input ?? {});
}

export function safeParseClangGameDefinition(input: unknown): ReturnType<typeof ClangGameDefinitionSchema.safeParse> {
  return ClangGameDefinitionSchema.safeParse(input ?? {});
}
