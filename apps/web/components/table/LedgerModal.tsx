"use client";

import { useEffect, useState } from "react";
import type { HandActionLogEntry } from "@5lapnow/game-engine";
import type { HandLogEntry, TableLedgerResponse } from "@5lapnow/shared-types";
import { Modal } from "./Modal";
import { PlayingCard } from "./PlayingCard";
import { api } from "@/lib/api";
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

export function LedgerModal({ tableId, open, onClose }: { tableId: string; open: boolean; onClose: () => void }) {
  const [data, setData] = useState<TableLedgerResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"ledger" | "log">("ledger");
  const [expandedHand, setExpandedHand] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api
      .getLedger(tableId)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [open, tableId]);

  return (
    <Modal open={open} onClose={onClose} title="Log & Ledger" size="lg" variant="light">
      <div className="flex h-full flex-col">
        <div className="mb-4 flex shrink-0 gap-6 border-b border-neutral-200 text-sm">
          <button
            onClick={() => setTab("ledger")}
            className={cn(
              "-mb-px border-b-2 pb-2 font-medium",
              tab === "ledger" ? "border-emerald-500 text-neutral-900" : "border-transparent text-neutral-400 hover:text-neutral-600"
            )}
          >
            Ledger
          </button>
          <button
            onClick={() => setTab("log")}
            className={cn(
              "-mb-px border-b-2 pb-2 font-medium",
              tab === "log" ? "border-emerald-500 text-neutral-900" : "border-transparent text-neutral-400 hover:text-neutral-600"
            )}
          >
            Hand log
          </button>
        </div>

        {loading && <p className="text-sm text-neutral-400">Loading...</p>}

        {!loading && data && tab === "ledger" && (
          <div className="min-h-0 flex-1 overflow-y-auto">
            {data.players.length === 0 ? (
              <p className="text-sm text-neutral-400">No chip activity yet.</p>
            ) : (
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-400">
                    <th className="py-2 pr-3 font-medium">Player</th>
                    <th className="py-2 px-3 text-right font-medium">Buy-in</th>
                    <th className="py-2 px-3 text-right font-medium">Buy-out</th>
                    <th className="py-2 px-3 text-right font-medium">Stack</th>
                    <th className="py-2 pl-3 text-right font-medium">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {data.players.map((p) => (
                    <tr key={p.userId} className="border-b border-neutral-100">
                      <td className="py-3 pr-3">
                        <span className="font-medium text-neutral-900">{p.displayName}</span>
                        {!p.isSeated && <span className="ml-2 text-xs text-neutral-400">left the table</span>}
                      </td>
                      <td className="py-3 px-3 text-right text-neutral-600">{p.totalBuyIn}</td>
                      <td className="py-3 px-3 text-right text-neutral-600">{p.totalCashOut}</td>
                      <td className="py-3 px-3 text-right text-neutral-600">{p.currentStack}</td>
                      <td
                        className={cn(
                          "py-3 pl-3 text-right font-semibold",
                          p.net > 0 ? "text-emerald-600" : p.net < 0 ? "text-red-600" : "text-neutral-500"
                        )}
                      >
                        {p.net > 0 ? "+" : ""}
                        {p.net}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {!loading && data && tab === "log" && (
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
            {data.hands.length === 0 && <p className="text-sm text-neutral-400">No hands played yet.</p>}
            {[...data.hands].reverse().map((h) => {
              const nets = netsBySeat(h);
              const netEntries = h.players
                .map((p) => ({ player: p, net: nets.get(p.seatIndex) ?? 0 }))
                .filter(({ player, net }) => net !== 0 || player.totalContributed > 0)
                .sort((a, b) => b.net - a.net);
              const expanded = expandedHand === h.handNumber;
              const streets = actionsByStreet(h.actions);
              return (
                <button
                  key={h.handNumber}
                  onClick={() => setExpandedHand(expanded ? null : h.handNumber)}
                  className={cn(
                    "h-fit rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-3 text-left text-sm",
                    expanded && "sm:col-span-2 lg:col-span-3"
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-neutral-900">Hand #{h.handNumber}</span>
                    <span className="text-xs text-neutral-400">{new Date(h.playedAt).toLocaleTimeString()}</span>
                  </div>
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
                                  <span className="text-neutral-800">{player?.displayName ?? `Seat ${a.seatIndex}`}</span>{" "}
                                  {actionLabel(a)}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                      {streets.length === 0 && <p className="text-xs text-neutral-400">No betting action this hand.</p>}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}
