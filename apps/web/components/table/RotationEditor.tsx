"use client";

import { useEffect, useRef, useState } from "react";
import type { RotationSlot } from "@5lapnow/shared-types";
import { Modal } from "./Modal";
import { GameSelect, type GameOption } from "./GameSelect";

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
  const dragIndex = useRef<number | null>(null);

  // Resync local slots every time the modal opens.
  useEffect(() => {
    if (open) {
      setSlots(
        currentRotation.length > 0
          ? currentRotation.map((s) => ({ gameDefinitionId: s.gameDefinitionId, count: s.count }))
          : []
      );
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  function addSlot() {
    const firstGame = games[0];
    if (!firstGame) return;
    setSlots((prev) => [...prev, { gameDefinitionId: firstGame.id, count: 0 }]);
  }

  function removeSlot(i: number) {
    setSlots((prev) => prev.filter((_, idx) => idx !== i));
  }

  function updateSlot(i: number, field: "gameDefinitionId" | "count", value: string | number) {
    setSlots((prev) =>
      prev.map((s, idx) => (idx === i ? { ...s, [field]: field === "count" ? Math.max(0, Number(value)) : value } : s))
    );
  }

  function onDragStart(i: number) { dragIndex.current = i; }
  function onDragOver(e: React.DragEvent, i: number) {
    e.preventDefault();
    if (dragIndex.current === null || dragIndex.current === i) return;
    setSlots((prev) => {
      const next = [...prev];
      const [moved] = next.splice(dragIndex.current!, 1);
      next.splice(i, 0, moved!);
      dragIndex.current = i;
      return next;
    });
  }
  function onDragEnd() { dragIndex.current = null; }

  function save() {
    onSave(slots);
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="Game rotation">
      <div className="flex flex-col gap-4">
        <p className="text-xs text-white/40">
          Drag to reorder. Each slot plays for the set number of hands — set to 0 to skip that game.
        </p>

        <div className="flex flex-col gap-2">
          {slots.map((slot, i) => (
            <div
              key={i}
              draggable
              onDragStart={() => onDragStart(i)}
              onDragOver={(e) => onDragOver(e, i)}
              onDragEnd={onDragEnd}
              className="flex items-center gap-2 rounded-xl transition-opacity [&.dragging]:opacity-40"
            >
              {/* Drag handle — visible grip dots */}
              <span
                draggable={false}
                className="flex cursor-grab select-none flex-col gap-1 px-2 active:cursor-grabbing"
                title="Drag to reorder"
              >
                {[0,1,2].map((row) => (
                  <span key={row} className="flex gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-white/30" />
                    <span className="h-1.5 w-1.5 rounded-full bg-white/30" />
                  </span>
                ))}
              </span>

              <GameSelect
                games={games}
                value={slot.gameDefinitionId}
                onChange={(id) => updateSlot(i, "gameDefinitionId", id)}
              />

              {/* Hand count stepper — 0 means skip this slot */}
              <div className="flex flex-col items-center gap-0.5">
                <div className="flex items-center overflow-hidden rounded-xl border border-white/10 bg-white/5">
                  <button
                    type="button"
                    onClick={() => updateSlot(i, "count", slot.count - 1)}
                    className="px-2.5 py-2 text-white/40 transition-colors hover:bg-white/10 hover:text-white"
                  >
                    −
                  </button>
                  <input
                    type="number"
                    min={0}
                    value={slot.count}
                    onChange={(e) => updateSlot(i, "count", e.target.value)}
                    className="w-12 bg-transparent text-center text-sm font-medium text-white/90 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  />
                  <button
                    type="button"
                    onClick={() => updateSlot(i, "count", slot.count + 1)}
                    className="px-2.5 py-2 text-white/40 transition-colors hover:bg-white/10 hover:text-white"
                  >
                    +
                  </button>
                </div>
                <span className="text-[9px] text-white/20">hands</span>
              </div>

              <button
                type="button"
                onClick={() => removeSlot(i)}
                className="rounded-lg p-1.5 text-white/20 transition-colors hover:bg-red-500/10 hover:text-red-400"
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={addSlot}
          className="flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-white/10 py-2 text-xs text-white/30 transition-colors hover:border-white/30 hover:text-white/60"
        >
          <span className="text-base leading-none">+</span> Add slot
        </button>

        <div className="flex justify-end gap-2 border-t border-white/10 pt-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-sm text-white/40 transition-colors hover:bg-white/5 hover:text-white/70"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            className="rounded-xl bg-emerald-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
          >
            Save
          </button>
        </div>
      </div>
    </Modal>
  );
}
