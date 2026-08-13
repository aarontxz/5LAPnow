"use client";

import { useEffect, useState } from "react";
import type { CardFlipRoundLogEntry, ClangRoundLogEntry, HandLogEntry, TableLedgerResponse } from "@5lapnow/shared-types";
import { Modal } from "./Modal";
import { HandLogCard } from "./poker/HandLogCard";
import { ClangRoundLogCard } from "./clang/ClangRoundLogCard";
import { CardFlipRoundLogCard } from "./cardflip/CardFlipRoundLogCard";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";

type LogItem =
  | { kind: "poker"; number: number; hand: HandLogEntry }
  | { kind: "clang"; number: number; round: ClangRoundLogEntry }
  | { kind: "cardflip"; number: number; round: CardFlipRoundLogEntry };

/** Merges every engine's history into one chronological timeline — hand/round numbers share a single sequence per table (see TablesService.gameCounter), so sorting by number reflects actual play order across engine switches. */
function mergeLog(data: TableLedgerResponse): LogItem[] {
  const items: LogItem[] = [
    ...data.hands.map((hand): LogItem => ({ kind: "poker", number: hand.handNumber, hand })),
    ...data.clangRounds.map((round): LogItem => ({ kind: "clang", number: round.roundNumber, round })),
    ...data.cardFlipRounds.map((round): LogItem => ({ kind: "cardflip", number: round.roundNumber, round })),
  ];
  return items.sort((a, b) => a.number - b.number);
}

export function LedgerModal({
  tableId,
  open,
  onClose,
}: {
  tableId: string;
  open: boolean;
  onClose: () => void;
}) {
  const [data, setData] = useState<TableLedgerResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"ledger" | "log">("ledger");
  const [expandedHand, setExpandedHand] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  const copyLedger = () => {
    if (!data) return;
    const lines = data.players.map((p) => `${p.displayName}: ${p.net > 0 ? "+" : ""}${p.net}`);
    navigator.clipboard.writeText(["/session", ...lines].join("\n")).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

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
    <Modal open={open} onClose={onClose} title="ledger" size="lg" variant="light">
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

        {!loading && data && tab === "ledger" && data.players.length > 0 && (
          <div className="mt-3 flex shrink-0 justify-end">
            <button
              onClick={copyLedger}
              className="rounded-lg border border-sky-200 bg-sky-100 px-4 py-2 text-sm font-semibold text-sky-700 shadow-sm transition-colors hover:bg-sky-200"
            >
              {copied ? "Copied!" : "Copy ledger"}
            </button>
          </div>
        )}

        {!loading && data && tab === "log" && (
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
            {data.hands.length === 0 && data.clangRounds.length === 0 && data.cardFlipRounds.length === 0 && (
              <p className="text-sm text-neutral-400">No hands played yet.</p>
            )}
            {[...mergeLog(data)].reverse().map((item) => {
              const expanded = expandedHand === item.number;
              const toggle = () => setExpandedHand(expanded ? null : item.number);

              if (item.kind === "clang") {
                return <ClangRoundLogCard key={`clang-${item.round.roundNumber}`} round={item.round} expanded={expanded} onToggle={toggle} />;
              }
              if (item.kind === "cardflip") {
                return (
                  <CardFlipRoundLogCard key={`cardflip-${item.round.roundNumber}`} round={item.round} expanded={expanded} onToggle={toggle} />
                );
              }
              return (
                <HandLogCard key={`poker-${item.hand.handNumber}`} hand={item.hand} tableId={tableId} expanded={expanded} onToggle={toggle} />
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}
