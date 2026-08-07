"use client";

import type { CardFlipRoundLogEntry } from "@5lapnow/shared-types";
import { PlayingCard } from "../PlayingCard";
import { cn } from "@/lib/cn";

type CardFlipActionLogEntry = CardFlipRoundLogEntry["actions"][number];

/** Net chips won or lost per seat for a Card Flip round: just the final settlement payments. */
function cardFlipNetsBySeat(round: CardFlipRoundLogEntry): Map<number, number> {
  const nets = new Map<number, number>();
  for (const p of round.outcome.payments) {
    nets.set(p.toSeatIndex, (nets.get(p.toSeatIndex) ?? 0) + p.amount);
    nets.set(p.fromSeatIndex, (nets.get(p.fromSeatIndex) ?? 0) - p.amount);
  }
  return nets;
}

/** Renders one turn-by-turn log entry; null for entries not worth a line (the initial deal). */
function cardFlipActionLabel(action: CardFlipActionLogEntry, players: CardFlipRoundLogEntry["players"]): string | null {
  const name = (seatIndex: number) => players.find((p) => p.seatIndex === seatIndex)?.displayName ?? `Seat ${seatIndex}`;
  switch (action.type) {
    case "deal":
      return null;
    case "draw":
      return `${name(action.seatIndex)} draws from pile ${action.pileIndex + 1}`;
    case "complete":
      return null;
  }
}

export function CardFlipRoundLogCard({
  round: r,
  expanded,
  onToggle,
}: {
  round: CardFlipRoundLogEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const nets = cardFlipNetsBySeat(r);
  const netEntries = r.players
    .map((p) => ({ player: p, net: nets.get(p.seatIndex) ?? 0 }))
    .filter(({ net }) => net !== 0)
    .sort((a, b) => b.net - a.net);

  return (
    <button
      onClick={onToggle}
      className={cn(
        "h-fit rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-3 text-left text-sm",
        expanded && "sm:col-span-2 lg:col-span-3"
      )}
    >
      <div className="flex items-center justify-between">
        <span className="font-medium text-neutral-900">Hand #{r.roundNumber} · 10 Card Flip</span>
        <span className="text-xs text-neutral-400">{new Date(r.playedAt).toLocaleTimeString()}</span>
      </div>
      <div className="mt-1 text-xs text-neutral-500">
        stake {r.stake} · first to {r.cardsPerPlayer} cards
      </div>
      <div className="mt-2 flex flex-col gap-0.5 text-xs text-neutral-500">
        {netEntries.map(({ player, net }) => (
          <span key={player.seatIndex}>
            <span className="text-neutral-700">{player.displayName ?? `Seat ${player.seatIndex}`}</span>{" "}
            <span className={cn("font-medium", net > 0 ? "text-emerald-600" : "text-red-600")}>
              {net > 0 ? "+" : ""}
              {net}
            </span>
          </span>
        ))}
      </div>

      {expanded && (
        <div className="mt-3 grid grid-cols-1 gap-3 border-t border-neutral-200 pt-3 sm:grid-cols-2 lg:grid-cols-4">
          {r.players.map((p) => (
            <div key={p.seatIndex}>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                {p.displayName ?? `Seat ${p.seatIndex}`} · {p.bestHandLabel}
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {p.hand.map((c, i) => (
                  <PlayingCard key={i} card={c} small />
                ))}
              </div>
            </div>
          ))}
          <div className="sm:col-span-2 lg:col-span-4">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Turn-by-turn</div>
            <div className="mt-1 flex flex-col gap-0.5 text-xs text-neutral-600">
              {r.actions
                .map((a, i) => ({ key: i, label: cardFlipActionLabel(a, r.players) }))
                .filter((entry): entry is { key: number; label: string } => entry.label !== null)
                .map((entry) => (
                  <span key={entry.key}>{entry.label}</span>
                ))}
            </div>
          </div>
        </div>
      )}
    </button>
  );
}
