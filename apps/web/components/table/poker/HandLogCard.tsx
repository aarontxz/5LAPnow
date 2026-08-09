"use client";

import type { HandActionLogEntry } from "@5lapnow/game-engine";
import type { HandLogEntry } from "@5lapnow/shared-types";
import { PlayingCard } from "../PlayingCard";
import { LogCard, LogCardHeader } from "../LogCard";
import { cn } from "@/lib/cn";

function actionLabel(action: HandActionLogEntry): string {
  switch (action.type) {
    case "post":
      return `posts ${action.amount}`;
    case "fold":
      return "folds";
    case "check":
      return "checks";
    case "call":
      return `calls ${action.amount}`;
    case "bet":
      return `bets ${action.amount}`;
    case "raise":
      return `raises to ${action.amount}`;
  }
}

/** Net chips won or lost per seat for a hand: total won across all pots minus what that seat put in. */
function netsBySeat(hand: HandLogEntry): Map<number, number> {
  const wonBySeat = new Map<number, number>();
  for (const pot of hand.results) {
    for (const w of [...pot.hiWinners, ...pot.loWinners]) {
      wonBySeat.set(w.seatIndex, (wonBySeat.get(w.seatIndex) ?? 0) + w.amount);
    }
  }
  const nets = new Map<number, number>();
  for (const p of hand.players) {
    nets.set(p.seatIndex, (wonBySeat.get(p.seatIndex) ?? 0) - p.totalContributed);
  }
  return nets;
}

/** Groups a hand's chronological action log into per-street buckets, preserving street order. */
function actionsByStreet(actions: HandActionLogEntry[]): Array<[string, HandActionLogEntry[]]> {
  const byStreet = new Map<string, HandActionLogEntry[]>();
  for (const action of actions) {
    const bucket = byStreet.get(action.streetName);
    if (bucket) bucket.push(action);
    else byStreet.set(action.streetName, [action]);
  }
  return [...byStreet.entries()];
}

export function HandLogCard({ hand: h, expanded, onToggle }: { hand: HandLogEntry; expanded: boolean; onToggle: () => void }) {
  const nets = netsBySeat(h);
  const netEntries = h.players
    .map((p) => ({ player: p, net: nets.get(p.seatIndex) ?? 0 }))
    .filter(({ player, net }) => net !== 0 || player.totalContributed > 0)
    .sort((a, b) => b.net - a.net);
  const streets = actionsByStreet(h.actions);

  return (
    <LogCard expanded={expanded} onToggle={onToggle}>
      <LogCardHeader title={`Hand #${h.handNumber} · ${h.gameName}`} playedAt={h.playedAt} />
      {h.boards && h.boards.length > 1 ? (
        <div className="mt-2 flex flex-col gap-1.5">
          {h.boards.map((boardCards, bi) => {
            const shares = h.results.flatMap((pot) => pot.hiWinners.filter((w) => w.boardIndex === bi));
            const boardTotal = shares.reduce((sum, s) => sum + s.amount, 0);
            return (
              <div key={bi} className="rounded border border-neutral-200 bg-white px-2 py-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                    Board {bi + 1} · {boardTotal}
                  </span>
                  <div className="flex gap-0.5">
                    {boardCards.map((c, i) => (
                      <PlayingCard key={i} card={c} small />
                    ))}
                  </div>
                </div>
                <div className="mt-1 flex flex-col gap-0.5 text-xs text-neutral-500">
                  {shares.map((s, i) => {
                    const player = h.players.find((p) => p.seatIndex === s.seatIndex);
                    return (
                      <span key={i}>
                        <span className="text-neutral-700">{player?.displayName ?? `Seat ${s.seatIndex}`}</span>{" "}
                        <span className="font-medium text-emerald-600">+{s.amount}</span>
                        {s.description && <span className="text-neutral-400"> · {s.description}</span>}
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <>
          <div className="mt-2 flex gap-1">
            {h.board.map((c, i) => (
              <PlayingCard key={i} card={c} small />
            ))}
          </div>
          <div className="mt-2 flex flex-col gap-0.5 text-xs text-neutral-500">
            {netEntries.filter(({ net }) => net > 0).map(({ player, net }) => (
              <span key={player.seatIndex}>
                <span className="text-neutral-700">{player.displayName ?? `Seat ${player.seatIndex}`}</span>{" "}
                <span className="font-medium text-emerald-600">+{net}</span>
              </span>
            ))}
          </div>
        </>
      )}

      {expanded && (
        <div className="mt-3 grid grid-cols-1 gap-3 border-t border-neutral-200 pt-3 sm:grid-cols-2 lg:grid-cols-4">
          {streets.map(([streetName, actions]) => (
            <div key={streetName}>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">{streetName}</div>
              <div className="mt-1 flex flex-col gap-0.5 text-xs text-neutral-600">
                {actions.map((a, i) => {
                  const player = h.players.find((p) => p.seatIndex === a.seatIndex);
                  return (
                    <span key={i}>
                      <span className="text-neutral-800">{player?.displayName ?? `Seat ${a.seatIndex}`}</span> {actionLabel(a)}
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
          {streets.length === 0 && <p className="text-xs text-neutral-400">No betting action this hand.</p>}
        </div>
      )}
    </LogCard>
  );
}
