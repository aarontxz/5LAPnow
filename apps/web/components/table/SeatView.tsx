"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { PublicSeatView, SeatRequestView } from "@5lapnow/shared-types";
import type { Card } from "@5lapnow/cards";
import { PlayingCard } from "./PlayingCard";
import { AnimatedNumber } from "./AnimatedNumber";
import { Modal } from "./Modal";
import { cn } from "@/lib/cn";
import type { PokerSeatGameProps } from "./poker/seatGameProps";
import type { ClangSeatGameProps } from "./clang/seatGameProps";
import type { CardFlipSeatGameProps } from "./cardflip/seatGameProps";

// max-w caps the box so a big hand (Clang/Card Flip can run past poker's 2
// cards, up to 10) wraps into multiple rows instead of growing wider than
// the viewport — side seats near the felt's left/right edge would otherwise
// push cards off-screen on mobile with nothing to force a wrap. Sized to
// comfortably fit HAND_FAN_THRESHOLD - 1 (5) full-size, unfanned small
// PlayingCards with margin to spare — see that constant's comment for the
// exact math this is paired with.
// w-max is load-bearing: this box is absolutely positioned with a `left`
// offset (see page.tsx) and centered afterward via -translate-x-1/2. Without
// an explicit width, the browser's shrink-to-fit sizing for `width: auto`
// caps itself at the space between that `left` offset and the containing
// block's edge — computed BEFORE the transform shifts it — so a seat
// anchored near the right edge (left: 86%) gets a much narrower "available"
// width than one near the left edge (left: 14%) and wraps its cards earlier,
// even with identical content and the same max-w. `w-max` (width:
// max-content) sizes purely off the content, ignoring that positional
// constraint, so every seat's card fan wraps identically regardless of
// where it sits on the felt.
const SEAT_BOX = "min-h-20 min-w-20 max-w-52 w-max sm:min-h-32 sm:min-w-44 sm:max-w-64";
// A hand of 5 or fewer cards renders full-size and unfanned (normally
// spaced via gap-0.5) rather than overlapped — SEAT_BOX's max-w is sized to
// fit exactly that (5 small PlayingCards: 32px + 2px gap each = 168px content,
// well inside max-w-52's 208px). Only once a hand grows past 5 (Clang/Card
// Flip can run up to 10) does it switch to a fanned overlap to stay compact
// instead of continuing to grow the box. Every hand-card row (own hand,
// opponents' face-down counts, Clang, Card Flip) reads this one constant,
// so it can't drift into two different thresholds the way it did before.
const HAND_FAN_THRESHOLD = 6;
const EMPTY_BOX_CLASS = cn(
  SEAT_BOX,
  "flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-white/20 bg-neutral-800 p-1.5 sm:p-2"
);
// Plain numeric text input: no browser up/down spinner arrows (a type="number" quirk).
const AMOUNT_INPUT_CLASS =
  "w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-center text-base text-white placeholder:text-white/30";

function onlyDigits(value: string): string {
  return value.replace(/[^0-9]/g, "");
}

/** Per-game specifics: which cards to show and which extra badges/animations render inside the seat box. Everything else (empty seat, pending request, owner stack-adjust modal) is 100% shared across poker/Clang/Card Flip — each game's own slice of this union lives next to that game's other components. */
type SeatGameProps = PokerSeatGameProps | ClangSeatGameProps | CardFlipSeatGameProps;

