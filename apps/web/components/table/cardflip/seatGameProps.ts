import type { CardFlipPlayerView } from "@5lapnow/shared-types";

/** Card Flip's slice of SeatView's `game` union — just its hand plus whether this seat currently holds the leader title everyone else must beat. */
export interface CardFlipSeatGameProps {
  kind: "cardflip";
  cardFlipPlayer: CardFlipPlayerView | undefined;
  isLeader: boolean;
}
