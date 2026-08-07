"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import type { PotShare } from "@5lapnow/game-engine";
import { loadSession, saveSession, type Session } from "@/lib/session";
import { useTableSocket } from "@/lib/useTableSocket";
import { SeatView } from "@/components/table/SeatView";
import { PlayingCard } from "@/components/table/PlayingCard";
import { ActionControls } from "@/components/table/ActionControls";
import { AnimatedNumber } from "@/components/table/AnimatedNumber";
import { LedgerModal } from "@/components/table/LedgerModal";

const MAX_SEATS = 10;

// Fixed rectangle layout: seat 0 is bottom-center, seats 1-4 run up the right
// side, seat 5 is top-center (across from you), seats 6-9 run back down the
// left side. Every seat renders at one of these positions by RELATIVE index
// (see relativeSeatIndex) so seat 0 is always wherever the viewer is sitting
// — everyone's own screen shows themselves at the bottom, table non-circular.
const RECT_POSITIONS: Array<{ left: number; top: number }> = [
  { left: 50, top: 90 },
  { left: 86, top: 76 },
  { left: 86, top: 58 },
  { left: 86, top: 40 },
  { left: 86, top: 22 },
  { left: 50, top: 10 },
  { left: 14, top: 22 },
  { left: 14, top: 40 },
  { left: 14, top: 58 },
  { left: 14, top: 76 },
];

// Rotates an absolute seatIndex so the viewer's own seat always maps to
// relative position 0 (bottom-center); everyone else falls in clockwise
// around the rectangle from there. Falls back to the absolute index when the
// viewer isn't seated (spectating).
function relativeSeatIndex(seatIndex: number, mySeatIndex: number | null): number {
  if (mySeatIndex === null) return seatIndex % MAX_SEATS;
  return (seatIndex - mySeatIndex + MAX_SEATS) % MAX_SEATS;
}

function seatPosition(relativeIndex: number): { left: string; top: string } {
  const pos = RECT_POSITIONS[relativeIndex] ?? RECT_POSITIONS[0];
  return { left: `${pos.left}%`, top: `${pos.top}%` };
}

