"use client";

import type { Card } from "@5lapnow/cards";
import { PlayingCard } from "@/components/table/PlayingCard";
import { cn } from "@/lib/cn";

export interface BoardProps {
  board: Card[];
  boards: Card[][] | null;
  rabbitBoard: Card[] | null;
  rabbitBoards: Card[][] | null;
  canRabbitHunt: boolean;
  onRevealRabbit: () => void;
  /**
   * Whether the board should currently render above overlapping seats.
   * Controlled by the parent (not local state) because this div's actual
   * z-index competition with seats happens one level up — the parent wrapper
   * that positions this component also has its own `transform` (centering
   * translate), which creates a new stacking context and would otherwise
   * trap any z-index set here from ever being compared against a seat's.
   */
  raised: boolean;
  onRaisedChange: (raised: boolean) => void;
}

function BoardRow({
  cards,
  rabbitCards,
  canRabbitHunt,
  onRevealRabbit,
}: {
  cards: Card[];
  rabbitCards: Card[];
  canRabbitHunt: boolean;
  onRevealRabbit: () => void;
}) {
  return (
    <div className="flex gap-0.5 sm:gap-1" style={{ perspective: 800 }}>
      {cards.map((c, i) => (
        <PlayingCard key={i} card={c} small dealDelay={i * 0.12} />
      ))}
      {rabbitCards.map((c, i) => (
        <div key={`r-${i}`} className="opacity-40">
          <PlayingCard card={c} small dealDelay={i * 0.08} />
        </div>
      ))}
      {Array.from({ length: 5 - cards.length - rabbitCards.length }).map((_, i) =>
        canRabbitHunt ? (
          <button
            key={`ph-${i}`}
            onClick={onRevealRabbit}
            title="Rabbit hunt: see the cards that would have come, just for you"
            className="h-11 w-8 rounded-md border border-dashed border-amber-200/40 bg-amber-200/5 transition hover:border-amber-200/70 hover:bg-amber-200/10 sm:h-14 sm:w-10"
          />
        ) : (
          <div key={`ph-${i}`} className="h-11 w-8 rounded-md border border-dashed border-white/10 sm:h-14 sm:w-10" />
        )
      )}
    </div>
  );
}

/**
 * The community board(s), as their own hoverable/tappable region — seats can
 * overlap the board on small screens (same reason SeatView's raise-on-hover
 * exists), so hovering (desktop) or tapping (touch) this area brings it above
 * any seat currently covering it.
 */
export function Board({ board, boards, rabbitBoard, rabbitBoards, canRabbitHunt, onRevealRabbit, raised, onRaisedChange }: BoardProps) {
  return (
    <div
      className={cn(
        "relative rounded-xl border p-1.5 transition-colors sm:p-2",
        raised ? "border-white/25 bg-black/50 shadow-xl" : "border-white/10 bg-black/20"
      )}
      onMouseEnter={() => onRaisedChange(true)}
      onMouseLeave={() => onRaisedChange(false)}
      onPointerDown={(e) => {
        // Mirrors SeatView's raise pattern: mouse already gets hover above, so
        // only toggle here for touch/pen, which has no hover state.
        if (e.pointerType === "mouse") return;
        onRaisedChange(!raised);
      }}
    >
      {boards ? (
        <div className="flex flex-col gap-1">
          {boards.map((b, bi) => (
            <BoardRow
              key={bi}
              cards={b}
              rabbitCards={rabbitBoards?.[bi] ?? []}
              canRabbitHunt={canRabbitHunt}
              onRevealRabbit={onRevealRabbit}
            />
          ))}
        </div>
      ) : (
        <BoardRow cards={board} rabbitCards={rabbitBoard ?? []} canRabbitHunt={canRabbitHunt} onRevealRabbit={onRevealRabbit} />
      )}
    </div>
  );
}
