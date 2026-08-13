"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

/**
 * The viewer's own "Away" control. While a hand/round is actually live, going
 * away offers a choice: leave right now (auto-checks/folds through the rest
 * of this hand — see TablesService.setSeatAway) or queue it for once this
 * hand ends (finish playing it out normally, then sit out from the next one
 * — see TablesService.setSeatAwayAfterHand). Outside of a live hand/round
 * "once this hand ends" is meaningless, so it collapses to a single button.
 */
export function AwayButton({
  sittingOut,
  awayAfterHand,
  roundActive,
  onSetAway,
  onSetAwayAfterHand,
}: {
  sittingOut: boolean;
  awayAfterHand: boolean;
  roundActive: boolean;
  onSetAway: (away: boolean) => void;
  onSetAwayAfterHand: (away: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Tapping/clicking anywhere outside this picker closes it — every dropdown/
  // modal in the app should behave this way (see CLAUDE.md).
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const chipClass =
    "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors";

  if (sittingOut) {
    return (
      <button
        onClick={() => onSetAway(false)}
        className={`${chipClass} border-amber-400/50 bg-amber-400/10 text-amber-300 hover:bg-amber-400/20`}
      >
        Back
      </button>
    );
  }

  if (awayAfterHand) {
    return (
      <button
        onClick={() => onSetAwayAfterHand(false)}
        title="Cancel — stay active after this hand"
        className={`${chipClass} border-amber-400/50 bg-amber-400/10 text-amber-300 hover:bg-amber-400/20`}
      >
        Away next hand ✕
      </button>
    );
  }

  if (!roundActive) {
    return (
      <button
        onClick={() => onSetAway(true)}
        className={`${chipClass} border-white/10 bg-white/5 text-white/50 hover:border-white/20 hover:text-white/80`}
      >
        Away
      </button>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`${chipClass} flex items-center gap-1 border-white/10 bg-white/5 text-white/50 hover:border-white/20 hover:text-white/80`}
      >
        Away
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.15 }} className="text-[10px] leading-none">
          ▾
        </motion.span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -4 }}
            transition={{ duration: 0.12 }}
            className="absolute left-0 top-full z-50 mt-1 w-52 overflow-hidden rounded-xl border border-white/10 bg-black/95 shadow-2xl backdrop-blur-sm"
          >
            <button
              onClick={() => { onSetAway(true); setOpen(false); }}
              className="flex w-full flex-col items-start gap-0.5 px-3 py-2.5 text-left hover:bg-white/10"
            >
              <span className="text-sm font-medium text-white/90">Away now</span>
              <span className="text-[11px] leading-snug text-white/40">Auto-check/fold through this hand</span>
            </button>
            <div className="h-px bg-white/10" />
            <button
              onClick={() => { onSetAwayAfterHand(true); setOpen(false); }}
              className="flex w-full flex-col items-start gap-0.5 px-3 py-2.5 text-left hover:bg-white/10"
            >
              <span className="text-sm font-medium text-white/90">Away once this hand ends</span>
              <span className="text-[11px] leading-snug text-white/40">Keep playing this hand, then sit out</span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
