"use client";

import { motion } from "framer-motion";
import type { CardFlipLegalActions } from "@5lapnow/shared-types";
import { PlayingCard } from "../PlayingCard";

export function CardFlipActionPanel({
  pileCounts,
  legalActions,
  onDraw,
}: {
  pileCounts: number[];
  legalActions: CardFlipLegalActions | null;
  onDraw: (pileIndex: number) => void;
}) {
  if (!legalActions || !legalActions.canDraw) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      transition={{ duration: 0.2 }}
      className="flex flex-col items-center gap-2 rounded-2xl border border-white/10 bg-black/70 p-3 shadow-2xl backdrop-blur"
    >
      <span className="text-xs text-emerald-300">Your turn — draw from a pile</span>
      <div className="flex items-center justify-center gap-3">
        {pileCounts.map((count, i) => (
          <button
            key={i}
            disabled={count === 0}
            onClick={() => onDraw(i)}
            className="flex flex-col items-center gap-1 rounded-lg border border-white/10 bg-white/5 p-2 hover:border-purple-400/50 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <PlayingCard card={null} small />
            <span className="text-[10px] text-white/60">Pile {i + 1} ({count})</span>
          </button>
        ))}
      </div>
    </motion.div>
  );
}
