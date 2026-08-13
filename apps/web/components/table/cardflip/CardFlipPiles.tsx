import type { Card } from "@5lapnow/cards";
import { PlayingCard } from "../PlayingCard";

export interface CardFlipPilesProps {
  pileCounts: number[];
  /** Which pile most recently had a card drawn from it, and what that card was — shown face-up there instead of a face-down back. Null shows every pile face-down. */
  revealedPile: { pileIndex: number; card: Card } | null;
}

/** Card Flip's three shared draw piles — extracted so it's reusable for both live play and hand replay. */
export function CardFlipPiles({ pileCounts, revealedPile }: CardFlipPilesProps) {
  return (
    <div className="flex items-center justify-center gap-2">
      {pileCounts.map((count, i) => {
        const revealedCard = revealedPile?.pileIndex === i ? revealedPile.card : null;
        return (
          <div key={i} className="flex flex-col items-center gap-0.5">
            {/* Keyed by the card itself (each card is drawn at most once) so PlayingCard
                remounts and replays its flip-in animation every time this pile is the
                one just drawn from. */}
            <PlayingCard key={revealedCard ? `${revealedCard.rank}-${revealedCard.suit}` : "back"} card={revealedCard} small />
            <span className="text-[9px] text-white/40 sm:text-[10px]">{count} left</span>
          </div>
        );
      })}
    </div>
  );
}
