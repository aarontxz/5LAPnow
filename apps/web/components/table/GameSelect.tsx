"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

export interface GameOption {
  id: string;
  name: string;
  description: string;
}

export function GameSelect({
  games,
  value,
  onChange,
  className,
}: {
  games: GameOption[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = games.find((g) => g.id === value);

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

  return (
    <div ref={ref} className={`relative ${className ?? "flex-1"}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white/90 hover:border-white/20 hover:bg-white/10"
      >
        <span className="truncate">{selected?.name ?? "—"}</span>
        <motion.span
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.15 }}
          className="shrink-0 pr-1 text-white/30"
        >
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
            className="absolute left-0 top-full z-50 mt-1 w-full overflow-hidden rounded-xl border border-white/10 bg-black/95 shadow-2xl backdrop-blur-sm"
          >
            <div className="max-h-60 overflow-y-auto">
              {games.map((g) => {
                const isActive = g.id === value;
                return (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => { onChange(g.id); setOpen(false); }}
                    className={`flex w-full items-start gap-2.5 px-3 py-3 text-left transition-colors hover:bg-white/10 ${isActive ? "text-emerald-400" : "text-white/80"}`}
                  >
                    <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${isActive ? "bg-emerald-400" : "bg-white/20"}`} />
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{g.name}</p>
                      {g.description && (
                        <p className="mt-0.5 text-[11px] leading-snug text-white/40 line-clamp-2">{g.description}</p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
