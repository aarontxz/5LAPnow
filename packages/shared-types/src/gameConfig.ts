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
  /**
   * Turns the 2-7 bounty on for whatever poker game this table plays: a
   * player who wins a pot holding exactly a 2 and a 7 (suited or offsuit)
   * collects `bountyPayoutPerOpponent` from every other seat dealt into that
   * hand. It's a table option rather than a game of its own, so it can be
   * layered onto Hold'em, a bomb pot, or any other two-card variant.
   *
   * Only offered for games that deal exactly two hole cards — the combo is a
   * two-card hand, so it's unmakeable in Omaha and friends (see
   * `dealsTwoHoleCards` in @5lapnow/game-engine, and `matchesBounty`, which
   * refuses to pay a non-two-card hand regardless of this flag).
   */
  bountyEnabled?: boolean;
  /** Chips each other dealt-in seat pays the bounty winner. Only read when `bountyEnabled`. */
  bountyPayoutPerOpponent?: number;
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
  | ({
      kind: "poker";
      /**
       * Whether this table's poker game can offer the 2-7 bounty at all —
       * false for anything not dealing exactly two hole cards (Omaha, ESG).
       * The settings UI hides the toggle when false rather than letting an
       * owner switch on a bounty that could never be collected.
       */
      bountyAvailable: boolean;
    } & Required<PokerConfigOverride>)
  | ({ kind: "clang" } & Required<ClangConfigOverride>)
  | ({ kind: "cardflip" } & Required<CardFlipConfigOverride>);

/** `table:setGameConfig` payload — a flat bag of every possible field; the server reads only the ones relevant to the table's current/queued engine and ignores the rest. */
export interface SetGameConfigPayload {
  tableId: string;
  smallBlind?: number;
  bigBlind?: number;
  ante?: number;
  bountyEnabled?: boolean;
  bountyPayoutPerOpponent?: number;
  stake?: number;
  eatPaymentPerCard?: number;
  cardsPerPlayer?: number;
  fourOfAKindBonus?: number;
  unopenedCardBonus?: number;
  straightFlushBonus?: number;
}
