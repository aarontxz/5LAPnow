import type { CardFlipRoundView, ClangRoundView, HandView } from "./dto.js";

/**
 * One step in a hand/round replay's forward/backward timeline. `actionIndex`
 * is -1 for the initial pre-deal state, otherwise the index into the hand's
 * `actions` log that was just applied to produce this step. Each view is
 * shaped exactly like its live counterpart so the same components used
 * during live play can render it unchanged.
 */
export interface PokerReplayStep {
  actionIndex: number;
  description: string;
  hand: HandView;
}

export interface ClangReplayStep {
  actionIndex: number;
  description: string;
  round: ClangRoundView;
}

export interface CardFlipReplayStep {
  actionIndex: number;
  description: string;
  round: CardFlipRoundView;
}

/** Per-seat identity for a replay — stable across every step, so it's returned once alongside the steps rather than repeated in each one. */
export interface ReplaySeatIdentity {
  seatIndex: number;
  userId: string | null;
  displayName: string | null;
  stackBefore: number | null;
  stackAfter: number | null;
}

export interface HandReplayResponse {
  handNumber: number;
  gameName: string;
  players: ReplaySeatIdentity[];
  steps: PokerReplayStep[];
  /** The nearest earlier/later POKER hand at this table, for hand-to-hand navigation — not just handNumber ± 1, since hand/round numbers share one sequence across every engine at a table (a table can interleave poker hands with Clang/Card Flip rounds), so the adjacent number might not be a poker hand at all. Null when there isn't one. */
  previousHandNumber: number | null;
  nextHandNumber: number | null;
}

export interface ClangRoundReplayResponse {
  roundNumber: number;
  players: ReplaySeatIdentity[];
  steps: ClangReplayStep[];
  previousRoundNumber: number | null;
  nextRoundNumber: number | null;
}

export interface CardFlipRoundReplayResponse {
  roundNumber: number;
  players: ReplaySeatIdentity[];
  steps: CardFlipReplayStep[];
  previousRoundNumber: number | null;
  nextRoundNumber: number | null;
}
