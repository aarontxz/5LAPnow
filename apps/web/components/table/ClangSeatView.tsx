"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { ClangPlayerView, PublicSeatView, SeatRequestView } from "@5lapnow/shared-types";
import { PlayingCard } from "./PlayingCard";
import { AnimatedNumber } from "./AnimatedNumber";
import { Modal } from "./Modal";
import { cn } from "@/lib/cn";

const SEAT_BOX = "min-h-20 min-w-20 sm:min-h-32 sm:min-w-44";
const EMPTY_BOX_CLASS = cn(
  SEAT_BOX,
  "flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-white/20 bg-white/5 p-1.5 sm:p-2"
);
const AMOUNT_INPUT_CLASS =
  "w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-center text-base text-white placeholder:text-white/30";

function onlyDigits(value: string): string {
  return value.replace(/[^0-9]/g, "");
}

export function ClangSeatView({
  seat,
  clangPlayer,
  isTurn,
  isEatCandidate,
  isDiscarder,
  isViewer,
  viewerUserId,
  canSit,
  isOwner,
  roundInProgress,
  pendingRequest,
  winAmount,
  defaultDisplayName,
  onRequest,
  onApprove,
  onReject,
  onCancelRequest,
  onAdjustStack,
  onRemovePlayer,
  onSetAway,
  onTransferOwnership,
}: {
  seat: PublicSeatView;
  clangPlayer: ClangPlayerView | undefined;
  isTurn: boolean;
  isEatCandidate: boolean;
  isDiscarder: boolean;
  isViewer: boolean;
  viewerUserId: string | null;
  canSit: boolean;
  isOwner: boolean;
  roundInProgress: boolean;
  pendingRequest: SeatRequestView | undefined;
  /** Net chips this seat gained (or lost, if negative) from the last round/bonus settlement. */
  winAmount?: number;
  defaultDisplayName?: string | null;
  onRequest: (buyIn: number, displayName: string) => void;
  onApprove: (requestId: string, buyIn: number) => void;
  onReject: (requestId: string) => void;
  onCancelRequest: (requestId: string) => void;
  onAdjustStack: (newStack: number) => void;
  onRemovePlayer: () => void;
  onSetAway: (away: boolean) => void;
  onTransferOwnership: () => void;
}) {
  const [requesting, setRequesting] = useState(false);
  const [buyIn, setBuyIn] = useState("");
  const [name, setName] = useState(defaultDisplayName ?? "");
  const [reviewing, setReviewing] = useState(false);
  const [approveAmount, setApproveAmount] = useState(String(pendingRequest?.requestedBuyIn ?? ""));
  const [adjusting, setAdjusting] = useState(false);
  const [adjustMode, setAdjustMode] = useState<"add" | "remove" | "set">("add");
  const [adjustAmount, setAdjustAmount] = useState("");
  const [confirmAction, setConfirmAction] = useState<"remove" | "transfer" | null>(null);

  const isRequester = pendingRequest !== undefined && pendingRequest.userId === viewerUserId;
  const requestedAmount = Number(buyIn);
  const canSubmitRequest = buyIn !== "" && requestedAmount > 0 && name.trim() !== "";
  const approvedAmount = Number(approveAmount);
  const canApprove = approveAmount !== "" && approvedAmount > 0;
  const currentTarget = seat.pendingStackAdjustment ?? seat.stack;
  const adjustValue = Number(adjustAmount) || 0;
  const adjustTarget =
    adjustMode === "add" ? currentTarget + adjustValue : adjustMode === "remove" ? Math.max(0, currentTarget - adjustValue) : adjustValue;
  const canSaveAdjust = adjustAmount !== "" && adjustValue >= 0 && adjustTarget !== currentTarget;
  const isAway = seat.status === "sitting-out";

  if (seat.status === "empty" && pendingRequest) {
    const closeReview = () => setReviewing(false);

    if (isOwner) {
      return (
        <>
          <motion.button
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.93 }}
            transition={{ duration: 0.2 }}
            onClick={() => {
              setApproveAmount(String(pendingRequest.requestedBuyIn));
              setReviewing(true);
            }}
            className={cn(
              EMPTY_BOX_CLASS,
              "cursor-pointer border-amber-400/50 text-center text-[10px] font-medium text-amber-300 hover:border-amber-400 sm:text-xs"
            )}
          >
            <span className="max-w-full truncate">{pendingRequest.displayName}</span>
            <span>wants a seat</span>
          </motion.button>

          <Modal open={reviewing} onClose={closeReview} title="Seat request">
            <div className="flex flex-col gap-4">
              <p className="text-sm text-white/70">
                <span className="font-medium text-white">{pendingRequest.displayName}</span> requested to sit with{" "}
                <span className="font-medium text-white">{pendingRequest.requestedBuyIn}</span> chips.
              </p>
              <div>
                <label className="mb-1 block text-xs text-white/50">Approve with stack</label>
                <input
                  autoFocus
                  type="text"
                  inputMode="numeric"
                  value={approveAmount}
                  onChange={(e) => setApproveAmount(onlyDigits(e.target.value))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && canApprove) {
                      onApprove(pendingRequest.id, approvedAmount);
                      closeReview();
                    }
                  }}
                  className={AMOUNT_INPUT_CLASS}
                />
              </div>
              <div className="flex gap-2">
                <button
                  disabled={!canApprove}
                  onClick={() => {
                    onApprove(pendingRequest.id, approvedAmount);
                    closeReview();
                  }}
                  className="flex-1 rounded-full bg-emerald-600 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Approve
                </button>
                <button
                  onClick={() => {
                    onReject(pendingRequest.id);
                    closeReview();
                  }}
                  className="flex-1 rounded-full bg-red-600/80 py-2 text-sm font-medium text-white hover:bg-red-500"
                >
                  Reject
                </button>
                <button onClick={closeReview} className="rounded-full bg-neutral-700 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-600">
                  Later
                </button>
              </div>
            </div>
          </Modal>
        </>
      );
    }

    return (
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key="pending"
          initial={{ opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.85 }}
          transition={{ duration: 0.2 }}
          className={EMPTY_BOX_CLASS}
        >
          <span className="text-center text-[9px] text-amber-300 sm:text-[10px]">
            {isRequester ? `Requested $${pendingRequest.requestedBuyIn}` : "Pending approval"}
          </span>
          {isRequester && (
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.93 }}
              onClick={() => onCancelRequest(pendingRequest.id)}
              className="rounded-full bg-neutral-700 px-2.5 py-1 text-[10px] font-medium text-white hover:bg-neutral-600"
            >
              Cancel
            </motion.button>
          )}
        </motion.div>
      </AnimatePresence>
    );
  }

  if (seat.status === "empty") {
    const closeModal = () => {
      setRequesting(false);
      setBuyIn("");
    };
    const submit = () => {
      if (!canSubmitRequest) return;
      onRequest(requestedAmount, name.trim());
      closeModal();
    };

    return (
      <>
        <AnimatePresence mode="wait" initial={false}>
          {canSit ? (
            <motion.button
              key="sit"
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.85 }}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.93 }}
              transition={{ duration: 0.2 }}
              onClick={() => setRequesting(true)}
              className={cn(EMPTY_BOX_CLASS, "cursor-pointer text-[10px] font-medium text-white/70 hover:border-white/40 hover:text-white sm:text-xs")}
            >
              {isOwner ? "Sit here" : "Request seat"}
            </motion.button>
          ) : (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className={cn(
                SEAT_BOX,
                "flex items-center justify-center rounded-xl border border-dashed border-white/10 text-[10px] text-white/30 sm:text-xs"
              )}
            >
              Empty
            </motion.div>
          )}
        </AnimatePresence>

        <Modal open={requesting} onClose={closeModal} title={isOwner ? "Sit down" : "Request a seat"}>
          <div className="flex flex-col gap-3">
            <input
              autoFocus
              type="text"
              placeholder="Your name at this table"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              className={AMOUNT_INPUT_CLASS}
            />
            <input
              type="text"
              inputMode="numeric"
              placeholder="Buy-in amount"
              value={buyIn}
              onChange={(e) => setBuyIn(onlyDigits(e.target.value))}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              className={AMOUNT_INPUT_CLASS}
            />
            <div className="flex gap-2">
              <button
                disabled={!canSubmitRequest}
                onClick={submit}
                className="flex-1 rounded-full bg-purple-600 py-2 text-sm font-medium text-white hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isOwner ? "Sit down" : "Send request"}
              </button>
              <button
                onClick={closeModal}
                className="rounded-full bg-neutral-700 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-600"
              >
                Cancel
              </button>
            </div>
          </div>
        </Modal>
      </>
    );
  }

  const cards = clangPlayer?.hand ?? null;
  const cardCount = clangPlayer?.handCardCount ?? 0;

  const seatContent = (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{
        opacity: 1,
        scale: 1,
        boxShadow: isTurn
          ? ["0 0 0px rgba(52,211,153,0)", "0 0 20px rgba(52,211,153,0.55)", "0 0 8px rgba(52,211,153,0.3)"]
          : isEatCandidate
            ? ["0 0 0px rgba(251,191,36,0)", "0 0 20px rgba(251,191,36,0.55)", "0 0 8px rgba(251,191,36,0.3)"]
            : "0 0 0px rgba(52,211,153,0)",
      }}
      transition={{
        opacity: { duration: 0.3 },
        scale: { duration: 0.3 },
        boxShadow:
          isTurn || isEatCandidate
            ? { duration: 1.4, repeat: Infinity, repeatType: "reverse", ease: "easeInOut" }
            : { duration: 0.3 },
      }}
      className={cn(
        SEAT_BOX,
        "relative flex flex-col items-center justify-center gap-0.5 rounded-xl border p-1.5 sm:gap-1 sm:p-2",
        winAmount != null && winAmount > 0
          ? "border-amber-400 shadow-[0_0_18px_rgba(251,191,36,0.5)]"
          : isTurn
            ? "border-emerald-400"
            : isEatCandidate
              ? "border-amber-400"
              : isDiscarder
                ? "border-white/30"
                : "border-white/10",
        isViewer ? "bg-purple-500/10" : "bg-white/5",
        isOwner && "cursor-pointer hover:border-white/30"
      )}
    >
      <AnimatePresence>
        {winAmount != null && winAmount !== 0 && (
          <motion.div
            key="win"
            initial={{ opacity: 0, y: 6, scale: 0.8 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ delay: 0.5, duration: 0.35, type: "spring", stiffness: 300, damping: 20 }}
            className="absolute -top-4 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-0.5"
          >
            <span
              className={cn(
                "whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold text-black shadow sm:text-xs",
                winAmount > 0 ? "bg-amber-400" : "bg-red-400"
              )}
            >
              {winAmount > 0 ? "+" : ""}
              {winAmount}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
      <span className="max-w-full truncate text-[10px] font-medium text-white sm:text-xs">{seat.displayName}</span>
      <span className="text-[10px] text-emerald-300 sm:text-xs">
        <AnimatedNumber value={seat.stack} /> chips
      </span>
      {seat.pendingStackAdjustment !== null && (
        <span className="text-[9px] font-medium text-amber-300 sm:text-[10px]">→ {seat.pendingStackAdjustment} next round</span>
      )}
      {seat.status === "sitting-out" && <span className="text-[9px] font-bold text-white/40 sm:text-[10px]">AWAY</span>}
      {seat.leavingAfterHand && <span className="text-[9px] font-bold text-red-400 sm:text-[10px]">LEAVING AFTER ROUND</span>}
      {isEatCandidate && <span className="text-[9px] font-bold text-amber-300 sm:text-[10px]">CAN EAT</span>}
      {(cards || cardCount > 0) && (
        <div className="flex gap-0.5 sm:gap-1">
          {cards
            ? cards.map((c, i) => {
                const isNew = clangPlayer?.justDrewLastCard && i === cards.length - 1;
                return (
                  <motion.div
                    key={`up-${i}-${c.rank}-${c.suit}`}
                    animate={
                      isNew
                        ? {
                            y: [0, -5, 0],
                            boxShadow: [
                              "0 0 0px rgba(251,191,36,0)",
                              "0 0 12px rgba(251,191,36,0.9)",
                              "0 0 6px rgba(251,191,36,0.5)",
                            ],
                          }
                        : { y: 0, boxShadow: "0 0 0px rgba(251,191,36,0)" }
                    }
                    transition={isNew ? { duration: 1.1, repeat: Infinity, repeatType: "reverse", ease: "easeInOut" } : { duration: 0.2 }}
                    className={cn("rounded-sm", isNew && "ring-2 ring-amber-400")}
                  >
                    <PlayingCard card={c} small dealDelay={i * 0.08} />
                  </motion.div>
                );
              })
            : Array.from({ length: cardCount }).map((_, i) => <PlayingCard key={`down-${i}`} card={null} small dealDelay={i * 0.08} />)}
        </div>
      )}
      {clangPlayer?.handValue != null && (
        <span className="text-[9px] text-white/50 sm:text-[10px]">value {clangPlayer.handValue}</span>
      )}
    </motion.div>
  );

  if (!isOwner) return seatContent;

  const closeAdjust = () => {
    setAdjusting(false);
    setConfirmAction(null);
  };
  const openAdjust = () => {
    setAdjustMode("add");
    setAdjustAmount("");
    setConfirmAction(null);
    setAdjusting(true);
  };
  const saveAdjust = () => {
    if (!canSaveAdjust) return;
    onAdjustStack(adjustTarget);
    closeAdjust();
  };
  const modes: Array<{ key: "add" | "remove" | "set"; label: string }> = [
    { key: "add", label: "Add" },
    { key: "remove", label: "Remove" },
    { key: "set", label: "Set" },
  ];

  return (
    <>
      <button onClick={openAdjust} className="block">
        {seatContent}
      </button>

      <Modal
        open={adjusting}
        onClose={closeAdjust}
        title={seat.displayName ?? "Player"}
        subtitle={seat.playerId ? `(ID: ${seat.playerId.slice(0, 8)})` : undefined}
        size="md"
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-3">
            <p className="text-xs font-medium uppercase tracking-wide text-white/40">Player stack</p>
            <div className="flex flex-col gap-3 rounded-xl border border-white/10 p-3">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-white/40">Current</p>
                <p className="text-lg font-semibold text-white">{seat.stack}</p>
                {seat.pendingStackAdjustment !== null && (
                  <p className="text-xs text-amber-300">→ {seat.pendingStackAdjustment} queued for next round</p>
                )}
              </div>
              <div className="flex overflow-hidden rounded-lg border border-white/10">
                <div className="flex shrink-0">
                  {modes.map((m) => (
                    <button
                      key={m.key}
                      onClick={() => setAdjustMode(m.key)}
                      className={cn(
                        "px-3 py-2 text-xs font-medium uppercase tracking-wide",
                        adjustMode === m.key ? "bg-emerald-600 text-white" : "bg-transparent text-white/40 hover:text-white/70"
                      )}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
                <input
                  autoFocus
                  type="text"
                  inputMode="numeric"
                  placeholder="Value"
                  value={adjustAmount}
                  onChange={(e) => setAdjustAmount(onlyDigits(e.target.value))}
                  onKeyDown={(e) => e.key === "Enter" && saveAdjust()}
                  className="min-w-0 flex-1 bg-black/40 px-3 py-2 text-base text-white placeholder:text-white/30 focus:outline-none"
                />
              </div>
              {roundInProgress && (
                <p className="rounded-lg bg-amber-400/10 px-3 py-2 text-xs text-amber-300">
                  A round is in progress — this will apply when the next round starts.
                </p>
              )}
            </div>
            <button
              disabled={!canSaveAdjust}
              onClick={saveAdjust}
              className="rounded-full bg-emerald-600 py-2.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {roundInProgress ? "Queue for next round" : "Update player"}
            </button>
          </div>

          <div className="flex flex-col gap-2">
            <button
              onClick={() => {
                if (confirmAction === "remove") {
                  onRemovePlayer();
                  closeAdjust();
                } else {
                  setConfirmAction("remove");
                }
              }}
              className="rounded-lg bg-red-500/80 py-3 text-sm font-medium text-white hover:bg-red-500"
            >
              {confirmAction === "remove" ? "Click again to confirm" : "Remove player"}
            </button>
            <button
              onClick={() => {
                if (confirmAction === "transfer") {
                  onTransferOwnership();
                  closeAdjust();
                } else {
                  setConfirmAction("transfer");
                }
              }}
              className="rounded-lg bg-red-500/80 py-3 text-sm font-medium text-white hover:bg-red-500"
            >
              {confirmAction === "transfer" ? "Click again to confirm" : "Transfer game ownership"}
            </button>
            <button
              onClick={() => {
                onSetAway(!isAway);
                closeAdjust();
              }}
              className="rounded-lg bg-red-500/80 py-3 text-sm font-medium text-white hover:bg-red-500"
            >
              {isAway ? "Remove from away mode" : "Put on away mode"}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
