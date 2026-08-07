"use client";

import { motion } from "framer-motion";
import type { Card } from "@5lapnow/cards";
import type { ClangLegalActions } from "@5lapnow/shared-types";
import { PlayingCard } from "./PlayingCard";

const RANK_LABELS: Record<number, string> = { 11: "J", 12: "Q", 13: "K", 14: "A" };

function rankLabel(rank: number): string {
  return RANK_LABELS[rank] ?? String(rank);
}

function groupByRank(hand: Card[]): Array<{ rank: number; cards: Card[] }> {
  const byRank = new Map<number, Card[]>();
  for (const card of hand) {
    const list = byRank.get(card.rank) ?? [];
    list.push(card);
    byRank.set(card.rank, list);
  }
  return Array.from(byRank.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([rank, cards]) => ({ rank, cards }));
}

export function ClangActionPanel({
  hand,
  legalActions,
  onPlay,
  onEat,
  onPassEat,
  onCallClang,
  onCallClangInstant,
}: {
  hand: Card[];
  legalActions: ClangLegalActions | null;
  onPlay: (rank: number) => void;
  onEat: () => void;
  onPassEat: () => void;
  onCallClang: () => void;
  onCallClangInstant: () => void;
}) {
  if (!legalActions) return null;
  const { canPlay, canCallClangNormal, canCallInstantClang, canEat, canPassEat } = legalActions;
  if (!canPlay && !canCallClangNormal && !canCallInstantClang && !canEat && !canPassEat) return null;

  const groups = groupByRank(hand);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      transition={{ duration: 0.2 }}
      className="flex flex-col items-center gap-2 rounded-2xl border border-white/10 bg-black/70 p-3 shadow-2xl backdrop-blur"
    >
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

      {(canPlay || canCallClangNormal) && (
        <div className="flex flex-wrap items-center justify-center gap-1.5">
          {groups.map(({ rank, cards }) => (
            <button
              key={rank}
              disabled={!canPlay}
              onClick={() => onPlay(rank)}
              className="flex flex-col items-center gap-0.5 rounded-lg border border-white/10 bg-white/5 p-1 hover:border-purple-400/50 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
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
      )}

      {canCallClangNormal && (
        <button
          onClick={onCallClang}
          className="rounded-full bg-purple-600 px-5 py-2 text-sm font-medium text-white hover:bg-purple-500"
        >
          Call Clang
        </button>
      )}
    </motion.div>
  );
}
