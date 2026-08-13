"use client";

import { useState } from "react";
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
export function Board({ board, boards, rabbitBoard, rabbitBoards, canRabbitHunt, onRevealRabbit }: BoardProps) {
  const [raised, setRaised] = useState(false);

  return (
    <div
      className={cn("relative", raised ? "z-[25]" : "z-0")}
      onMouseEnter={() => setRaised(true)}
      onMouseLeave={() => setRaised(false)}
      onPointerDown={(e) => {
        // Mirrors SeatView's raise pattern: mouse already gets hover above, so
        // only toggle here for touch/pen, which has no hover state.
        if (e.pointerType === "mouse") return;
        setRaised((cur) => !cur);
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
