"use client";

import { useState } from "react";
import type { RotationSlot } from "@5lapnow/shared-types";
import { Modal } from "./Modal";

interface GameOption {
  id: string;
  name: string;
}

export function RotationEditor({
  open,
  onClose,
  currentRotation,
  games,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  currentRotation: RotationSlot[];
  games: GameOption[];
  onSave: (rotation: Array<{ gameDefinitionId: string; count: number }>) => void;
}) {
  const [slots, setSlots] = useState<Array<{ gameDefinitionId: string; count: number }>>(() =>
    currentRotation.length > 0
      ? currentRotation.map((s) => ({ gameDefinitionId: s.gameDefinitionId, count: s.count }))
      : []
  );

  function addSlot() {
    const firstGame = games[0];
    if (!firstGame) return;
    setSlots((prev) => [...prev, { gameDefinitionId: firstGame.id, count: 1 }]);
  }

  function removeSlot(i: number) {
    setSlots((prev) => prev.filter((_, idx) => idx !== i));
  }

  function updateSlot(i: number, field: "gameDefinitionId" | "count", value: string | number) {
    setSlots((prev) =>
      prev.map((s, idx) => (idx === i ? { ...s, [field]: field === "count" ? Math.max(1, Number(value)) : value } : s))
    );
  }

  function save() {
    onSave(slots);
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="Game rotation">
      <div className="flex flex-col gap-3">
        <p className="text-xs text-white/50">
          Games play in order; each slot runs for the specified number of hands before advancing.
          Leave empty to play the same game every hand.
        </p>

        {slots.map((slot, i) => (
          <div key={i} className="flex items-center gap-2">
            <select
              value={slot.gameDefinitionId}
              onChange={(e) => updateSlot(i, "gameDefinitionId", e.target.value)}
              className="flex-1 rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-sm text-white"
            >
              {games.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
            <span className="text-xs text-white/40">×</span>
            <input
              type="number"
              min={1}
              value={slot.count}
              onChange={(e) => updateSlot(i, "count", e.target.value)}
              className="w-16 rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-center text-sm text-white"
            />
            <button
              onClick={() => removeSlot(i)}
              className="text-xs text-red-400 hover:text-red-300"
            >
              ✕
            </button>
          </div>
        ))}

        <button
          onClick={addSlot}
          className="rounded-lg border border-dashed border-white/20 py-1.5 text-xs text-white/50 hover:border-white/40 hover:text-white/70"
        >
          + Add slot
        </button>

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-white/50 hover:text-white">
            Cancel
          </button>
          <button
            onClick={save}
            className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-500"
          >
            Save rotation
          </button>
        </div>
      </div>
    </Modal>
  );
}
