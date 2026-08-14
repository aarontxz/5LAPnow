"use client";

import { forwardRef, type ReactNode } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/cn";

/**
 * How tall every game's action bar reserves itself on phones — fixed and
 * identical across poker/Clang/Card Flip (overflowing content, like poker's
 * raise slider, scrolls within it rather than growing the bar), so the felt
 * can reserve exactly this much space once, the same way for every engine,
 * instead of each game needing its own answer for how much room its panel
 * might take. The table felt (`app/table/[id]/page.tsx`) sizes itself off
 * `top-14` (its own anchor) plus this same 10rem, so the two can never drift
 * out of sync.
 */
export const FIXED_ACTION_BAR_HEIGHT_CLASS = "h-[10rem]";

/**
 * The one place that owns how a game's action panel presents on phone vs.
 * desktop: a full-width bar, fixed at FIXED_ACTION_BAR_HEIGHT_CLASS, pinned
 * to the bottom of the viewport on phones (matching a native bottom sheet),
 * reverting to a small floating card docked in the table page's bottom-right
 * corner from `sm:` up. Every game's action panel (poker/Clang/Card Flip)
 * renders through this instead of hand-rolling its own responsive shell, so
 * they all reserve identical felt space and none of them can quietly start
 * covering it.
 *
 * Only ever has a solid background while `expanded` — resting, it's fully
 * see-through (every individual button already carries its own opaque pill
 * background, so buttons stay legible without one), so it can never visually
 * block a seat/the board it happens to sit near. Once genuinely overlapping
 * the felt in its expanded state, though, a solid backdrop is what makes its
 * own content (sliders, inputs) readable against whatever's behind it — and
 * at that point it's the thing the player is actively using, so covering the
 * felt there is fine.
 */
export const ActionBar = forwardRef<
  HTMLDivElement,
  {
    /**
     * Clang/Card Flip's direct children are individually-sized buttons that
     * should stay centered as a cluster. Poker's are `flex-1` pills meant to
     * stretch and fill the bar's full width, so it leaves this false/unset —
     * `items-center` would collapse those down to their own content size
     * (they'd render as squished circles instead of wide pills).
     */
    centerItems?: boolean;
    /**
     * True while this panel has grown open (e.g. poker's raise sub-panel,
     * whose pot-fraction/slider/amount controls don't fit in the compact
     * fixed height on phones). Drops the fixed mobile height in favor of
     * growing with content — anchored at the bottom, so it grows upward and
     * over the felt/board rather than getting clipped or forcing a cramped
     * inner scroll — gains a solid backdrop (see above) since it's now
     * deliberately covering the felt, and raises the bar above a raised
     * board/seat so it stays on top of whatever it now overlaps. Tapping
     * anything outside the panel (the board included) already closes it via
     * the existing outside-pointerdown handling below, so expanding doesn't
     * need its own separate close affordance. False (default) keeps the
     * compact fixed-height, see-through footprint and sits BELOW a raised
     * board/seat instead, so anything poking down from the felt into the
     * bar's normal small footprint still reads on top of it rather than
     * being hidden behind it.
     */
    expanded?: boolean;
    children: ReactNode;
  }
>(function ActionBar({ centerItems, expanded, children }, ref) {
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 16 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className={cn(
        "fixed inset-x-0 bottom-0 flex w-full flex-col gap-1.5 p-1.5 sm:static sm:inset-auto sm:w-full sm:max-w-md sm:gap-3 sm:p-3",
        expanded ? "z-40" : "z-10",
        centerItems && "items-center",
        expanded
          ? "max-h-[70vh] overflow-y-auto border-t border-white/10 bg-black/60 backdrop-blur-md pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:h-auto sm:max-h-none sm:overflow-visible sm:rounded-xl sm:border sm:bg-black/40 sm:pb-3 sm:shadow-2xl"
          : `${FIXED_ACTION_BAR_HEIGHT_CLASS} justify-center overflow-y-auto pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:h-auto sm:justify-start sm:overflow-visible sm:pb-3`
      )}
    >
      {children}
    </motion.div>
  );
});
