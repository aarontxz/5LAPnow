"use client";

import type { CardFlipLegalActions } from "@5lapnow/shared-types";
import { PlayingCard } from "../PlayingCard";
import { ActionBar } from "../ActionBar";
import { cn } from "@/lib/cn";

export function CardFlipActionPanel({
  pileCounts,
  legalActions,
  onDraw,
}: {
  pileCounts: number[];
  legalActions: CardFlipLegalActions | null;
  onDraw: (pileIndex: number) => void;
}) {
  if (!legalActions) return null;
  const { canDraw } = legalActions;

  return (
    <ActionBar growsOnMobile={false} bare>
      <span className={cn("text-xs", canDraw ? "text-emerald-300" : "text-white/40")}>
        {canDraw ? "Your turn — draw from a pile" : "Waiting for your turn…"}
      </span>
      <div className="flex items-center justify-center gap-3">
        {pileCounts.map((count, i) => (
          <button
            key={i}
            disabled={count === 0}
            // Not html-disabled just because it isn't your turn — clicking still
            // reaches the server, which rejects with "It is not your turn" via
            // the existing error-toast pipeline, so the panel never needs to
            // hide itself while waiting.
            onClick={() => onDraw(i)}
            className={cn(
              "flex flex-col items-center gap-1 rounded-lg border border-white/10 bg-white/5 p-2 hover:border-purple-400/50 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40",
              !canDraw && "cursor-not-allowed opacity-40"
            )}
          >
            <PlayingCard card={null} small />
            <span className="text-[10px] text-white/60">Pile {i + 1} ({count})</span>
          </button>
        ))}
      </div>
    </ActionBar>
  );
}
