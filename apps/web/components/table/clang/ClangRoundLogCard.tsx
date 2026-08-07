"use client";

import type { ClangRoundLogEntry } from "@5lapnow/shared-types";
import { PlayingCard } from "../PlayingCard";
import { cn } from "@/lib/cn";

type ClangActionLogEntry = ClangRoundLogEntry["actions"][number];

const CLANG_OUTCOME_LABEL: Record<ClangRoundLogEntry["outcome"]["type"], string> = {
  instant: "Instant Clang (21)",
  call: "Called Clang",
  forced: "Deck exhausted — forced showdown",
};

const CLANG_RANK_LABELS: Record<number, string> = { 11: "J", 12: "Q", 13: "K", 14: "A" };

function clangRankLabel(rank: number): string {
  return CLANG_RANK_LABELS[rank] ?? String(rank);
}

/** Net chips won or lost per seat for a Clang round: settlement payments, eat payments, and starting-hand bonus payouts. */
function clangNetsBySeat(round: ClangRoundLogEntry): Map<number, number> {
  const nets = new Map<number, number>();
  const apply = (payments: ClangRoundLogEntry["outcome"]["payments"]) => {
    for (const p of payments) {
      nets.set(p.toSeatIndex, (nets.get(p.toSeatIndex) ?? 0) + p.amount);
      nets.set(p.fromSeatIndex, (nets.get(p.fromSeatIndex) ?? 0) - p.amount);
    }
  };
  apply(round.outcome.payments);
  for (const bonus of round.bonusHits) apply(bonus.payments);
  for (const action of round.actions) {
    if (action.type === "eat") {
      const amount = round.eatPaymentPerCard * action.count;
      nets.set(action.eaterSeatIndex, (nets.get(action.eaterSeatIndex) ?? 0) + amount);
      nets.set(action.discarderSeatIndex, (nets.get(action.discarderSeatIndex) ?? 0) - amount);
    }
  }
  return nets;
}

/** Renders one turn-by-turn log entry (a player decision or its resolution); null for entries not worth a line (the initial deal). */
function clangActionLabel(action: ClangActionLogEntry, players: ClangRoundLogEntry["players"]): string | null {
  const name = (seatIndex: number) => players.find((p) => p.seatIndex === seatIndex)?.displayName ?? `Seat ${seatIndex}`;
  switch (action.type) {
    case "deal":
      return null;
    case "bonus":
      return `${name(action.seatIndex)} hits a starting-hand bonus (${action.category})`;
    case "play":
      return `${name(action.seatIndex)} plays ${action.count > 1 ? `${action.count}x ` : ""}${clangRankLabel(action.rank)}`;
    case "eat":
      return `${name(action.eaterSeatIndex)} eats ${action.count > 1 ? `${action.count}x ` : ""}${clangRankLabel(action.rank)} from ${name(action.discarderSeatIndex)}`;
    case "eatDeclined":
      return `${name(action.seatIndex)} declines to eat the ${clangRankLabel(action.rank)}`;
    case "draw":
      return `${name(action.seatIndex)} draws a card`;
    case "callClangInstant":
      return `${name(action.seatIndex)} calls Instant Clang! (21)`;
    case "callClang":
      return `${name(action.seatIndex)} calls Clang`;
    case "forcedShowdown":
      return "Draw pile exhausted — forced showdown";
  }
}

export function ClangRoundLogCard({ round: r, expanded, onToggle }: { round: ClangRoundLogEntry; expanded: boolean; onToggle: () => void }) {
  const nets = clangNetsBySeat(r);
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
        <span className="font-medium text-neutral-900">Hand #{r.roundNumber} · Clang</span>
        <span className="text-xs text-neutral-400">{new Date(r.playedAt).toLocaleTimeString()}</span>
      </div>
      <div className="mt-1 text-xs text-neutral-500">
        {CLANG_OUTCOME_LABEL[r.outcome.type]} · stake {r.stake} · eat {r.eatPaymentPerCard}/card
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
                {p.displayName ?? `Seat ${p.seatIndex}`} · value {p.handValue}
              </div>
              <div className="mt-1 flex gap-1">
                {p.hand.map((c, i) => (
                  <PlayingCard key={i} card={c} small />
                ))}
              </div>
            </div>
          ))}
          {r.bonusHits.length > 0 && (
            <div className="sm:col-span-2 lg:col-span-4">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Bonus hits</div>
              <div className="mt-1 flex flex-col gap-0.5 text-xs text-neutral-600">
                {r.bonusHits.map((b, i) => (
                  <span key={i}>
                    {r.players.find((p) => p.seatIndex === b.seatIndex)?.displayName ?? `Seat ${b.seatIndex}`} hit {b.category} — paid{" "}
                    {b.payout} by everyone
                  </span>
                ))}
              </div>
            </div>
          )}
          <div className="sm:col-span-2 lg:col-span-4">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Turn-by-turn</div>
            <div className="mt-1 flex flex-col gap-0.5 text-xs text-neutral-600">
              {r.actions
                .map((a, i) => ({ key: i, label: clangActionLabel(a, r.players) }))
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
