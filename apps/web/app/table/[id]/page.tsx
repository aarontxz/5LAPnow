"use client";

import { use, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { PotShare } from "@5lapnow/game-engine";
import type { ChatMessageView } from "@5lapnow/shared-types";
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
import { ChatPanel } from "@/components/table/ChatPanel";
import { NextGamePicker } from "@/components/table/NextGamePicker";
import { FIXED_ACTION_BAR_RESERVE_CLASS } from "@/components/table/ActionBar";
import { relativeSeatIndex, seatPosition, chipDirection } from "@/lib/seatLayout";
import { cn } from "@/lib/cn";

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
  const [chatOpen, setChatOpen] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [games, setGames] = useState<Array<{ id: string; name: string; description: string }>>([]);
  // Seats near each other can overlap on small screens (SeatView's width/hand-fan
  // grows past the felt's per-seat spacing) — raising one above its neighbors on
  // hover (desktop) or tap (touch) lets it be read in full. Each seat's wrapper
  // div gets its own stacking context (it has a `transform` for centering), so
  // this has to live here and drive that wrapper's z-index rather than anything
  // inside SeatView.
  const [raisedSeatIndex, setRaisedSeatIndex] = useState<number | null>(null);
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
    chatMessages,
    lastLiveMessage,
    sendChatMessage,
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

  // Chat: track how many messages have been "seen" (panel open while they
  // arrived) so the button can show an unread badge, and surface a transient
  // toast with the latest message for anyone who never opens the panel.
  const [readChatCount, setReadChatCount] = useState(0);
  useEffect(() => {
    if (chatOpen) setReadChatCount(chatMessages.length);
  }, [chatOpen, chatMessages.length]);
  const unreadChatCount = chatOpen ? 0 : chatMessages.length - readChatCount;

  const CHAT_TOAST_MS = 4000;
  const [chatToast, setChatToast] = useState<ChatMessageView | null>(null);
  useEffect(() => {
    // Keyed off lastLiveMessage specifically (not the chatMessages array) so
    // this only ever fires for a message that just arrived live — table:join
    // replaying history (e.g. on every reconnect) must never pop a toast for
    // something said before this client even connected.
    if (!lastLiveMessage || chatOpen) return;
    setChatToast(lastLiveMessage);
    const timer = setTimeout(() => setChatToast(null), CHAT_TOAST_MS);
    return () => clearTimeout(timer);
  }, [lastLiveMessage, chatOpen]);

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

  // Rendered in two places at once (mobile in-flow header/footer vs. desktop
  // fixed corners below) — pulled into functions instead of duplicating JSX
  // literally. Each call mounts its own independent instance; only one of
  // the two is ever visually shown per breakpoint (the other's wrapper is
  // `hidden`), matching the split-tree pattern ChatPanel already uses.
  function renderMenuButtons() {
    return (
      <>
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
          <span aria-hidden>{linkCopied ? "" : "🔗"}</span>
          {linkCopied ? "Copied!" : "Share"}
        </motion.button>
        <motion.button
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.96 }}
          onClick={() => setChatOpen(true)}
          className="relative flex shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/70 shadow-sm hover:border-white/20 hover:bg-white/10 hover:text-white sm:px-3.5 sm:py-2 sm:text-sm"
        >
          <span aria-hidden>💬</span>
          Chat
          {unreadChatCount > 0 && (
            <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-purple-500 px-1 text-[9px] font-bold text-white">
              {unreadChatCount}
            </span>
          )}
        </motion.button>
      </>
    );
  }

  function renderSeatControls() {
    if (!mySeat) return null;
    return (
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
    );
  }

  // One "Start" control for both engines: the dropdown lists every game
  // (poker variants and Clang/Card Flip alike), and starting deals whichever
  // engine is currently active or queued — resolved server-side.
  function renderStartControl() {
    return (
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
    );
  }

  function renderActionPanel() {
    if (isClang) {
      return (
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
      );
    }
    if (isCardFlip) {
      return (
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
      );
    }
    return (
      <AnimatePresence>
        {mySeat && snapshot?.handInProgress && (
          <ActionControls key="action-controls" legalActions={legalActions} pot={hand?.pot ?? 0} currentBet={currentBet} onAction={sendAction} />
        )}
      </AnimatePresence>
    );
  }

  return (
    <main className="relative h-dvh w-full overflow-hidden">
      {/* Corner-docked chrome around a table that fills the screen, mirroring
          a traditional poker-room UI — viewer controls top-left, Log/Share/
          Chat top-right, Start control + live turn actions stacked
          bottom-right. Same layout at every breakpoint (just tighter offsets
          on phones), so PC and phone match — and both menu buttons and the
          own-seat controls stay up top, clear of the action panel/raise
          slider growing at the bottom. Each corner is `fixed` and lives
          outside the felt's own centering, so none of this ever competes
          with the table for layout space or nudges it off-center. */}
      <div className="pointer-events-none fixed inset-0 z-30">
        <div className="pointer-events-auto absolute left-2 top-2 flex max-w-[55vw] flex-wrap items-center gap-1.5 sm:left-6 sm:top-6 sm:max-w-none sm:gap-2">
          {renderSeatControls()}
        </div>
        <div className="pointer-events-auto absolute right-2 top-2 flex max-w-[60vw] flex-wrap items-center justify-end gap-1.5 sm:right-6 sm:top-6 sm:max-w-none sm:gap-2">
          {renderMenuButtons()}
        </div>
        {/* Start only shows before a hand/round starts, the action panel only
            once one is running — mutually exclusive in time, so they never
            fight for the same spot even though they're positioned
            separately below. The start control is centered on phones (it's
            the one control a seated player is most likely to reach for
            one-handed) but docks bottom-right from `sm:` up to match the
            action panel and the rest of the corner-docked chrome. */}
        <div className="pointer-events-auto absolute inset-x-0 bottom-2 flex justify-center sm:inset-x-auto sm:bottom-6 sm:right-6 sm:justify-end">
          {renderStartControl()}
        </div>
        <div className="pointer-events-auto absolute bottom-2 right-2 flex max-w-[92vw] flex-col items-end gap-2 sm:bottom-6 sm:right-6 sm:max-w-none">
          {renderActionPanel()}
        </div>
      </div>

      {/* Latest message flashes here for anyone who never opens the chat
          panel — chatOpen already suppresses this (see the effect above),
          so it never doubles up with the panel's own message list. Fixed
          (not a normal flex child) so it overlaps the felt instead of
          pushing it down when it appears. */}
      <AnimatePresence>
        {chatToast && (
          <div className="pointer-events-none fixed inset-x-0 top-16 z-40 flex justify-center px-2 sm:top-20">
            <motion.button
              key={chatToast.id}
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              onClick={() => setChatOpen(true)}
              className="pointer-events-auto flex w-fit max-w-[90vw] items-center gap-2 rounded-full bg-purple-500 px-3 py-1.5 text-xs text-white shadow-[0_0_16px_rgba(168,85,247,0.6)] hover:bg-purple-400"
            >
              <span className="shrink-0 font-bold">{chatToast.displayName}:</span>
              <span className="truncate">{chatToast.body}</span>
            </motion.button>
          </div>
        )}
      </AnimatePresence>

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

      {/* The felt is always fixed. No surrounding chrome is ever a
          normal-flow sibling of it (see the corner-docked chrome above,
          which folds the action panel into its bottom-right corner), so
          nothing can ever nudge it off-center or compete with it for layout
          space. Dead-centered on the viewport normally — but Clang/Card
          Flip's action panel becomes a fixed-height (10rem) full-width bar
          pinned to the bottom of the screen on phones (unlike poker's,
          which never grows there), so on mobile those two reserve that
          strip via top/bottom insets instead of centering over it. Desktop
          never has this problem (that panel is just a small corner card
          there), so sm+ always reverts to true centering. */}
      <div
        className={`fixed left-1/2 aspect-[5/7] w-auto max-w-[94vw] -translate-x-1/2 rounded-2xl border border-emerald-900/50 bg-gradient-to-b from-emerald-950 to-emerald-900 shadow-2xl sm:left-1/2 sm:top-1/2 sm:aspect-[5/6] sm:h-[80vh] sm:max-w-[90vw] sm:-translate-y-1/2 sm:bottom-auto ${
          isClang || isCardFlip ? `top-20 ${FIXED_ACTION_BAR_RESERVE_CLASS}` : "top-1/2 h-[78vh] -translate-y-1/2"
        }`}
      >
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
                className={cn(
                  "absolute -translate-x-1/2 -translate-y-1/2",
                  raisedSeatIndex === seat.seatIndex ? "z-20" : "z-0"
                )}
                style={pos}
                onMouseEnter={() => setRaisedSeatIndex(seat.seatIndex)}
                onMouseLeave={() => setRaisedSeatIndex((cur) => (cur === seat.seatIndex ? null : cur))}
                onPointerDown={(e) => {
                  // Only touch/pen taps toggle here — mouse is already handled by
                  // hover above, and letting a click also toggle would immediately
                  // un-raise a seat the cursor is still hovering (mouseenter already
                  // fired, so there's no second enter event to re-raise it).
                  if (e.pointerType === "mouse") return;
                  setRaisedSeatIndex((cur) => (cur === seat.seatIndex ? null : seat.seatIndex));
                }}
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
                      cardsPerPlayer: cardFlipRound?.cardsPerPlayer ?? 0,
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

      <LedgerModal tableId={tableId} open={ledgerOpen} onClose={() => setLedgerOpen(false)} />
      <ChatPanel open={chatOpen} onClose={() => setChatOpen(false)} messages={chatMessages} viewerUserId={session.userId} onSend={sendChatMessage} />
    </main>
  );
}
