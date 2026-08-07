import type { HandPlayerView } from "@5lapnow/shared-types";

/** Poker's slice of SeatView's `game` union — the extra badges/animations only poker needs (dealer button, bet-chip fly, all-in, voluntary show). */
export interface PokerSeatGameProps {
  kind: "poker";
  handPlayer: HandPlayerView | undefined;
  isButton: boolean;
  /** Unit vector from this seat toward the table center, used to push the bet chip out of the seat box and partway toward the pot. */
  chipDirection: { x: number; y: number };
  /** Hand description ("Full House, Kings full of Fives") for the win, if applicable. */
  winDescription?: string | null;
  /** Voluntarily reveal this seat's hole cards to everyone after the hand completes, when not already forced to show. */
  onShowCards?: () => void;
}