export function SeatView({
  seat,
  isTurn,
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
  game,
}: {
  seat: PublicSeatView;
  isTurn: boolean;
  isViewer: boolean;
  viewerUserId: string | null;
  canSit: boolean;
  isOwner: boolean;
  /** Whether a hand/round is currently live at this table — gates the owner's stack-adjust modal copy ("queue for next hand/round" vs. immediate). */
  roundInProgress: boolean;
  pendingRequest: SeatRequestView | undefined;
  /** Chips this seat won (or lost, if negative/Clang/Card Flip) from the last hand/round settlement. */
  winAmount?: number;
  /** Pre-fills the seat-request name field with whatever name the viewer used last, if any. */
  defaultDisplayName?: string | null;
  onRequest: (buyIn: number, displayName: string) => void;
  onApprove: (requestId: string, buyIn: number) => void;
  onReject: (requestId: string) => void;
  onCancelRequest: (requestId: string) => void;
  onAdjustStack: (mode: "add" | "remove" | "set", amount: number) => void;
  onRemovePlayer: () => void;
  onSetAway: (away: boolean) => void;
  onTransferOwnership: () => void;
  game: SeatGameProps;
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

  // From here on the seat is occupied — derive the game-specific cards/badges/highlight.
  let cards: Card[] | null = null;
  let cardCount = 0;
  let folded = false;
  const isEatCandidate = game.kind === "clang" && game.isEatCandidate;
  const isDiscarder = game.kind === "clang" && game.isDiscarder;
  const isLeader = game.kind === "cardflip" && game.isLeader;

  if (game.kind === "poker") {
    cards = game.handPlayer?.holeCards ?? null;
    cardCount = game.handPlayer?.holeCardCount ?? 0;
    folded = game.handPlayer?.folded ?? false;
  } else if (game.kind === "clang") {
    cards = game.clangPlayer?.hand ?? null;
    cardCount = game.clangPlayer?.handCardCount ?? 0;
  } else {
    cards = game.cardFlipPlayer?.hand ?? null;
    cardCount = game.cardFlipPlayer?.handCardCount ?? 0;
  }
  const handLength = cards?.length ?? cardCount;
  // See HAND_FAN_THRESHOLD's comment above — one number, read by the one hand
  // row below, instead of two rendering paths each tracking their own
  // threshold (that drift is exactly what let Card Flip's hands wrap into a
  // second row at counts Clang's didn't).
  const shouldFan = handLength >= HAND_FAN_THRESHOLD;
  // Only meaningful once we can see the actual cards (own hand, or Card
  // Flip's public hands) — an opponent's face-down placeholder count never
  // gets the "just drew this" glow, there's nothing to point at.
  const justDrewLastCard =
    (game.kind === "clang" && game.clangPlayer?.justDrewLastCard) ||
    (game.kind === "cardflip" && game.cardFlipPlayer?.justDrewLastCard);

  const seatContent = (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{
        opacity: folded ? 0.4 : 1,
        scale: folded ? 0.95 : 1,
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
                : isLeader
                  ? "border-amber-400/60"
                  : "border-white/10",
        isViewer ? "bg-purple-900/60" : "bg-neutral-800",
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
            {game.kind === "poker" && game.winDescription && (
              <span className="whitespace-nowrap rounded-full bg-black/70 px-2 py-0.5 text-[8px] text-amber-200 sm:text-[10px]">
                {game.winDescription}
              </span>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      {game.kind === "poker" && (
        <AnimatePresence>
          {game.isButton && (
            <motion.span
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{ type: "spring", stiffness: 400, damping: 20 }}
              className="absolute -top-2 -right-2 flex h-4 w-4 items-center justify-center rounded-full bg-white text-[9px] font-bold text-black sm:h-5 sm:w-5 sm:text-[10px]"
            >
              D
            </motion.span>
          )}
        </AnimatePresence>
      )}
      <span className="max-w-full truncate text-[10px] font-medium text-white sm:text-xs">
        {seat.displayName} <span className="text-emerald-300">· <AnimatedNumber value={seat.stack} /> chips</span>
      </span>
      {seat.pendingStackAdjustment !== null && (
        <span className="text-[9px] font-medium text-amber-300 sm:text-[10px]">→ {seat.pendingStackAdjustment} next {game.kind === "poker" ? "hand" : "round"}</span>
      )}
      {seat.status === "sitting-out" && <span className="text-[9px] font-bold text-white/40 sm:text-[10px]">AWAY</span>}
      {seat.leavingAfterHand && (
        <span className="text-[9px] font-bold text-red-400 sm:text-[10px]">LEAVING AFTER {game.kind === "poker" ? "HAND" : "ROUND"}</span>
      )}
      {isEatCandidate && <span className="text-[9px] font-bold text-amber-300 sm:text-[10px]">CAN EAT</span>}
      {handLength > 0 && (
        // A fanned overlap (each card after the first pulled left, later ones
        // painting on top) instead of a wrapped grid — a hand bigger than
        // poker's 2 cards (Clang/Card Flip can run past 5) stays compact and
        // readable in one row instead of a blocky multi-row grid; flex-wrap
        // stays on as a fallback for extreme hand sizes. Poker's 2 cards
        // never need it, so they just sit normally spaced. One loop handles
        // both known cards and an opponent's face-down placeholders (`c` is
        // just null in that case) — see HAND_FAN_THRESHOLD's comment for why
        // this used to be two separately-maintained branches.
        <div className={cn("flex flex-wrap justify-center", !shouldFan && "gap-0.5 sm:gap-1")}>
          {Array.from({ length: handLength }).map((_, i) => {
            const c = cards ? cards[i] : null;
            const isNewCard = !!c && justDrewLastCard && i === handLength - 1;
            return (
              <motion.div
                key={c ? `up-${i}-${c.rank}-${c.suit}` : `down-${i}`}
                animate={
                  isNewCard
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
                transition={isNewCard ? { duration: 1.1, repeat: Infinity, repeatType: "reverse", ease: "easeInOut" } : { duration: 0.2 }}
                className={cn("rounded-sm", i > 0 && shouldFan && "-ml-4 sm:-ml-5", isNewCard && "z-10 ring-2 ring-amber-400")}
              >
                {/* Starts strictly after Card Flip's pile has already reverted to
                    face-down (CARD_FLIP_PILE_REVEAL_MS = 500ms in page.tsx) — the
                    revealed pile and this new hand card must never be visible at
                    the same time, or the same card reads as "in two places". */}
                <PlayingCard card={c} small dealDelay={isNewCard ? 0.55 : i * 0.08} />
              </motion.div>
            );
          })}
        </div>
      )}
      {game.kind === "poker" && game.handPlayer?.handStrengthLabel && (
        <span className="text-[9px] text-white/50 sm:text-[10px]">{game.handPlayer.handStrengthLabel}</span>
      )}
      {game.kind === "cardflip" && game.cardFlipPlayer && (
        <span className={cn("text-[9px] sm:text-[10px]", isLeader ? "font-bold text-amber-300" : "text-white/50")}>
          {game.cardFlipPlayer.handStrengthLabel && <>{game.cardFlipPlayer.handStrengthLabel} · </>}
          <span className={isLeader ? "text-amber-300/80" : "text-white/40"}>
            {game.cardFlipPlayer.handCardCount}/{game.cardsPerPlayer} cards
          </span>
        </span>
      )}
      {game.kind === "poker" && (
        <AnimatePresence>
          {game.handPlayer && game.handPlayer.committedThisStreet > 0 && (
            <motion.div
              key="bet"
              initial={{ opacity: 0, scale: 0.4, x: "-50%", y: "-50%" }}
              animate={{
                opacity: 1,
                scale: 1,
                // Travel distance clears the seat box's own half-width/height (which
                // grows at the sm: breakpoint) so the chip always lands clearly
                // outside the box, not overlapping it.
                x: `calc(-50% + (${game.chipDirection.x} * clamp(52px, 12vw, 96px)))`,
                y: `calc(-50% + (${game.chipDirection.y} * clamp(52px, 12vw, 96px)))`,
              }}
              exit={{ opacity: 0, scale: 0.4, x: "-50%", y: "-50%" }}
              transition={{ type: "spring", stiffness: 300, damping: 22 }}
              className="pointer-events-none absolute left-1/2 top-1/2 z-10 flex flex-col items-center gap-0.5"
            >
              <div className="h-3.5 w-3.5 rounded-full border-2 border-dashed border-white/80 bg-purple-600 shadow sm:h-4 sm:w-4" />
              <span className="whitespace-nowrap rounded-full bg-black/60 px-1.5 py-0.5 text-[9px] font-medium text-white sm:text-[10px]">
                <AnimatedNumber value={game.handPlayer.committedThisStreet} />
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      )}
      {game.kind === "poker" && (
        <AnimatePresence>
          {game.handPlayer?.allIn && (
            <motion.span
              key="allin"
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.5 }}
              transition={{ type: "spring", stiffness: 400, damping: 18 }}
              className="text-[9px] font-bold text-amber-400 sm:text-[10px]"
            >
              ALL IN
            </motion.span>
          )}
        </AnimatePresence>
      )}
    </motion.div>
  );

  // Rendered as a sibling, never nested inside seatContent — the owner-view
  // branch below wraps seatContent in its own <button>, and a nested <button>
  // would be invalid HTML and steal the click.
  const showCardsButton = game.kind === "poker" && isViewer && game.handPlayer?.canShow && (
    <AnimatePresence>
      <motion.button
        key="show-cards"
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.93 }}
        onClick={(e) => {
          e.stopPropagation();
          game.onShowCards?.();
        }}
        className="absolute left-full top-1/2 z-10 ml-1.5 -translate-y-1/2 whitespace-nowrap rounded-full bg-black/60 px-2 py-0.5 text-[9px] font-medium text-white/70 hover:bg-black/80 hover:text-white sm:ml-2 sm:text-[10px]"
      >
        Show cards
      </motion.button>
    </AnimatePresence>
  );

  if (!isOwner) {
    return (
      <div className="relative">
        {seatContent}
        {showCardsButton}
      </div>
    );
  }

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
    onAdjustStack(adjustMode, adjustValue);
    closeAdjust();
  };
  const modes: Array<{ key: "add" | "remove" | "set"; label: string }> = [
    { key: "add", label: "Add" },
    { key: "remove", label: "Remove" },
    { key: "set", label: "Set" },
  ];

  return (
    <>
      <div className="relative">
        <button onClick={openAdjust} className="block">
          {seatContent}
        </button>
        {showCardsButton}
      </div>

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
                  <p className="text-xs text-amber-300">→ {seat.pendingStackAdjustment} queued for next {game.kind === "poker" ? "hand" : "round"}</p>
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
                  A {game.kind === "poker" ? "hand" : "round"} is in progress — this will apply when the next {game.kind === "poker" ? "hand" : "round"} starts.
                </p>
              )}
            </div>
            <button
              disabled={!canSaveAdjust}
              onClick={saveAdjust}
              className="rounded-full bg-emerald-600 py-2.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {roundInProgress ? `Queue for next ${game.kind === "poker" ? "hand" : "round"}` : "Update player"}
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
