import type { Card } from "@5lapnow/cards";
import { PlayingCard } from "../PlayingCard";

export interface ClangPilesProps {
  drawPileCount: number;
  topDiscard: Card[];
  discardPileCount: number;
}

/** Clang's shared draw pile + most recent discard — extracted so it's reusable for both live play and hand replay. */
export function ClangPiles({ drawPileCount, topDiscard, discardPileCount }: ClangPilesProps) {
  return (
    <div className="flex items-start gap-3 sm:gap-6">
      <div className="flex flex-col items-center gap-0.5">
        <PlayingCard card={null} small />
        <span className="text-[9px] text-white/40 sm:text-[10px]">{drawPileCount === 0 ? "Pile empty" : `Pile (${drawPileCount})`}</span>
      </div>
      {topDiscard.length > 0 && (
        <div className="flex flex-col items-center gap-0.5">
          <div className="flex gap-0.5 sm:gap-1">
            {topDiscard.map((c, i) => (
              <PlayingCard key={`discard-${i}-${c.rank}-${c.suit}`} card={c} small dealDelay={i * 0.08} />
            ))}
          </div>
          <span className="text-[9px] text-white/40 sm:text-[10px]">
            Discard{discardPileCount > topDiscard.length ? ` (${discardPileCount})` : ""}
          </span>
        </div>
      )}
    </div>
  );
}
