"use client";

import { motion } from "framer-motion";
import type { Card } from "@5lapnow/cards";
import { cn } from "@/lib/cn";

const RANK_LABELS: Record<number, string> = {
  2: "2", 3: "3", 4: "4", 5: "5", 6: "6", 7: "7", 8: "8", 9: "9", 10: "10",
  11: "J", 12: "Q", 13: "K", 14: "A",
};
const SUIT_SYMBOLS: Record<Card["suit"], string> = { clubs: "♣", diamonds: "♦", hearts: "♥", spades: "♠" };
// Each suit gets its own hue (not just red/black) so same-color suits stay
// visually distinct even before the shape registers.
const SUIT_COLORS: Record<Card["suit"], string> = {
  hearts: "text-red-600",
  diamonds: "text-pink-500",
  clubs: "text-neutral-900",
  spades: "text-blue-950",
};

export function PlayingCard({
  card,
  small,
  dealDelay = 0,
}: {
  card: Card | null;
  small?: boolean;
  /** Stagger, in seconds, applied to this card's deal/flip-in animation. */
  dealDelay?: number;
}) {
  const size = small ? "h-11 w-8 sm:h-14 sm:w-10" : "h-16 w-11 sm:h-24 sm:w-16";
  const rankSize = small ? "text-sm sm:text-lg" : "text-lg sm:text-3xl";
  const suitSize = small ? "mt-0.5 text-lg sm:mt-1 sm:text-2xl" : "mt-1 text-3xl sm:mt-2 sm:text-5xl";

  return (
    <motion.div
      initial={{ rotateY: -100, opacity: 0, scale: 0.8 }}
      animate={{ rotateY: 0, opacity: 1, scale: 1 }}
      transition={{ duration: 0.35, delay: dealDelay, ease: [0.34, 1.56, 0.64, 1] }}
      style={{ transformStyle: "preserve-3d" }}
      className={cn(
        size,
        "relative",
        card
          ? cn(
              "flex flex-col items-center justify-center rounded-md border border-black/10 bg-white font-semibold shadow-md",
              SUIT_COLORS[card.suit]
            )
          : "rounded-md border border-white/10 bg-gradient-to-br from-indigo-800 to-purple-900 shadow-inner"
      )}
    >
      {card && (
        <>
          <span className={cn("absolute left-0.5 top-0 leading-none sm:left-1 sm:top-0.5", rankSize)}>
            {RANK_LABELS[card.rank]}
          </span>
          <span className={cn("leading-none", suitSize)}>{SUIT_SYMBOLS[card.suit]}</span>
        </>
      )}
    </motion.div>
  );
}
