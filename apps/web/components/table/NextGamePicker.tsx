"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

interface GameOption {
  id: string;
  name: string;
  description?: string;
}

export function NextGamePicker({
  games,
  activeGameDefinitionId,
  onSelect,
  onStart,
}: {
  games: GameOption[];
  activeGameDefinitionId: string | undefined;
  onSelect: (gameDefinitionId: string) => void;
  onStart: () => void;
}) {
  const [open, setOpen] = useState(false);
  const active = games.find((g) => g.id === activeGameDefinitionId);
  const activeName = active?.name ?? activeGameDefinitionId ?? "—";

  // Tapping/clicking anywhere outside this picker closes it — every dropdown/
  // modal in the app should behave this way (see CLAUDE.md).
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    // flex-col-reverse so the dropdown (first in visual order here) opens
    // upward above the button stack instead of downward — the control sits
    // at the bottom of the screen, so a downward dropdown would run off it.
    <div ref={rootRef} className="flex w-64 flex-col-reverse items-end gap-1.5">
      {/* Stacked button */}
      <div className="flex w-full flex-col overflow-hidden rounded-2xl shadow-lg">
        {/* Game name + change-game trigger */}
        {games.length > 1 ? (
          <button
            onClick={() => setOpen((o) => !o)}
            className="flex items-center justify-between gap-2 bg-emerald-700 px-4 py-2 text-xs font-medium text-white/80 transition-colors hover:bg-emerald-600 hover:text-white"
            title="Change game"
          >
            <span className="truncate">{activeName}</span>
            <motion.span
              animate={{ rotate: open ? 0 : 180 }}
              transition={{ duration: 0.15 }}
              className="text-xs leading-none"
            >
              ▾
            </motion.span>
          </button>
        ) : (
          <p className="truncate bg-emerald-700 px-4 py-2 text-xs font-medium text-white/80">{activeName}</p>
        )}

        {/* Divider */}
        <div className="h-px bg-emerald-500/60" />

        {/* Start hand — main action */}
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={onStart}
          className="flex items-center justify-center gap-2 bg-emerald-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 active:bg-emerald-700"
        >
          <span className="text-base leading-none">▶</span>
          Start hand
        </motion.button>
      </div>

      {/* Dropdown */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -4 }}
            transition={{ duration: 0.15 }}
            className="w-full overflow-hidden rounded-2xl border border-white/10 bg-black/90 shadow-2xl backdrop-blur-sm"
          >
            <p className="border-b border-white/10 px-4 py-2 text-[10px] font-semibold uppercase tracking-widest text-white/30">
              Next hand
            </p>
            {games.map((g) => {
              const isActive = g.id === activeGameDefinitionId;
              return (
                <button
                  key={g.id}
                  onClick={() => { onSelect(g.id); setOpen(false); }}
                  className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-white/10 ${isActive ? "text-emerald-400" : "text-white/80"}`}
                >
                  <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${isActive ? "bg-emerald-400" : "bg-white/20"}`} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{g.name}</p>
                    {g.description && (
                      <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-white/40">{g.description}</p>
                    )}
                  </div>
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

