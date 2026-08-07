"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

interface GameOption {
  id: string;
  name: string;
}

export function NextGamePicker({
  games,
  activeGameDefinitionId,
  onSelect,
}: {
  games: GameOption[];
  activeGameDefinitionId: string | undefined;
  onSelect: (gameDefinitionId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const activeName = games.find((g) => g.id === activeGameDefinitionId)?.name ?? activeGameDefinitionId;

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1.5 text-xs text-white/50">
        <span>
          Next: <span className="text-white/80">{activeName}</span>
        </span>
        {games.length > 1 && (
          <button
            onClick={() => setOpen((o) => !o)}
            className="rounded px-1 py-0.5 text-[10px] text-white/40 hover:text-white/70"
          >
            change
          </button>
        )}
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 4 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden rounded-2xl border border-white/10 bg-black/90 shadow-2xl backdrop-blur-sm"
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
                  className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:bg-white/10 ${isActive ? "text-emerald-400" : "text-white/80"}`}
                >
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${isActive ? "bg-emerald-400" : "bg-transparent"}`} />
                  {g.name}
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
