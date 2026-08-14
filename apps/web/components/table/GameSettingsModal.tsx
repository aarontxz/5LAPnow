"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { EffectiveGameConfig, SetGameConfigPayload } from "@5lapnow/shared-types";
import { Modal } from "./Modal";
import { api } from "@/lib/api";

/** One editable numeric field: label, the key in EffectiveGameConfig/SetGameConfigPayload it maps to, and the minimum value the underlying schema accepts (0, or >0 for "must be positive" fields). */
const FIELD_SPECS: Record<EffectiveGameConfig["kind"], Array<{ key: string; label: string; min: number }>> = {
  poker: [
    { key: "smallBlind", label: "Small blind", min: 0 },
    { key: "bigBlind", label: "Big blind", min: 0 },
    { key: "ante", label: "Ante", min: 0 },
  ],
  clang: [
    { key: "stake", label: "Stake", min: 1 },
    { key: "eatPaymentPerCard", label: "Eat payment (per card)", min: 0 },
  ],
  cardflip: [
    { key: "stake", label: "Stake", min: 1 },
    { key: "cardsPerPlayer", label: "Cards per player", min: 1 },
    { key: "fourOfAKindBonus", label: "Four of a kind bonus", min: 0 },
    { key: "straightFlushBonus", label: "Straight flush bonus", min: 0 },
    { key: "unopenedCardBonus", label: "Unopened card bonus (per card)", min: 0 },
  ],
};

export function GameSettingsModal({
  tableId,
  open,
  onClose,
  canEdit,
  onSave,
}: {
  tableId: string;
  open: boolean;
  onClose: () => void;
  /** False while a hand/round is in progress — the server rejects saves then anyway, but disabling here avoids a round-trip just to find that out. */
  canEdit: boolean;
  onSave: (config: Omit<SetGameConfigPayload, "tableId">) => void;
}) {
  const router = useRouter();
  const [config, setConfig] = useState<EffectiveGameConfig | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingLeave, setConfirmingLeave] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    setConfirmingLeave(false);
    api
      .getGameConfig(tableId)
      .then((c) => {
        setConfig(c);
        const initial: Record<string, string> = {};
        for (const spec of FIELD_SPECS[c.kind]) {
          initial[spec.key] = String((c as unknown as Record<string, number>)[spec.key]);
        }
        setFields(initial);
      })
      .catch(() => setError("Couldn't load current settings."))
      .finally(() => setLoading(false));
  }, [open, tableId]);

  function save() {
    if (!config) return;
    const specs = FIELD_SPECS[config.kind];
    const payload: Record<string, number> = {};
    for (const spec of specs) {
      const raw = fields[spec.key];
      const value = Number(raw);
      if (raw === undefined || raw.trim() === "" || !Number.isFinite(value) || value < spec.min) {
        setError(`${spec.label} must be a number ${spec.min === 0 ? "≥ 0" : `≥ ${spec.min}`}.`);
        return;
      }
      payload[spec.key] = value;
    }
    onSave(payload as unknown as Omit<SetGameConfigPayload, "tableId">);
    onClose();
  }

  const gameLabel = config?.kind === "poker" ? "Poker" : config?.kind === "clang" ? "Clang" : config?.kind === "cardflip" ? "10 Card Flip" : "";

  return (
    <Modal open={open} onClose={onClose} title="Game settings" subtitle={gameLabel} size="sm">
      <div className="flex flex-col gap-4">
        {loading && <p className="text-sm text-white/40">Loading…</p>}
        {!loading && error && !config && <p className="text-sm text-red-400">{error}</p>}

        {!loading && config && (
          <>
            {!canEdit && (
              <p className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-300">
                Settings can't be changed while a hand or round is in progress.
              </p>
            )}
            <div className="flex flex-col gap-3">
              {FIELD_SPECS[config.kind].map((spec) => (
                <div key={spec.key}>
                  <label className="mb-1 block text-xs text-white/50">{spec.label}</label>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={spec.min}
                    disabled={!canEdit}
                    value={fields[spec.key] ?? ""}
                    onChange={(e) => setFields((f) => ({ ...f, [spec.key]: e.target.value }))}
                    className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/30 disabled:cursor-not-allowed disabled:opacity-40"
                  />
                </div>
              ))}
            </div>

            {error && <p className="text-xs text-red-400">{error}</p>}

            <button
              onClick={save}
              disabled={!canEdit}
              className="rounded-lg bg-purple-600 py-2.5 text-sm font-medium text-white hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Save
            </button>
          </>
        )}

        <div className="flex flex-col gap-2 border-t border-white/10 pt-4">
          {!confirmingLeave ? (
            <button
              onClick={() => setConfirmingLeave(true)}
              className="rounded-lg border border-white/10 py-2.5 text-sm font-medium text-white/60 transition-colors hover:border-red-400/40 hover:text-red-300"
            >
              Back to lobby
            </button>
          ) : (
            <>
              <p className="text-center text-xs text-white/50">Leave this table and return to the lobby?</p>
              <div className="flex gap-2">
                <button
                  onClick={() => setConfirmingLeave(false)}
                  className="flex-1 rounded-lg border border-white/10 py-2 text-sm text-white/70 hover:bg-white/5"
                >
                  Cancel
                </button>
                <button
                  onClick={() => router.push("/")}
                  className="flex-1 rounded-lg bg-red-600 py-2 text-sm font-medium text-white hover:bg-red-500"
                >
                  Leave
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