// Unit vector pointing from a seat's rectangle position back toward the
// table's center — used to push a bet's chip token partway out of the seat
// box toward the pot without it ever fully reaching the center.
function chipDirection(relativeIndex: number): { x: number; y: number } {
  const pos = RECT_POSITIONS[relativeIndex] ?? RECT_POSITIONS[0];
  const dx = 50 - pos.left;
  const dy = 50 - pos.top;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

export default function TablePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: tableId } = use(params);
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const {
    snapshot,
    error,
    connected,
    requestSeat,
    approveRequest,
    rejectRequest,
    cancelRequest,
    adjustStack,
    removePlayer,
    setSeatAway,
    transferOwnership,
    stand,
    startHand,
    sendAction,
  } = useTableSocket(tableId);

  useEffect(() => {
    const s = loadSession();
    if (!s) {
      router.push("/");
      return;
    }
    setSession(s);
  }, [router]);

  const hand = snapshot?.hand ?? null;
  const isComplete = hand?.phase === "complete";
  const winners: PotShare[] = isComplete && hand?.results ? hand.results.flatMap((pot) => [...pot.hiWinners, ...pot.loWinners]) : [];

  // The server keeps reporting the full pot total through the "complete"
  // snapshot (chips are already in winners' stacks by then). We hold the felt's
  // pot number at that final total just long enough for the win animation to
  // read as "the pot flies out to the winner," then drop it to 0 so the felt
  // doesn't sit there implying unclaimed chips.
  const [displayPot, setDisplayPot] = useState(0);
  useEffect(() => {
    if (!hand) {
      setDisplayPot(0);
      return;
    }
    if (hand.phase === "complete") {
      setDisplayPot(hand.pot);
      const timer = setTimeout(() => setDisplayPot(0), 900);
      return () => clearTimeout(timer);
    }
    setDisplayPot(hand.pot);
  }, [hand?.phase, hand?.pot, hand?.handNumber]);

  if (!session) return null;

  const mySeat = snapshot?.seats.find((s) => s.playerId === session.userId);
  const mySeatIndex = mySeat?.seatIndex ?? null;
  const isOwner = snapshot?.ownerId === session.userId;
  const board = hand?.board ?? [];
  const legalActions = hand?.legalActions ?? null;
  const activeSeats = snapshot?.seats.filter((s) => s.status === "active").length ?? 0;

  return (
    <main className="relative flex flex-1 flex-col overflow-hidden px-2 py-3 sm:px-6 sm:py-6">
      <header className="flex items-start justify-between gap-2">
        <motion.button
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.96 }}
          onClick={() => setLedgerOpen(true)}
          className="flex shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/70 shadow-sm hover:border-white/20 hover:bg-white/10 hover:text-white sm:px-3.5 sm:py-2 sm:text-sm"
        >
          <span aria-hidden>📒</span>
          Log &amp; Ledger
        </motion.button>
        <div className="text-right">
          <p className="text-xs text-white/40">{connected ? "connected" : "connecting..."}</p>
          <h1 className="truncate text-sm font-semibold sm:text-base">{snapshot?.gameName ?? "Loading..."}</h1>
          {snapshot?.ownerDisplayName && (
            <p className="text-[10px] text-amber-200/80 sm:text-xs">
              <span aria-hidden>👑</span> Owner: {snapshot.ownerDisplayName}
            </p>
          )}
          {mySeat && (
            <button
              onClick={stand}
              disabled={mySeat.leavingAfterHand}
              className="mt-1 text-xs text-red-400 hover:text-red-300 disabled:cursor-default disabled:text-white/40 disabled:hover:text-white/40"
            >
              {mySeat.leavingAfterHand ? "Leaving after this hand..." : "Stand up"}
            </button>
          )}
        </div>
      </header>

      {error && <p className="text-center text-sm text-red-400">{error}</p>}

      {/* This wrapper absorbs all remaining space; the table itself has a fixed
          intrinsic size (via max-w + aspect-ratio) so nothing that appears or
          disappears around it — action buttons, errors — ever resizes it. */}
      <div className="flex flex-1 items-center justify-center overflow-hidden py-2">
        <div className="relative aspect-[5/6] w-full max-w-md rounded-2xl border border-emerald-900/50 bg-gradient-to-b from-emerald-950 to-emerald-900 shadow-2xl sm:max-w-2xl">
          <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1 sm:gap-2">
            <div className="flex gap-0.5 sm:gap-1" style={{ perspective: 800 }}>
              {board.map((c, i) => (
                <PlayingCard key={i} card={c} dealDelay={i * 0.12} />
              ))}
              {Array.from({ length: 5 - board.length }).map((_, i) => (
                <div key={`ph-${i}`} className="h-16 w-11 rounded-md border border-dashed border-white/10 sm:h-24 sm:w-16" />
              ))}
            </div>
            <span className="rounded-full bg-black/40 px-3 py-1 text-xs text-white/70 sm:text-sm">
              Pot: <AnimatedNumber value={displayPot} />
            </span>
            <AnimatePresence>
              {isComplete && winners.length > 0 && (
                <motion.div
                  key={`winners-${hand?.handNumber}`}
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.25 }}
                  className="flex flex-col items-center gap-0.5"
                >
                  {winners.map((w, i) => {
                    const winnerSeat = snapshot?.seats.find((s) => s.seatIndex === w.seatIndex);
                    return (
                      <span key={i} className="text-[10px] text-emerald-300 sm:text-xs">
                        {winnerSeat?.displayName ?? `Seat ${w.seatIndex}`} wins {w.amount}
                        {w.description ? ` with ${w.description}` : ""}
                      </span>
                    );
                  })}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Chips fly out from the pot to each winner once a hand settles; purely
              visual, keyed by hand number so it replays fresh on every showdown. */}
          <AnimatePresence>
            {isComplete &&
              winners.map((w, i) => {
                const pos = seatPosition(relativeSeatIndex(w.seatIndex, mySeatIndex));
                return (
                  <motion.div
                    key={`win-fly-${hand?.handNumber}-${w.seatIndex}-${i}`}
                    initial={{ left: "50%", top: "50%", opacity: 1, scale: 1 }}
                    animate={{ left: pos.left, top: pos.top, opacity: 0, scale: 0.6 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.7, delay: 0.15, ease: "easeIn" }}
                    className="pointer-events-none absolute z-30 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-400 px-2 py-1 text-[10px] font-bold text-black shadow-lg"
                  >
                    +{w.amount}
                  </motion.div>
                );
              })}
          </AnimatePresence>

          {snapshot?.seats.map((seat) => {
            const relIndex = relativeSeatIndex(seat.seatIndex, mySeatIndex);
            const pos = seatPosition(relIndex);
            const handPlayer = hand?.players.find((p) => p.seatIndex === seat.seatIndex);
            const pendingRequest = snapshot.pendingRequests.find((r) => r.seatIndex === seat.seatIndex);
            const winShare = isComplete ? winners.find((w) => w.seatIndex === seat.seatIndex) : undefined;
            return (
              <div
                key={seat.seatIndex}
                className="absolute -translate-x-1/2 -translate-y-1/2"
                style={pos}
              >
                <SeatView
                  seat={seat}
                  handPlayer={handPlayer}
                  isButton={snapshot.buttonSeatIndex === seat.seatIndex}
                  isTurn={hand?.turnSeatIndex === seat.seatIndex}
                  isViewer={seat.playerId === session.userId}
                  viewerUserId={session.userId}
                  canSit={!mySeat}
                  isOwner={isOwner}
                  handInProgress={snapshot.handInProgress}
                  pendingRequest={pendingRequest}
                  chipDirection={chipDirection(relIndex)}
                  winAmount={winShare?.amount}
                  winDescription={winShare?.description}
                  defaultDisplayName={session.displayName}
                  onRequest={(buyIn, displayName) => {
                    requestSeat(seat.seatIndex, buyIn, displayName);
                    // Optimistic — the server is the source of truth and will reject
                    // this via action:error if the name turns out to be taken.
                    const updated = { ...session, displayName };
                    saveSession(updated);
                    setSession(updated);
                  }}
                  onApprove={approveRequest}
                  onReject={rejectRequest}
                  onCancelRequest={cancelRequest}
                  onAdjustStack={(newStack) => adjustStack(seat.seatIndex, newStack)}
                  onRemovePlayer={() => removePlayer(seat.seatIndex)}
                  onSetAway={(away) => setSeatAway(seat.seatIndex, away)}
                  onTransferOwnership={() => transferOwnership(seat.seatIndex)}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* Fixed overlay: docked to the viewport corner, never part of the
          table's layout flow, so the felt never jumps in size when this
          shows, hides, or grows (e.g. the raise slider appearing). */}
      <div className="fixed inset-x-2 bottom-4 z-40 flex flex-col items-center gap-2 sm:inset-x-auto sm:bottom-6 sm:right-6 sm:items-end">
        <AnimatePresence>
          {isOwner && !snapshot?.handInProgress && activeSeats >= 2 && (
            <motion.button
              key="start-hand"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.96 }}
              transition={{ duration: 0.2 }}
              onClick={startHand}
              className="rounded-full bg-emerald-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-emerald-500"
            >
              Start hand
            </motion.button>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {mySeat && snapshot?.handInProgress && (
            <ActionControls key="action-controls" legalActions={legalActions} onAction={sendAction} />
          )}
        </AnimatePresence>
      </div>

      <LedgerModal tableId={tableId} open={ledgerOpen} onClose={() => setLedgerOpen(false)} />
    </main>
  );
}
