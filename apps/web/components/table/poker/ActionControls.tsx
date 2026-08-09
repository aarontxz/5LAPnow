"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { LegalActionInfo, PlayerAction } from "@5lapnow/game-engine";
import { ActionBar } from "../ActionBar";

function HotkeyHint({ letter }: { letter: string }) {
  return (
    <span className="pointer-events-none absolute right-1.5 top-1.5 rounded bg-black/30 px-1 text-[8px] font-semibold uppercase leading-tight text-white/60">
      {letter}
    </span>
  );
}

export function ActionControls({
  legalActions,
  pot,
  currentBet,
  onAction,
}: {
  /** Null whenever it isn't the viewer's turn — the panel stays mounted and visible, just disabled. */
  legalActions: LegalActionInfo | null;
  /** Total chips in the pot (all streets), used to compute the pot-fraction bet presets. */
  pot: number;
  /** The highest amount committed this street by anyone — the bet/raise being faced (0 pre-flop-open). */
  currentBet: number;
  onAction: (action: PlayerAction) => void;
}) {
  const isMyTurn = legalActions !== null;
  const canCheck = legalActions?.canCheck ?? false;
  const canCall = legalActions?.canCall ?? false;
  const canBetOrRaise = legalActions?.canBetOrRaise ?? false;
  const callAmount = legalActions?.callAmount ?? 0;
  const minRaiseTo = legalActions?.minRaiseTo ?? 0;
  const maxRaiseTo = legalActions?.maxRaiseTo ?? 0;

  // Pot-fraction preset: raise size = fraction * (pot + callAmount), matching
  // standard pot-limit sizing math (the pot as it would stand after we call).
  function potFractionToAmount(fraction: number): number {
    const raiseSize = fraction * (pot + callAmount);
    const toAmount = currentBet + raiseSize;
    return Math.min(maxRaiseTo, Math.max(minRaiseTo, Math.round(toAmount)));
  }
  // While it isn't your turn we don't know whether you'll face a check or a
  // call next, so default to showing "Check" rather than a stale "Call 0".
  const showCheck = !isMyTurn || canCheck;

  const [raiseOpen, setRaiseOpen] = useState(false);
  const [raiseInput, setRaiseInput] = useState(String(minRaiseTo));
  const panelRef = useRef<HTMLDivElement>(null);

  // Close the raise panel when the user taps outside of it.
  useEffect(() => {
    if (!raiseOpen) return;
    function handlePointerDown(e: PointerEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setRaiseOpen(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [raiseOpen]);
  const raiseAmountInputRef = useRef<HTMLInputElement>(null);

  const raiseValue = Number(raiseInput);
  const isValidRaise =
    raiseInput.trim() !== "" && Number.isFinite(raiseValue) && raiseValue >= minRaiseTo && raiseValue <= maxRaiseTo;

  // The panel can no longer be dismissed by unmounting (it's always visible),
  // so close the raise sub-panel ourselves once it's no longer your turn.
  useEffect(() => {
    if (!isMyTurn) setRaiseOpen(false);
  }, [isMyTurn]);

  function toggleRaise() {
    if (!isMyTurn || !canBetOrRaise) return;
    setRaiseOpen((open) => {
      if (!open) setRaiseInput(String(minRaiseTo));
      return !open;
    });
  }

  function submitRaise() {
    if (!isMyTurn || !isValidRaise) return;
    onAction({ type: canCheck ? "bet" : "raise", toAmount: raiseValue });
    setRaiseOpen(false);
  }

  function submitAllIn() {
    if (!isMyTurn || !canBetOrRaise) return;
    onAction({ type: canCheck ? "bet" : "raise", toAmount: maxRaiseTo });
    setRaiseOpen(false);
  }

  // Focus (and open the keyboard on phones) the raise amount field as soon as the
  // raise panel opens, so the player can start typing immediately.
  useEffect(() => {
    if (raiseOpen) {
      raiseAmountInputRef.current?.focus();
      raiseAmountInputRef.current?.select();
    }
  }, [raiseOpen]);

  // Hotkeys: f fold, k check, c call, r toggle the raise panel. All no-ops
  // when it isn't your turn. Ignored while typing in the raise amount field
  // (or any input) so digits/letters typed there don't trigger an action.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!isMyTurn) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;

      switch (e.key.toLowerCase()) {
        case "f":
          onAction({ type: "fold" });
          break;
        case "k":
          if (canCheck) onAction({ type: "check" });
          break;
        case "c":
          if (canCall) onAction({ type: "call" });
          break;
        case "r":
          // preventDefault: toggleRaise() shifts focus into the amount input
          // this same tick, and without it the browser redirects this
          // keydown's keypress there, typing a stray "r" into the field.
          if (canBetOrRaise) {
            e.preventDefault();
            toggleRaise();
          }
          break;
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isMyTurn, canCheck, canCall, canBetOrRaise, onAction]);

  return (
    <ActionBar ref={panelRef} growsOnMobile>
      <div className="flex gap-2 sm:gap-3">
        <motion.button
          whileHover={isMyTurn && canBetOrRaise ? { scale: 1.03 } : undefined}
          whileTap={isMyTurn && canBetOrRaise ? { scale: 0.95 } : undefined}
          disabled={!isMyTurn || !canBetOrRaise}
          onClick={toggleRaise}
          className={`relative flex-1 rounded-full px-3 py-2 text-sm font-medium text-white disabled:opacity-30 sm:flex-none sm:px-4 sm:py-2.5 ${
            raiseOpen ? "bg-purple-500" : "bg-purple-600 hover:bg-purple-500"
          }`}
        >
          {showCheck ? "Bet" : "Raise"}
          <HotkeyHint letter="R" />
        </motion.button>

        {showCheck ? (
          <motion.button
            whileHover={isMyTurn ? { scale: 1.03 } : undefined}
            whileTap={isMyTurn ? { scale: 0.95 } : undefined}
            disabled={!isMyTurn}
            onClick={() => onAction({ type: "check" })}
            className="relative flex-1 rounded-full bg-neutral-700 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-600 disabled:opacity-30 sm:flex-none sm:px-4 sm:py-2.5"
          >
            Check
            <HotkeyHint letter="K" />
          </motion.button>
        ) : (
          <motion.button
            whileHover={canCall ? { scale: 1.03 } : undefined}
            whileTap={canCall ? { scale: 0.95 } : undefined}
            disabled={!isMyTurn || !canCall}
            onClick={() => onAction({ type: "call" })}
            className="relative flex-1 rounded-full bg-neutral-700 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-600 disabled:opacity-30 sm:flex-none sm:px-4 sm:py-2.5"
          >
            Call {callAmount}
            <HotkeyHint letter="C" />
          </motion.button>
        )}

        <motion.button
          whileHover={isMyTurn ? { scale: 1.03 } : undefined}
          whileTap={isMyTurn ? { scale: 0.95 } : undefined}
          disabled={!isMyTurn}
          onClick={() => onAction({ type: "fold" })}
          className="relative flex-1 rounded-full bg-red-600/80 px-3 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-30 sm:flex-none sm:px-4 sm:py-2.5"
        >
          Fold
          <HotkeyHint letter="F" />
        </motion.button>
      </div>

      <AnimatePresence>
        {raiseOpen && isMyTurn && canBetOrRaise && (
          <motion.div
            key="raise-panel"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="flex flex-col gap-2 overflow-hidden"
          >
            <div className="flex gap-1.5">
              {[
                { label: "1/3 Pot", fraction: 1 / 3 },
                { label: "1/2 Pot", fraction: 1 / 2 },
                { label: "Pot", fraction: 1 },
              ].map(({ label, fraction }) => (
                <motion.button
                  key={label}
                  type="button"
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setRaiseInput(String(potFractionToAmount(fraction)))}
                  className="flex-1 rounded-full border border-white/10 bg-white/5 px-2 py-1.5 text-xs font-medium text-white/80 hover:border-purple-400/50 hover:bg-white/10"
                >
                  {label}
                </motion.button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={minRaiseTo}
                max={maxRaiseTo}
                value={isValidRaise ? raiseValue : minRaiseTo}
                onChange={(e) => setRaiseInput(e.target.value)}
                className="min-w-0 flex-1 accent-purple-500"
              />
              <input
                ref={raiseAmountInputRef}
                type="text"
                inputMode="numeric"
                value={raiseInput}
                onChange={(e) => setRaiseInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && isValidRaise) submitRaise(); }}
                className={`w-16 rounded border px-2 py-1 text-center text-base sm:w-20 sm:text-sm ${
                  isValidRaise ? "border-white/10 bg-black/40 text-white" : "border-red-500 bg-red-950/40 text-red-300"
                }`}
              />
            </div>
            <div className="flex gap-2">
              <motion.button
                whileHover={isValidRaise ? { scale: 1.03 } : undefined}
                whileTap={isValidRaise ? { scale: 0.95 } : undefined}
                disabled={!isValidRaise}
                onClick={submitRaise}
                className="flex-1 rounded-full bg-purple-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-purple-500 disabled:opacity-30"
              >
                {showCheck ? "Bet" : "Raise to"} {raiseInput}
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.95 }}
                onClick={submitAllIn}
                className="rounded-full bg-amber-600 px-3 py-2.5 text-xs font-medium text-white hover:bg-amber-500"
              >
                All-in
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </ActionBar>
  );
}
