"use client";

import type { Card } from "@5lapnow/cards";
import { PlayingCard } from "@/components/table/PlayingCard";

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
 * The community board(s) — just the card rows. The hoverable/tappable
 * background/raise-above-seats treatment lives one level up, on the parent's
 * wrapper (see app/table/[id]/page.tsx and the hand replay page), since that
 * background now extends to cover the pot/game-name/winner text around the
 * board too, not just the cards.
 */
export function Board({ board, boards, rabbitBoard, rabbitBoards, canRabbitHunt, onRevealRabbit }: BoardProps) {
  return boards ? (
    <div className="flex flex-col gap-1">
      {boards.map((b, bi) => (
        <BoardRow key={bi} cards={b} rabbitCards={rabbitBoards?.[bi] ?? []} canRabbitHunt={canRabbitHunt} onRevealRabbit={onRevealRabbit} />
      ))}
    </div>
  ) : (
    <BoardRow cards={board} rabbitCards={rabbitBoard ?? []} canRabbitHunt={canRabbitHunt} onRevealRabbit={onRevealRabbit} />
  );
}
