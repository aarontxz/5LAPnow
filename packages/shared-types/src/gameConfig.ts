/**
 * Owner-configurable per-engine settings, layered on top of whichever
 * GameDefinition a table is currently playing (or has queued next) — never
 * mutates the GameDefinition row itself, since builtin rows like
 * "builtin-clang" are shared across every table that plays Clang. Stored on
 * `Table.gameConfigOverrides` (Prisma), keyed by engine so a table switching
 * between poker/Clang/Card Flip doesn't lose its other engines' settings.
 */
export interface PokerConfigOverride {
  smallBlind?: number;
  bigBlind?: number;
  ante?: number;
}

export interface ClangConfigOverride {
  stake?: number;
  eatPaymentPerCard?: number;
}

export interface CardFlipConfigOverride {
  stake?: number;
  cardsPerPlayer?: number;
  fourOfAKindBonus?: number;
  unopenedCardBonus?: number;
  straightFlushBonus?: number;
}

export interface TableGameConfigOverrides {
  poker?: PokerConfigOverride;
  clang?: ClangConfigOverride;
  cardflip?: CardFlipConfigOverride;
}

/** The values a table would actually play with right now (GameDefinition defaults merged with any owner override) — what the settings modal fetches to pre-fill, and what it's editing. */
export type EffectiveGameConfig =
  | ({ kind: "poker" } & Required<PokerConfigOverride>)
  | ({ kind: "clang" } & Required<ClangConfigOverride>)
  | ({ kind: "cardflip" } & Required<CardFlipConfigOverride>);

/** `table:setGameConfig` payload — a flat bag of every possible field; the server reads only the ones relevant to the table's current/queued engine and ignores the rest. */
export interface SetGameConfigPayload {
  tableId: string;
  smallBlind?: number;
  bigBlind?: number;
  ante?: number;
  stake?: number;
  eatPaymentPerCard?: number;
  cardsPerPlayer?: number;
  fourOfAKindBonus?: number;
  unopenedCardBonus?: number;
  straightFlushBonus?: number;
}
