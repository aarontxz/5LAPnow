"use client";

import { forwardRef, type ReactNode } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/cn";

/**
 * How tall the bar reserves itself on phones when its content height is
 * fixed (Clang/Card Flip — see `growsOnMobile` below). The table felt
 * (`app/table/[id]/page.tsx`) imports this same class to reserve matching
 * space above the bar, so the two can never drift out of sync the way they
 * did before: poker's action panel already had a bottom-bar treatment,
 * Clang/Card Flip's didn't, and nothing told the felt to leave room for
 * either — that's what let the bar quietly start covering the felt.
 */
export const FIXED_ACTION_BAR_HEIGHT_CLASS = "h-[10rem]";
export const FIXED_ACTION_BAR_RESERVE_CLASS = "bottom-[10rem]";

/**
 * The one place that owns how a game's action panel presents on phone vs.
 * desktop: a full-width bar pinned to the bottom of the viewport on phones
 * (matching a native bottom sheet), reverting to a small floating card
 * docked in the table page's bottom-right corner from `sm:` up. Every
 * game's action panel (poker/Clang/Card Flip) renders through this instead
 * of hand-rolling its own responsive shell — that duplication (poker had
 * this treatment, Clang/Card Flip didn't) is exactly what caused Clang/Card
 * Flip's panel to overlap the felt on phones while poker's never did, even
 * though all three are "the same kind of thing" from the page's point of
 * view.
 */
export const ActionBar = forwardRef<
  HTMLDivElement,
  {
    /**
     * Poker's raise panel can expand the bar's content height (pot-fraction
     * buttons + slider), so it needs `growsOnMobile` — no fixed mobile
     * height, the bar just grows from the bottom as content changes.
     * Clang/Card Flip's content never changes height, so they pass `false`
     * to get FIXED_ACTION_BAR_HEIGHT_CLASS instead, which the felt reserves
     * space for exactly once, here.
     */
    growsOnMobile: boolean;
    children: ReactNode;
  }
>(function ActionBar({ growsOnMobile, children }, ref) {
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 16 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 flex w-full flex-col gap-1.5 border-t border-white/10 bg-black/60 p-1.5 backdrop-blur-md sm:static sm:inset-auto sm:w-full sm:max-w-md sm:gap-3 sm:rounded-xl sm:border sm:bg-black/40 sm:p-3 sm:shadow-2xl",
        !growsOnMobile &&
          `${FIXED_ACTION_BAR_HEIGHT_CLASS} items-center justify-center overflow-y-auto pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:h-auto sm:justify-start sm:overflow-visible sm:pb-3`
      )}
    >
      {children}
    </motion.div>
  );
});
