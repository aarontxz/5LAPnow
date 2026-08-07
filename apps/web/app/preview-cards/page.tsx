"use client";

import { PlayingCard } from "@/components/table/PlayingCard";
import type { Card } from "@5lapnow/cards";

const suits: Card["suit"][] = ["hearts", "diamonds", "clubs", "spades"];
const cards: Card[] = suits.map((suit) => ({ suit, rank: 13 }));

export default function PreviewCards() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-emerald-950 p-8">
      <div className="flex gap-2">
        {cards.map((c) => (
          <PlayingCard key={c.suit} card={c} />
        ))}
      </div>
      <div className="flex gap-1">
        {cards.map((c) => (
          <PlayingCard key={c.suit} card={c} small />
        ))}
      </div>
    </main>
  );
}
