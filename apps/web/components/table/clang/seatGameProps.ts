import type { ClangPlayerView } from "@5lapnow/shared-types";

/** Clang's slice of SeatView's `game` union — the eat-chain highlight/badge only Clang needs. */
export interface ClangSeatGameProps {
  kind: "clang";
  clangPlayer: ClangPlayerView | undefined;
  isEatCandidate: boolean;
  isDiscarder: boolean;
}
