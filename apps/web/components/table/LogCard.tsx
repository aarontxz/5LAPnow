"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * The shared expandable-card shell for every per-hand/round log entry
 * (poker's HandLogCard, Clang's ClangRoundLogCard, Card Flip's
 * CardFlipRoundLogCard, rendered together in LedgerModal's log tab) — all
 * three used to copy-paste this exact button/className pattern, which is
 * exactly the kind of duplication that let one game's log card silently
 * drift from the others' styling without anyone noticing.
 */
export function LogCard({ expanded, onToggle, children }: { expanded: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onToggle}
      className={cn(
        "h-fit rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-3 text-left text-sm",
        expanded && "sm:col-span-2 lg:col-span-3"
      )}
    >
      {children}
    </button>
  );
}

/** The title + played-at-time row every LogCard starts with. */
export function LogCardHeader({ title, playedAt }: { title: string; playedAt: string | Date }) {
  return (
    <div className="flex items-center justify-between">
      <span className="font-medium text-neutral-900">{title}</span>
      <span className="text-xs text-neutral-400">{new Date(playedAt).toLocaleTimeString()}</span>
    </div>
  );
}
