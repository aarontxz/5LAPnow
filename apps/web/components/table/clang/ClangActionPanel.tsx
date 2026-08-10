"use client";

import type { Card } from "@5lapnow/cards";
import type { ClangLegalActions } from "@5lapnow/shared-types";
import { PlayingCard } from "../PlayingCard";
import { ActionBar } from "../ActionBar";
import { cn } from "@/lib/cn";

/** Not literally HTML-disabled — clicking still reaches the real handler, which the
 * server rejects with a clear reason ("It is not your turn") via the existing
 * error-toast pipeline. Only visually disabled, so the panel never needs to hide
 * itself just because it isn't your turn right now. */
const DISABLED = "cursor-not-allowed opacity-40";

const RANK_LABELS: Record<number, string> = { 11: "J", 12: "Q", 13: "K", 14: "A" };

function rankLabel(rank: number): string {
  return RANK_LABELS[rank] ?? String(rank);
}

/** Clang scores Ace as the lowest card (1 point) — sort it before 2 instead of after King. */
function clangSortOrder(rank: number): number {
  return rank === 14 ? 1 : rank;
}

function groupByRank(hand: Card[]): Array<{ rank: number; cards: Card[] }> {
  const byRank = new Map<number, Card[]>();
  for (const card of hand) {
    const list = byRank.get(card.rank) ?? [];
    list.push(card);
    byRank.set(card.rank, list);
  }
  return Array.from(byRank.entries())
    .sort((a, b) => clangSortOrder(a[0]) - clangSortOrder(b[0]))
    .map(([rank, cards]) => ({ rank, cards }));
}

export function ClangActionPanel({
  hand,
  handValue,
  legalActions,
  onDraw,
  onPlay,
  onEat,
  onPassEat,
  onCallClang,
  onCallClangInstant,
}: {
  hand: Card[];
  /** Your current point total — live for your own hand, shown beside the Call Clang button. */
  handValue: number | null;
  legalActions: ClangLegalActions | null;
  onDraw: () => void;
  onPlay: (rank: number) => void;
  onEat: () => void;
  onPassEat: () => void;
  onCallClang: () => void;
  onCallClangInstant: () => void;
}) {
  if (!legalActions) return null;
  const { canDraw, canPlay, canCallClangNormal, canCallInstantClang, canEat, canPassEat } = legalActions;

  const groups = groupByRank(hand);

  return (
    <ActionBar growsOnMobile={false} bare>
      {(canEat || canPassEat) && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-amber-300">You can eat!</span>
          {canEat && (
            <button
              onClick={onEat}
              className="rounded-full bg-amber-500 px-4 py-2 text-sm font-medium text-black hover:bg-amber-400"
            >
              Eat
            </button>
          )}
          {canPassEat && (
            <button
              onClick={onPassEat}
              className="rounded-full bg-neutral-700 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-600"
            >
              Pass
            </button>
          )}
        </div>
      )}

      {canCallInstantClang && (
        <button
          onClick={onCallClangInstant}
          className="rounded-full bg-amber-500 px-5 py-2 text-sm font-bold text-black shadow-[0_0_16px_rgba(251,191,36,0.5)] hover:bg-amber-400"
        >
          Clang! (21)
        </button>
      )}

      {/* Draw first, then throw: your turn starts with just a Draw button —
          the discard choices only appear once you've drawn and can see your
          full (now 6-card) hand. Always shown (never hidden waiting for your
          turn) — greyed out and disabled-looking, but still clickable, so a
          press when it isn't your turn gets a clear "It is not your turn"
          from the server instead of the button just not being there. */}
      {canPlay ? (
        <div className="flex flex-nowrap items-center justify-center gap-1.5 overflow-x-auto">
          {groups.map(({ rank, cards }) => (
            <button
              key={rank}
              onClick={() => onPlay(rank)}
              className="flex shrink-0 flex-col items-center gap-0.5 rounded-lg border border-white/10 bg-white/5 p-1 hover:border-purple-400/50 hover:bg-white/10"
            >
              <div className="flex gap-0.5">
                {cards.map((c, i) => (
                  <PlayingCard key={i} card={c} small />
                ))}
              </div>
              <span className="text-[9px] text-white/60">Play {rankLabel(rank)}s</span>
            </button>
          ))}
        </div>
      ) : (
        <button
          onClick={onDraw}
          className={cn("rounded-full bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-500", !canDraw && DISABLED)}
        >
          Draw
        </button>
      )}

      <div className="flex items-center gap-2">
        {handValue != null && (
          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-white/70">
            Total: {handValue}
          </span>
        )}
        <button
          onClick={onCallClang}
          className={cn("rounded-full bg-purple-600 px-5 py-2 text-sm font-medium text-white hover:bg-purple-500", !canCallClangNormal && DISABLED)}
        >
          Call Clang
        </button>
      </div>
    </ActionBar>
  );
}
