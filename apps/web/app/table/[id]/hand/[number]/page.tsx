"use client";

import { use, useEffect, useMemo, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { PublicSeatView } from "@5lapnow/shared-types";
import { api } from "@/lib/api";
import { loadSession } from "@/lib/session";
import { SeatView } from "@/components/table/SeatView";
import { Board } from "@/components/table/Board";
import { AnimatedNumber } from "@/components/table/AnimatedNumber";
import { ActionBar } from "@/components/table/ActionBar";
import { relativeSeatIndex, seatPosition, chipDirection } from "@/lib/seatLayout";

function noop(): void {}

export default function HandReplayPage({ params }: { params: Promise<{ id: string; number: string }> }) {
  const { id: tableId, number } = use(params);
  const handNumber = Number(number);
  const router = useRouter();
  const [replay, setReplay] = useState<Awaited<ReturnType<typeof api.getHandReplay>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [revealing, setRevealing] = useState(false);
  const [boardRaised, setBoardRaised] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setReplay(null);
    setError(null);
    setStepIndex(0); // fresh hand — always start from the beginning, whether arriving from the log or the prev/next hand buttons
    api
      .getHandReplay(tableId, handNumber)
      .then((r) => {
        if (!cancelled) setReplay(r);
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [tableId, handNumber]);

  const lastStepIndex = (replay?.steps.length ?? 1) - 1;

  const goBack = useCallback(() => setStepIndex((i) => Math.max(0, i - 1)), []);
  const goForward = useCallback(() => setStepIndex((i) => Math.min(lastStepIndex, i + 1)), [lastStepIndex]);
  const goToPreviousHand = useCallback(() => {
    if (replay?.previousHandNumber != null) router.push(`/table/${tableId}/hand/${replay.previousHandNumber}`);
  }, [replay, router, tableId]);
  const goToNextHand = useCallback(() => {
    if (replay?.nextHandNumber != null) router.push(`/table/${tableId}/hand/${replay.nextHandNumber}`);
  }, [replay, router, tableId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Left/Right step through this hand's actions; Up/Down jump to the
      // previous/next hand entirely — mirrors the two button pairs below.
      if (e.key === "ArrowLeft") goBack();
      else if (e.key === "ArrowRight") goForward();
      else if (e.key === "ArrowUp") goToPreviousHand();
      else if (e.key === "ArrowDown") goToNextHand();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goBack, goForward, goToPreviousHand, goToNextHand]);

  const session = loadSession();
  const mySeatIndex = useMemo(() => {
    if (!replay || !session) return null;
    return replay.players.find((p) => p.userId === session.userId)?.seatIndex ?? null;
  }, [replay, session]);

  const exitButton = (
    <Link
      href={`/table/${tableId}`}
      title="Exit replay"
      className="fixed left-4 top-4 z-30 flex items-center gap-1 rounded-full bg-white/10 px-3 py-2 text-sm text-white hover:bg-white/20"
    >
      ✕ <span className="hidden sm:inline">Exit replay</span>
    </Link>
  );

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-neutral-950 text-white/70">
        {exitButton}
        <p>Couldn&apos;t load this hand: {error}</p>
      </div>
    );
  }
  if (!replay) {
    return (
      <div className="flex h-screen items-center justify-center bg-neutral-950 text-white/50">
        {exitButton}
        <p>Loading hand #{handNumber}…</p>
      </div>
    );
  }

  const step = replay.steps[stepIndex] ?? replay.steps[0];
  if (!step) {
    return (
      <div className="flex h-screen items-center justify-center bg-neutral-950 text-white/50">
        {exitButton}
        <p>This hand has no recorded actions.</p>
      </div>
    );
  }
  const isLastStep = stepIndex === lastStepIndex;
  const canRevealRabbit = isLastStep && step.hand.rabbitBoard === null && (step.hand.boards ? step.hand.boards.some((b) => b.length < 5) : step.hand.board.length < 5);
  // null on every step but the last (results only ever populates there) — mirrors live play's
  // own `winners` computation exactly, including its "first matching pot share" simplification.
  const winnerShares = step.hand.results?.flatMap((pot) => [...pot.hiWinners, ...pot.loWinners]) ?? [];

  async function onRevealRabbit() {
    setRevealing(true);
    try {
      const { rabbitBoard, rabbitBoards } = await api.replayRevealRabbit(tableId, handNumber);
      setReplay((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          steps: prev.steps.map((s, i) => (i === prev.steps.length - 1 ? { ...s, hand: { ...s.hand, rabbitBoard, rabbitBoards } } : s)),
        };
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRevealing(false);
    }
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-neutral-950">
      {exitButton}
      <div className="absolute left-1/2 top-4 z-10 flex -translate-x-1/2 flex-col items-center gap-0.5 text-center">
        <p className="text-[11px] font-semibold text-white/60 sm:text-xs">
          Hand #{replay.handNumber} · {replay.gameName}
        </p>
        <p className="text-[10px] text-white/40">Replay</p>
      </div>

      {/* Same felt sizing/anchor as the live table page (app/table/[id]/page.tsx)
          — top-14 anchor with a shared, capped mobile height so it reserves
          exactly the space the bottom ActionBar below actually takes,
          instead of centering blind and letting that bar cover the cards. */}
      <div className="fixed left-1/2 top-14 aspect-[5/7] h-[min(78vh,calc(100vh_-_13.5rem))] w-auto max-w-[94vw] -translate-x-1/2 rounded-2xl border border-emerald-900/50 bg-gradient-to-b from-emerald-950 to-emerald-900 shadow-2xl sm:top-1/2 sm:aspect-[5/6] sm:h-[80vh] sm:max-w-[90vw] sm:-translate-y-1/2">
        <div
          className={`absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1 rounded-xl border p-1.5 transition-colors sm:gap-2 sm:p-2 ${
            boardRaised ? "z-30 border-white/25 bg-black/50 shadow-xl" : "z-10 border-white/10 bg-black/20"
          }`}
          onMouseEnter={() => setBoardRaised(true)}
          onMouseLeave={() => setBoardRaised(false)}
          onPointerDown={(e) => {
            if (e.pointerType === "mouse") return;
            setBoardRaised((cur) => !cur);
          }}
        >
          <Board
            board={step.hand.board}
            boards={step.hand.boards}
            rabbitBoard={step.hand.rabbitBoard}
            rabbitBoards={step.hand.rabbitBoards}
            canRabbitHunt={canRevealRabbit && !revealing}
            onRevealRabbit={onRevealRabbit}
          />
          <span className="rounded-full bg-black/40 px-3 py-1 text-xs text-white/70 sm:text-sm">
            Pot: <AnimatedNumber value={step.hand.pot} />
          </span>
        </div>

        {replay.players.map((identity) => {
          const relIndex = relativeSeatIndex(identity.seatIndex, mySeatIndex);
          const pos = seatPosition(relIndex);
          const handPlayer = step.hand.players.find((p) => p.seatIndex === identity.seatIndex);
          const committed = handPlayer?.totalContributed ?? 0;
          // Mid-hand: whatever's left after committing to the pot so far. Once the hand's
          // complete, use the real settled stack (accounts for the payout) instead.
          const stack = isLastStep ? identity.stackAfter ?? 0 : Math.max(0, (identity.stackBefore ?? 0) - committed);
          const seat: PublicSeatView = {
            seatIndex: identity.seatIndex,
            playerId: identity.userId,
            displayName: identity.displayName,
            stack,
            status: "active",
            pendingStackAdjustment: null,
            awayAfterHand: false,
          };
          // Only set on the final step (results is null everywhere else) — same
          // "first matching pot share" lookup live play uses, for consistency.
          const win = winnerShares.find((w) => w.seatIndex === identity.seatIndex);
          return (
            <div key={identity.seatIndex} className="absolute -translate-x-1/2 -translate-y-1/2" style={pos}>
              <SeatView
                seat={seat}
                isTurn={false}
                isViewer={identity.userId === session?.userId}
                viewerUserId={session?.userId ?? null}
                canSit={false}
                isOwner={false}
                roundInProgress={false}
                pendingRequest={undefined}
                winAmount={win?.amount}
                onRequest={noop}
                onApprove={noop}
                onReject={noop}
                onCancelRequest={noop}
                onAdjustStack={noop}
                onRemovePlayer={noop}
                onSetAway={noop}
                onTransferOwnership={noop}
                game={{
                  kind: "poker",
                  handPlayer,
                  isButton: false,
                  chipDirection: chipDirection(relIndex),
                  winDescription: win?.description ?? null,
                }}
              />
            </div>
          );
        })}
      </div>

      {/* Same ActionBar every live action panel uses (see ActionBar.tsx) — the
          fixed 10rem mobile height is exactly what the felt above reserves
          space for, so this bar can never end up covering the cards. */}
      <ActionBar centerItems>
        <p className="max-w-md text-center text-xs text-white/80">{step.description}</p>
        <div className="flex items-center gap-2">
          {/* Outer pair: jump to the previous/next hand entirely. */}
          <button
            onClick={goToPreviousHand}
            disabled={replay.previousHandNumber == null}
            title="Previous hand"
            className="rounded-full bg-white/5 px-3 py-2 text-sm text-white/70 disabled:opacity-20"
          >
            ⏮
          </button>

          {/* Inner pair: step through this hand's actions one at a time. */}
          <button
            onClick={goBack}
            disabled={stepIndex === 0}
            className="rounded-full bg-white/10 px-4 py-2 text-sm text-white disabled:opacity-30"
          >
            ← Back
          </button>
          <span className="text-xs text-white/50">
            {stepIndex + 1} / {replay.steps.length}
          </span>
          <button
            onClick={goForward}
            disabled={isLastStep}
            className="rounded-full bg-white/10 px-4 py-2 text-sm text-white disabled:opacity-30"
          >
            Forward →
          </button>

          <button
            onClick={goToNextHand}
            disabled={replay.nextHandNumber == null}
            title="Next hand"
            className="rounded-full bg-white/5 px-3 py-2 text-sm text-white/70 disabled:opacity-20"
          >
            ⏭
          </button>
        </div>
        <p className="text-[10px] text-white/30">
          ←/→ step this hand · ↑/↓ jump hands
          {canRevealRabbit && !revealing && " · click the empty board slots to reveal the rest"}
          {revealing && " · revealing…"}
        </p>
      </ActionBar>
    </div>
  );
}
