"use client";

import { use, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { PotShare } from "@5lapnow/game-engine";
import { saveSession, type Session } from "@/lib/session";
import { api } from "@/lib/api";
import { useTableSocket } from "@/lib/useTableSocket";
import { SeatView } from "@/components/table/SeatView";
import { ClangActionPanel } from "@/components/table/clang/ClangActionPanel";
import { CardFlipActionPanel } from "@/components/table/cardflip/CardFlipActionPanel";
import { PlayingCard } from "@/components/table/PlayingCard";
import { ActionControls } from "@/components/table/poker/ActionControls";
import { AnimatedNumber } from "@/components/table/AnimatedNumber";
import { LedgerModal } from "@/components/table/LedgerModal";
import { NextGamePicker } from "@/components/table/NextGamePicker";
import { relativeSeatIndex, seatPosition, chipDirection } from "@/lib/seatLayout";

function netForSeat(payments: Array<{ fromSeatIndex: number; toSeatIndex: number; amount: number }>, seatIndex: number): number {
  let net = 0;
  for (const p of payments) {
    if (p.toSeatIndex === seatIndex) net += p.amount;
    if (p.fromSeatIndex === seatIndex) net -= p.amount;
  }
  return net;
}

const CLANG_RANK_LABELS: Record<number, string> = { 11: "J", 12: "Q", 13: "K", 14: "A" };
function clangRankLabel(rank: number): string {
  return CLANG_RANK_LABELS[rank] ?? String(rank);
}

export default function TablePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: tableId } = use(params);
  const [session, setSession] = useState<Session | null>(null);
  // Socket only connects once the cookie is confirmed alive; null keeps it idle.
  const [readyTableId, setReadyTableId] = useState<string | null>(null);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [games, setGames] = useState<Array<{ id: string; name: string; description: string }>>([]);
  const {
    snapshot,
    error,
    isAuthError,
    retry,
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
    setNextGame,
    sendAction,
    revealRabbit,
    showCards,
    clangPlay,
    clangEat,
    clangPassEat,
    clangCallClang,
    clangCallClangInstant,
    cardFlipDraw,
  } = useTableSocket(readyTableId);

  // Validate the cookie before opening the socket — stale localStorage with an
  // expired cookie would let the page render but silently fail socket auth.
  useEffect(() => {
    function onSession(s: Session) {
      setSession(s);
      setReadyTableId(tableId);
      void api.listGames(s.userId).then((g) => setGames(g.map((x) => ({ id: x.id, name: x.name, description: x.description }))));
    }
    void api.me().then((me) => {
      if (me) {
        saveSession(me);
        onSession(me);
      } else {
        void api.createGuestSession({}).then((s) => {
          saveSession(s);
          onSession(s);
        });
      }
    });
  }, [tableId]);

  const hand = snapshot?.hand ?? null;
  const isComplete = hand?.phase === "complete";
  const winners: PotShare[] = isComplete && hand?.results ? hand.results.flatMap((pot) => [...pot.hiWinners, ...pot.loWinners]) : [];

  const [displayPot, setDisplayPot] = useState(0);
  useEffect(() => {
    if (!hand) { setDisplayPot(0); return; }
    if (hand.phase === "complete") {
      setDisplayPot(hand.pot);
      const timer = setTimeout(() => setDisplayPot(0), 900);
      return () => clearTimeout(timer);
    }
    setDisplayPot(hand.pot);
  }, [hand?.phase, hand?.pot, hand?.handNumber]);

  // Card Flip: the pile just drawn from shows the actual card, flip-revealed,
  // then turns back face-down BEFORE the card starts appearing in the
  // drawer's hand (see CARD_FLIP_HAND_DELAY_MS in SeatView.tsx) — the two
  // must never both be visible at once, or the same card reads as "in two
  // places" for that overlapping window.
  const CARD_FLIP_PILE_REVEAL_MS = 500;
  const cardFlipLastDrawnCard = snapshot?.cardFlipRound?.lastDrawnCard ?? null;
  const [revealedPile, setRevealedPile] = useState<{ pileIndex: number; card: NonNullable<typeof cardFlipLastDrawnCard> } | null>(null);
  useEffect(() => {
    const pileIndex = snapshot?.cardFlipRound?.lastDrawPileIndex ?? null;
    if (pileIndex === null || !cardFlipLastDrawnCard) return;
    setRevealedPile({ pileIndex, card: cardFlipLastDrawnCard });
    const timer = setTimeout(() => setRevealedPile(null), CARD_FLIP_PILE_REVEAL_MS);
    return () => clearTimeout(timer);
  }, [cardFlipLastDrawnCard?.rank, cardFlipLastDrawnCard?.suit]);

  // Clang: an Eat gets a banner + a chip-fly from discarder to eater, timed
  // to fade on its own (actionIndex keeps re-triggering it, since the same
  // discarder/eater/rank can repeat later in the round via a new chain).
  const EAT_BANNER_MS = 1800;
  const clangLastEat = snapshot?.clangRound?.lastEat ?? null;
  const [activeEat, setActiveEat] = useState<NonNullable<typeof clangLastEat> | null>(null);
  useEffect(() => {
    if (!clangLastEat) return;
    setActiveEat(clangLastEat);
    const timer = setTimeout(() => setActiveEat(null), EAT_BANNER_MS);
    return () => clearTimeout(timer);
  }, [clangLastEat?.actionIndex]);

  // 's' hotkey lets the owner start a hand without reaching for the button.
  useEffect(() => {
    const isOwnerNow = snapshot?.ownerId === session?.userId;
    const activeSeatCount = snapshot?.seats.filter((s) => s.status === "active").length ?? 0;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (e.key.toLowerCase() !== "s") return;
      if (isOwnerNow && !snapshot?.handInProgress && activeSeatCount >= 2) startHand();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [session?.userId, snapshot, startHand]);

  if (!session) return null;

  const mySeat = snapshot?.seats.find((s) => s.playerId === session.userId);
  const mySeatIndex = mySeat?.seatIndex ?? null;
  const isOwner = snapshot?.ownerId === session.userId;
  const board = hand?.board ?? [];
  const boards = hand?.boards ?? null;
  const rabbitBoard = hand?.rabbitBoard ?? null;
  const rabbitBoards = hand?.rabbitBoards ?? null;
  // Undealt slots stay clickable (per-viewer — others can't tell you've peeked) until
  // this viewer has rabbit hunted for themselves or the hand didn't reach a missed street.
  const canRabbitHunt =
    !!mySeat &&
    hand?.phase === "complete" &&
    rabbitBoard === null &&
    (boards ? boards.some((b) => b.length < 5) : board.length < 5);
  const legalActions = hand?.legalActions ?? null;
  const activeSeats = snapshot?.seats.filter((s) => s.status === "active").length ?? 0;
  // The middle pot display breaks out only the latest/current bet — every other
  // live bet this street (calls, earlier limps) is folded into the "before" number.
  const currentBet = !isComplete && hand ? hand.players.reduce((max, p) => Math.max(max, p.committedThisStreet), 0) : 0;
  const potBeforeStreet = displayPot - currentBet;

  const isClang = snapshot?.gameKind === "clang";
  const clangRound = snapshot?.clangRound ?? null;
  const clangRoundActive = clangRound !== null && clangRound.phase !== "complete";
  const myClangPlayer = clangRound?.players.find((p) => p.seatIndex === mySeatIndex);
  const clangPayments = clangRound?.result?.payments ?? [];

  const isCardFlip = snapshot?.gameKind === "cardflip";
  const cardFlipRound = snapshot?.cardFlipRound ?? null;
  const cardFlipRoundActive = cardFlipRound !== null && cardFlipRound.phase !== "complete";
  const cardFlipPayments = cardFlipRound?.result?.payments ?? [];

  async function copyShareLink() {
    const url = `${window.location.origin}/table/${tableId}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard API can be unavailable (older Safari, non-HTTPS, etc.) — fall back to a hidden textarea.
      const textarea = document.createElement("textarea");
      textarea.value = url;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 1500);
  }

  return (
    <main className="relative flex h-dvh flex-1 flex-col overflow-y-auto px-2 py-2 sm:px-6 sm:py-6">
      <header className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.96 }}
            onClick={() => setLedgerOpen(true)}
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/70 shadow-sm hover:border-white/20 hover:bg-white/10 hover:text-white sm:px-3.5 sm:py-2 sm:text-sm"
          >
            <span aria-hidden>📒</span>
            Log &amp; Ledger
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.96 }}
            onClick={copyShareLink}
            className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium shadow-sm transition-colors sm:px-3.5 sm:py-2 sm:text-sm ${
              linkCopied
                ? "border-emerald-400/50 bg-emerald-400/10 text-emerald-300"
                : "border-white/10 bg-white/5 text-white/70 hover:border-white/20 hover:bg-white/10 hover:text-white"
            }`}
          >
            <span aria-hidden>{linkCopied ? "✅" : "🔗"}</span>
            {linkCopied ? "Copied!" : "Share"}
          </motion.button>
        </div>
        <div className="flex items-center gap-2">
          {mySeat && (
            <>
              <button
                onClick={() => setSeatAway(mySeatIndex!, mySeat.status !== "sitting-out")}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                  mySeat.status === "sitting-out"
                    ? "border-amber-400/50 bg-amber-400/10 text-amber-300 hover:bg-amber-400/20"
                    : "border-white/10 bg-white/5 text-white/50 hover:border-white/20 hover:text-white/80"
                }`}
              >
                {mySeat.status === "sitting-out" ? "Back" : "Away"}
              </button>
              <button
                onClick={stand}
                disabled={mySeat.leavingAfterHand}
                className="rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/20 hover:text-red-300 disabled:cursor-default disabled:border-white/10 disabled:bg-transparent disabled:text-white/30"
              >
                {mySeat.leavingAfterHand ? "Leaving…" : "Stand up"}
              </button>
            </>
          )}
        </div>
      </header>

      {error && (
        <div className="flex items-center justify-center gap-2 text-center text-sm text-red-400">
          <span>{error}</span>
          {isAuthError && (
            <button
              onClick={retry}
              className="rounded-full border border-red-400/40 px-3 py-1 text-xs font-medium text-red-300 hover:bg-red-400/10"
            >
              Retry
            </button>
          )}
        </div>
      )}

      {/* The felt and the action panel below are true siblings in normal
          document flow — never a fixed overlay on top of the felt — so on a
          short viewport the page scrolls instead of the panel covering the
          viewer's own seat. */}
      <div className="flex min-h-0 flex-1 items-center justify-center py-2">
        <div className="relative aspect-[5/7] w-full max-w-md rounded-2xl border border-emerald-900/50 bg-gradient-to-b from-emerald-950 to-emerald-900 shadow-2xl sm:aspect-[5/6] sm:max-w-2xl">
          <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1 sm:gap-2">
            {isClang ? (
              <>
                <div className="flex flex-col items-center gap-0.5">
                  <p className="text-[11px] font-semibold text-white/60 sm:text-xs">Clang</p>
                  {snapshot?.ownerDisplayName && (
                    <p className="text-[10px] text-amber-200/60">
                      <span aria-hidden>👑</span> {snapshot.ownerDisplayName}
                    </p>
                  )}
                </div>
                {clangRound && (
                  <span className="rounded-full bg-black/40 px-3 py-1 text-xs text-white/70 sm:text-sm">
                    Stake {clangRound.stake} · Eat {clangRound.eatPaymentPerCard}/card
                  </span>
                )}
                {clangRound?.phase === "instant-window" && (
                  <span className="text-[10px] text-amber-300 sm:text-xs">Anyone with exactly 21 can call Clang!</span>
                )}
                {clangRound?.phase === "awaiting-eat" &&
                  clangRound.pendingEat &&
                  clangRound.pendingEat.eaterSeatIndex === mySeatIndex && (
                    <span className="text-[10px] text-amber-300 sm:text-xs">You can eat!</span>
                  )}
                <AnimatePresence>
                  {activeEat && (
                    <motion.div
                      key={`eat-banner-${clangRound?.roundNumber}-${activeEat.actionIndex}`}
                      initial={{ opacity: 0, scale: 0.8, y: -4 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.8 }}
                      transition={{ duration: 0.25 }}
                      className="rounded-full bg-amber-400 px-3 py-1 text-[10px] font-bold text-black shadow-[0_0_16px_rgba(251,191,36,0.6)] sm:text-xs"
                    >
                      {snapshot?.seats.find((s) => s.seatIndex === activeEat.eaterSeatIndex)?.displayName ?? "Someone"} ate{" "}
                      {snapshot?.seats.find((s) => s.seatIndex === activeEat.discarderSeatIndex)?.displayName ?? "someone"}&apos;s{" "}
                      {clangRankLabel(activeEat.rank)}s! +{activeEat.amount}
                    </motion.div>
                  )}
                </AnimatePresence>
                {clangRound && clangRound.topDiscard.length > 0 && (
                  <div className="flex flex-col items-center gap-0.5">
                    <div className="flex gap-0.5 sm:gap-1">
                      {clangRound.topDiscard.map((c, i) => (
                        <PlayingCard key={`discard-${i}-${c.rank}-${c.suit}`} card={c} small dealDelay={i * 0.08} />
                      ))}
                    </div>
                    <span className="text-[9px] text-white/40 sm:text-[10px]">
                      Discard{clangRound.discardPileCount > clangRound.topDiscard.length ? ` (${clangRound.discardPileCount})` : ""}
                    </span>
                  </div>
                )}
                <AnimatePresence>
                  {clangRound?.phase === "complete" && clangRound.result && (
                    <motion.div
                      key={`clang-result-${clangRound.roundNumber}`}
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.25 }}
                      className="flex flex-col items-center gap-0.5"
                    >
                      {clangRound.result.winnerSeatIndices.map((seatIndex) => {
                        const winnerSeat = snapshot?.seats.find((s) => s.seatIndex === seatIndex);
                        return (
                          <span key={seatIndex} className="text-[10px] text-emerald-300 sm:text-xs">
                            {winnerSeat?.displayName ?? `Seat ${seatIndex}`} wins
                          </span>
                        );
                      })}
                    </motion.div>
                  )}
                </AnimatePresence>
              </>
            ) : isCardFlip ? (
              <>
                <div className="flex flex-col items-center gap-0.5">
                  <p className="text-[11px] font-semibold text-white/60 sm:text-xs">10 Card Flip</p>
                  {snapshot?.ownerDisplayName && (
                    <p className="text-[10px] text-amber-200/60">
                      <span aria-hidden>👑</span> {snapshot.ownerDisplayName}
                    </p>
                  )}
                </div>
                {cardFlipRound && (
                  <span className="rounded-full bg-black/40 px-3 py-1 text-xs text-white/70 sm:text-sm">
                    Stake {cardFlipRound.stake} · beat the leader (max {cardFlipRound.cardsPerPlayer} cards)
                  </span>
                )}
                {cardFlipRound && cardFlipRound.phase === "turn" && (
                  <div className="flex items-center justify-center gap-2">
                    {cardFlipRound.pileCounts.map((count, i) => {
                      const revealedCard = revealedPile?.pileIndex === i ? revealedPile.card : null;
                      return (
                        <div key={i} className="flex flex-col items-center gap-0.5">
                          {/* Keyed by the card itself (each card is drawn at most once) so
                              PlayingCard remounts and replays its flip-in animation every
                              time this pile is the one just drawn from. */}
                          <PlayingCard
                            key={revealedCard ? `${revealedCard.rank}-${revealedCard.suit}` : "back"}
                            card={revealedCard}
                            small
                          />
                          <span className="text-[9px] text-white/40 sm:text-[10px]">{count} left</span>
                        </div>
                      );
                    })}
                  </div>
                )}
                <AnimatePresence>
                  {cardFlipRound?.phase === "complete" && cardFlipRound.result && (
                    <motion.div
                      key={`cardflip-result-${cardFlipRound.roundNumber}`}
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.25 }}
                      className="flex flex-col items-center gap-0.5"
                    >
                      {cardFlipRound.result.winnerSeatIndices.map((seatIndex) => {
                        const winnerSeat = snapshot?.seats.find((s) => s.seatIndex === seatIndex);
                        return (
                          <span key={seatIndex} className="text-[10px] text-emerald-300 sm:text-xs">
                            {winnerSeat?.displayName ?? `Seat ${seatIndex}`} wins
                          </span>
                        );
                      })}
                    </motion.div>
                  )}
                </AnimatePresence>
              </>
            ) : boards ? (
              <div className="flex flex-col gap-1">
                {boards.map((b, bi) => (
                  <div key={bi} className="flex gap-0.5 sm:gap-1" style={{ perspective: 800 }}>
                    {b.map((c, i) => (
                      <PlayingCard key={i} card={c} small dealDelay={i * 0.12} />
                    ))}
                    {(rabbitBoards?.[bi] ?? []).map((c, i) => (
                      <div key={`r-${i}`} className="opacity-40">
                        <PlayingCard card={c} small dealDelay={i * 0.08} />
                      </div>
                    ))}
                    {Array.from({ length: 5 - b.length - (rabbitBoards?.[bi]?.length ?? 0) }).map((_, i) =>
                      canRabbitHunt ? (
                        <button
                          key={`ph-${i}`}
                          onClick={revealRabbit}
                          title="Rabbit hunt: see the cards that would have come, just for you"
                          className="h-11 w-8 rounded-md border border-dashed border-amber-200/40 bg-amber-200/5 transition hover:border-amber-200/70 hover:bg-amber-200/10 sm:h-14 sm:w-10"
                        />
                      ) : (
                        <div key={`ph-${i}`} className="h-11 w-8 rounded-md border border-dashed border-white/10 sm:h-14 sm:w-10" />
                      )
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex gap-0.5 sm:gap-1" style={{ perspective: 800 }}>
                {board.map((c, i) => (
                  <PlayingCard key={i} card={c} small dealDelay={i * 0.12} />
                ))}
                {(rabbitBoard ?? []).map((c, i) => (
                  <div key={`r-${i}`} className="opacity-40">
                    <PlayingCard card={c} small dealDelay={i * 0.08} />
                  </div>
                ))}
                {Array.from({ length: 5 - board.length - (rabbitBoard?.length ?? 0) }).map((_, i) =>
                  canRabbitHunt ? (
                    <button
                      key={`ph-${i}`}
                      onClick={revealRabbit}
                      title="Rabbit hunt: see the cards that would have come, just for you"
                      className="h-11 w-8 rounded-md border border-dashed border-amber-200/40 bg-amber-200/5 transition hover:border-amber-200/70 hover:bg-amber-200/10 sm:h-14 sm:w-10"
                    />
                  ) : (
                    <div key={`ph-${i}`} className="h-11 w-8 rounded-md border border-dashed border-white/10 sm:h-14 sm:w-10" />
                  )
                )}
              </div>
            )}
            {!isClang && !isCardFlip && (
              <>
                <span className="rounded-full bg-black/40 px-3 py-1 text-xs text-white/70 sm:text-sm">
                  Pot: <AnimatedNumber value={potBeforeStreet} />
                  {currentBet > 0 && (
                    <>
                      {" + "}
                      <AnimatedNumber value={currentBet} />
                      {" = "}
                      <AnimatedNumber value={displayPot} />
                    </>
                  )}
                </span>
                <div className="flex flex-col items-center gap-0.5">
                  <p className="text-[11px] font-semibold text-white/60 sm:text-xs">{snapshot?.gameName}</p>
                  {snapshot?.ownerDisplayName && (
                    <p className="text-[10px] text-amber-200/60">
                      <span aria-hidden>👑</span> {snapshot.ownerDisplayName}
                    </p>
                  )}
                </div>
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
              </>
            )}
          </div>

          {/* Chips fly out from the pot to each winner once a hand settles; purely
              visual, keyed by hand number so it replays fresh on every showdown. */}
          <AnimatePresence>
            {!isClang &&
              isComplete &&
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

          {/* Clang: a chip travels straight from the discarder's seat to the
              eater's seat on every Eat — timed with the banner above (see
              activeEat/EAT_BANNER_MS), so it's obvious who just paid whom. */}
          <AnimatePresence>
            {isClang && activeEat && (
              <motion.div
                key={`eat-fly-${clangRound?.roundNumber}-${activeEat.actionIndex}`}
                initial={{
                  left: seatPosition(relativeSeatIndex(activeEat.discarderSeatIndex, mySeatIndex)).left,
                  top: seatPosition(relativeSeatIndex(activeEat.discarderSeatIndex, mySeatIndex)).top,
                  opacity: 1,
                  scale: 1,
                }}
                animate={{
                  left: seatPosition(relativeSeatIndex(activeEat.eaterSeatIndex, mySeatIndex)).left,
                  top: seatPosition(relativeSeatIndex(activeEat.eaterSeatIndex, mySeatIndex)).top,
                  opacity: 0,
                  scale: 0.6,
                }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.7, ease: "easeIn" }}
                className="pointer-events-none absolute z-30 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-400 px-2 py-1 text-[10px] font-bold text-black shadow-lg"
              >
                +{activeEat.amount}
              </motion.div>
            )}
          </AnimatePresence>

          {snapshot?.seats.map((seat) => {
            const relIndex = relativeSeatIndex(seat.seatIndex, mySeatIndex);
            const pos = seatPosition(relIndex);
            const pendingRequest = snapshot.pendingRequests.find((r) => r.seatIndex === seat.seatIndex);
            const commonProps = {
              seat,
              isViewer: seat.playerId === session.userId,
              viewerUserId: session.userId,
              canSit: !mySeat,
              isOwner,
              pendingRequest,
              defaultDisplayName: session.displayName,
              onRequest: (buyIn: number, displayName: string) => {
                requestSeat(seat.seatIndex, buyIn, displayName);
                // Optimistic — the server is the source of truth and will reject
                // this via action:error if the name turns out to be taken.
                const updated = { ...session, displayName };
                saveSession(updated);
                setSession(updated);
              },
              onApprove: approveRequest,
              onReject: rejectRequest,
              onCancelRequest: cancelRequest,
              onAdjustStack: (mode: "add" | "remove" | "set", amount: number) => adjustStack(seat.seatIndex, mode, amount),
              onRemovePlayer: () => removePlayer(seat.seatIndex),
              onSetAway: (away: boolean) => setSeatAway(seat.seatIndex, away),
              onTransferOwnership: () => transferOwnership(seat.seatIndex),
            };
            return (
              <div
                key={seat.seatIndex}
                className="absolute -translate-x-1/2 -translate-y-1/2"
                style={pos}
              >
                {isClang ? (
                  <SeatView
                    {...commonProps}
                    isTurn={clangRound?.turnSeatIndex === seat.seatIndex}
                    roundInProgress={clangRoundActive}
                    winAmount={clangRound?.phase === "complete" ? netForSeat(clangPayments, seat.seatIndex) : undefined}
                    game={{
                      kind: "clang",
                      clangPlayer: clangRound?.players.find((p) => p.seatIndex === seat.seatIndex),
                      isEatCandidate: seat.seatIndex === mySeatIndex && clangRound?.pendingEat?.eaterSeatIndex === seat.seatIndex,
                      isDiscarder: clangRound?.pendingEat?.discarderSeatIndex === seat.seatIndex,
                    }}
                  />
                ) : isCardFlip ? (
                  <SeatView
                    {...commonProps}
                    isTurn={cardFlipRound?.turnSeatIndex === seat.seatIndex}
                    roundInProgress={cardFlipRoundActive}
                    winAmount={cardFlipRound?.phase === "complete" ? netForSeat(cardFlipPayments, seat.seatIndex) : undefined}
                    game={{
                      kind: "cardflip",
                      cardFlipPlayer: cardFlipRound?.players.find((p) => p.seatIndex === seat.seatIndex),
                      isLeader: cardFlipRound?.leaderSeatIndex === seat.seatIndex,
                    }}
                  />
                ) : (
                  <SeatView
                    {...commonProps}
                    isTurn={hand?.turnSeatIndex === seat.seatIndex}
                    roundInProgress={snapshot.handInProgress}
                    winAmount={isComplete ? winners.find((w) => w.seatIndex === seat.seatIndex)?.amount : undefined}
                    game={{
                      kind: "poker",
                      handPlayer: hand?.players.find((p) => p.seatIndex === seat.seatIndex),
                      isButton: snapshot.buttonSeatIndex === seat.seatIndex,
                      chipDirection: chipDirection(relIndex),
                      winDescription: isComplete ? winners.find((w) => w.seatIndex === seat.seatIndex)?.description : undefined,
                      onShowCards: showCards,
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Normal-flow sibling below the felt — never a fixed overlay on top of
          it, so it can never cover a seat regardless of viewport height or
          how tall its own content gets (raise slider, wrapped play buttons). */}
      <div className="flex shrink-0 flex-col items-center gap-2 pb-2 pt-1 sm:items-end">
        {/* One "Start" control for both engines: the dropdown lists every game
            (poker variants and Clang alike), and starting deals whichever
            engine is currently active or queued — resolved server-side. */}
        <AnimatePresence>
          {isOwner && !snapshot?.handInProgress && activeSeats >= 2 && (
            <motion.div
              key="start-hand"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.2 }}
            >
              <NextGamePicker
                games={games}
                activeGameDefinitionId={snapshot?.nextGameDefinitionId}
                onSelect={setNextGame}
                onStart={startHand}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {isClang ? (
          <AnimatePresence>
            {mySeat && clangRound && clangRoundActive && (
              <ClangActionPanel
                key="clang-actions"
                hand={myClangPlayer?.hand ?? []}
                handValue={myClangPlayer?.handValue ?? null}
                legalActions={clangRound.legalActions}
                onPlay={clangPlay}
                onEat={clangEat}
                onPassEat={clangPassEat}
                onCallClang={clangCallClang}
                onCallClangInstant={clangCallClangInstant}
              />
            )}
          </AnimatePresence>
        ) : isCardFlip ? (
          <AnimatePresence>
            {mySeat && cardFlipRound && cardFlipRoundActive && (
              <CardFlipActionPanel
                key="cardflip-actions"
                pileCounts={cardFlipRound.pileCounts}
                legalActions={cardFlipRound.legalActions}
                onDraw={cardFlipDraw}
              />
            )}
          </AnimatePresence>
        ) : (
          <>
            <AnimatePresence>
              {mySeat && snapshot?.handInProgress && (
                <ActionControls
                  key="action-controls"
                  legalActions={legalActions}
                  pot={hand?.pot ?? 0}
                  currentBet={currentBet}
                  onAction={sendAction}
                />
              )}
            </AnimatePresence>
          </>
        )}
      </div>

      <LedgerModal tableId={tableId} open={ledgerOpen} onClose={() => setLedgerOpen(false)} />
    </main>
  );
}
