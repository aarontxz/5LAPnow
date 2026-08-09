import { Card, createStandardDeck, shuffle } from "@5lapnow/cards";
import { activeSeats, nextButtonSeatIndex, splitAmountEvenly, TableState } from "@5lapnow/game-engine";
import { classifyHand, handValue, type ClangBonusPayouts } from "./scoring.js";
import { ClangBonusHit, ClangPayment, ClangPlayerState, ClangRoundState } from "./state.js";

export const MIN_CLANG_PLAYERS = 2;
/** Above this many players, a single 52-card deck can't reliably support the game — a second deck is shuffled in. */
export const SECOND_DECK_THRESHOLD = 5;
const HAND_SIZE = 5;
const INSTANT_CLANG_VALUE = 21;

function extractRank(hand: Card[], rank: number): { removed: Card[]; remaining: Card[] } {
  const removed: Card[] = [];
  const remaining: Card[] = [];
  for (const c of hand) (c.rank === rank ? removed : remaining).push(c);
  return { removed, remaining };
}

function applyPayment(table: TableState, payment: ClangPayment): void {
  const from = table.seats[payment.fromSeatIndex];
  const to = table.seats[payment.toSeatIndex];
  // Overdraft is allowed by design — Clang is a scorekeeper, not a stack-limited
  // betting engine; a payment always applies in full even if it drives a stack negative.
  if (from) from.stack -= payment.amount;
  if (to) to.stack += payment.amount;
}

/**
 * Runs one Clang round: deal, instant-21 window, turn-based Play/Eat/Call Clang,
 * settlement. Mirrors DeclarativeEngine's constructor-injected-RNG pattern so
 * tests can seed shuffles deterministically.
 */
export class ClangEngine {
  constructor(private readonly rng: () => number = Math.random) {}

  /**
   * Production entry point: shuffles a fresh deck and deals. Uses two combined
   * 52-card decks when there are more than SECOND_DECK_THRESHOLD players, so
   * there's always enough cards to go around (no upper player limit beyond
   * however many seats the table itself allows).
   */
  startRound(
    table: TableState,
    roundNumber: number,
    stake: number,
    eatPaymentPerCard: number,
    bonusPayouts: ClangBonusPayouts = {}
  ): ClangRoundState {
    const deckCount = activeSeats(table).length > SECOND_DECK_THRESHOLD ? 2 : 1;
    const cards = Array.from({ length: deckCount }, () => createStandardDeck({ jokers: 0 })).flat();
    const deck = shuffle(cards, this.rng);
    return this.startRoundWithDeck(table, roundNumber, stake, eatPaymentPerCard, deck, bonusPayouts);
  }

  /** Core deal logic, decoupled from shuffling so tests can hand-craft exact hands. */
  startRoundWithDeck(
    table: TableState,
    roundNumber: number,
    stake: number,
    eatPaymentPerCard: number,
    orderedDeck: Card[],
    bonusPayouts: ClangBonusPayouts = {}
  ): ClangRoundState {
    const seats = activeSeats(table);
    if (seats.length < MIN_CLANG_PLAYERS) {
      throw new Error(`Clang requires at least ${MIN_CLANG_PLAYERS} players, got ${seats.length}`);
    }

    const button = nextButtonSeatIndex(table);
    table.buttonSeatIndex = button;
    const seatIndices = seats.map((s) => s.seatIndex);
    const buttonPos = seatIndices.indexOf(button);
    const turnOrder = [...seatIndices.slice(buttonPos), ...seatIndices.slice(0, buttonPos)];

    const deck = [...orderedDeck];
    const players: ClangPlayerState[] = turnOrder.map((seatIndex) => ({
      seatIndex,
      hand: deck.splice(0, HAND_SIZE),
    }));

    const bonusHits = this.applyBonusHits(table, players, bonusPayouts);

    return {
      roundNumber,
      stake,
      eatPaymentPerCard,
      phase: "instant-window",
      drawPile: deck,
      discardPile: [],
      lastDiscardCount: 0,
      players,
      turnOrder,
      turnIndex: 0,
      allowInstantClang: true,
      pendingEat: null,
      bonusHits,
      actions: [
        { type: "deal", seatIndices: turnOrder },
        ...bonusHits.map((h) => ({ type: "bonus" as const, seatIndex: h.seatIndex, category: h.category, payout: h.payout })),
      ],
      result: null,
    };
  }

  /**
   * Pays out any configured starting-hand bounties immediately at deal time —
   * every other seated player pays the payout to whoever was dealt that
   * category. Independent of the round's later outcome (does not end the round).
   */
  private applyBonusHits(table: TableState, players: ClangPlayerState[], bonusPayouts: ClangBonusPayouts): ClangBonusHit[] {
    const hits: ClangBonusHit[] = [];
    for (const player of players) {
      const category = classifyHand(player.hand);
      const payout = bonusPayouts[category];
      if (!payout) continue;

      const payments: ClangPayment[] = [];
      for (const other of players) {
        if (other.seatIndex === player.seatIndex) continue;
        const payment: ClangPayment = { fromSeatIndex: other.seatIndex, toSeatIndex: player.seatIndex, amount: payout };
        applyPayment(table, payment);
        payments.push(payment);
      }
      hits.push({ seatIndex: player.seatIndex, category, payout, payments });
    }
    return hits;
  }

  /** Out-of-turn: only legal during the instant-21 window, for a holder of exactly 21. */
  callInstantClang(table: TableState, round: ClangRoundState, seatIndex: number): void {
    if (round.phase !== "instant-window" || !round.allowInstantClang) {
      throw new Error("Instant Clang is not available right now");
    }
    const player = this.requirePlayer(round, seatIndex);
    if (handValue(player.hand) !== INSTANT_CLANG_VALUE) {
      throw new Error("You need exactly 21 points to call an instant Clang");
    }
    round.allowInstantClang = false;
    round.actions.push({ type: "callClangInstant", seatIndex });
    this.settleInstantWin(table, round, seatIndex);
  }

  /** On your turn: discard all cards of `rank`, draw immediately, then open the next player's Eat window if they can match it. */
  playRank(table: TableState, round: ClangRoundState, seatIndex: number, rank: number): void {
    this.requireTurn(round, seatIndex);
    const player = this.requirePlayer(round, seatIndex);
    const { removed, remaining } = extractRank(player.hand, rank);
    if (removed.length === 0) throw new Error(`You have no cards of rank ${rank}`);

    player.hand = remaining;
    round.discardPile.push(...removed);
    round.lastDiscardCount = removed.length;
    round.allowInstantClang = false;
    round.actions.push({ type: "play", seatIndex, rank, count: removed.length });

    // Draw immediately — the eat window (if any) opens after the draw.
    const drew = this.drawOne(table, round, seatIndex);
    if (!drew) return; // forced showdown triggered

    const eaterSeatIndex = round.turnOrder[(round.turnIndex + 1) % round.turnOrder.length] as number;
    const eater = this.requirePlayer(round, eaterSeatIndex);
    const eaterHasMatch = eater.hand.some((c) => c.rank === rank);

    if (eaterHasMatch) {
      round.phase = "awaiting-eat";
      round.pendingEat = { discarderSeatIndex: seatIndex, eaterSeatIndex, rank, chainDepth: 0 };
      return;
    }

    this.finishDiscarderTurn(round, { skipCount: 1 });
  }

  /** Only legal for the specific eligible next-player, and only if they actually hold a matching card. Starts or continues an eat chain — the original discarder pays all eaters. */
  eat(table: TableState, round: ClangRoundState, seatIndex: number): void {
    if (round.phase !== "awaiting-eat" || round.pendingEat?.eaterSeatIndex !== seatIndex) {
      throw new Error("You cannot Eat right now");
    }
    const { discarderSeatIndex, rank, chainDepth } = round.pendingEat;
    const eater = this.requirePlayer(round, seatIndex);
    const { removed, remaining } = extractRank(eater.hand, rank);
    if (removed.length === 0) throw new Error("You no longer hold a matching card");
    eater.hand = remaining;
    round.discardPile.push(...removed);
    round.lastDiscardCount = removed.length;

    const amount = round.eatPaymentPerCard * removed.length;
    applyPayment(table, { fromSeatIndex: discarderSeatIndex, toSeatIndex: seatIndex, amount });

    round.actions.push({ type: "eat", discarderSeatIndex, eaterSeatIndex: seatIndex, rank, count: removed.length });

    const newDepth = chainDepth + 1;
    // Check if the next player in the turn order can continue the eat chain.
    // The chain stops if the next candidate is the original discarder (can't eat from your own play).
    const eaterPosInOrder = round.turnOrder.indexOf(seatIndex);
    const nextCandidateIndex = (eaterPosInOrder + 1) % round.turnOrder.length;
    const nextCandidateSeatIndex = round.turnOrder[nextCandidateIndex] as number;
    const chainCanContinue = nextCandidateSeatIndex !== discarderSeatIndex;
    if (chainCanContinue) {
      const nextCandidate = this.requirePlayer(round, nextCandidateSeatIndex);
      if (nextCandidate.hand.some((c) => c.rank === rank)) {
        round.pendingEat = { discarderSeatIndex, eaterSeatIndex: nextCandidateSeatIndex, rank, chainDepth: newDepth };
        // phase stays "awaiting-eat"
        return;
      }
    }

    round.pendingEat = null;
    this.finishDiscarderTurn(round, { skipCount: newDepth + 1 });
  }

  /** Voluntary decline of an available Eat — the decliner's own normal turn still comes up right after. */
  passEat(table: TableState, round: ClangRoundState, seatIndex: number): void {
    if (round.phase !== "awaiting-eat" || round.pendingEat?.eaterSeatIndex !== seatIndex) {
      throw new Error("You cannot pass right now");
    }
    const { discarderSeatIndex, rank, chainDepth } = round.pendingEat;
    round.actions.push({ type: "eatDeclined", seatIndex, rank });
    round.pendingEat = null;
    this.finishDiscarderTurn(round, { skipCount: chainDepth + 1 });
  }

  /** On your turn, instead of playing: reveal all hands, lowest total wins. */
  callClangNormal(table: TableState, round: ClangRoundState, seatIndex: number): void {
    this.requireTurn(round, seatIndex);
    round.allowInstantClang = false;
    round.actions.push({ type: "callClang", seatIndex });
    this.settleShowdown(table, round, seatIndex, "call");
  }

  private requireTurn(round: ClangRoundState, seatIndex: number): void {
    if (round.phase !== "turn" && round.phase !== "instant-window") throw new Error("No action is available right now");
    if (round.turnOrder[round.turnIndex] !== seatIndex) throw new Error("It is not your turn");
  }

  private requirePlayer(round: ClangRoundState, seatIndex: number): ClangPlayerState {
    const player = round.players.find((p) => p.seatIndex === seatIndex);
    if (!player) throw new Error(`Seat ${seatIndex} is not in this round`);
    return player;
  }

  /**
   * Draws one card for `seatIndex` from the draw pile. If the pile is empty
   * (no reshuffle in this ruleset), the round force-ends in a neutral showdown
   * instead — returns false so the caller knows not to advance the turn.
   */
  private drawOne(table: TableState, round: ClangRoundState, seatIndex: number): boolean {
    if (round.drawPile.length === 0) {
      this.forcedShowdown(table, round);
      return false;
    }
    const card = round.drawPile.pop() as Card;
    const player = this.requirePlayer(round, seatIndex);
    player.hand.push(card);
    round.actions.push({ type: "draw", seatIndex });
    return true;
  }

  /**
   * Advances the turn by `skipCount` positions. The discarder already drew in `playRank`;
   * skipCount encodes: 1 = no eat, N+1 = N eaters in the chain (all their turns are skipped).
   */
  private finishDiscarderTurn(
    round: ClangRoundState,
    opts: { skipCount: number }
  ): void {
    round.turnIndex = (round.turnIndex + opts.skipCount) % round.turnOrder.length;
    round.phase = "turn";
  }

  private forcedShowdown(table: TableState, round: ClangRoundState): void {
    round.pendingEat = null;
    round.allowInstantClang = false;
    round.actions.push({ type: "forcedShowdown" });
    this.settleShowdown(table, round, null, "forced");
  }

  /**
   * Instant-21 settlement: hitting exactly 21 wins UNCONDITIONALLY — unlike a
   * normal Call Clang, this never compares hands (the caller could easily not
   * hold the numerically lowest hand at the table and still wins by rule).
   */
  private settleInstantWin(table: TableState, round: ClangRoundState, winnerSeatIndex: number): void {
    const payments: ClangPayment[] = [];
    for (const p of round.players) {
      if (p.seatIndex === winnerSeatIndex) continue;
      const payment: ClangPayment = { fromSeatIndex: p.seatIndex, toSeatIndex: winnerSeatIndex, amount: round.stake };
      applyPayment(table, payment);
      payments.push(payment);
    }

    round.result = {
      type: "instant",
      callerSeatIndex: winnerSeatIndex,
      winnerSeatIndices: [winnerSeatIndex],
      payments,
      reveal: round.players.map((p) => ({ seatIndex: p.seatIndex, hand: p.hand, value: handValue(p.hand) })),
    };
    round.phase = "complete";
  }

  /**
   * Shared settlement for a normal Call Clang or a forced (deck-exhaustion)
   * showdown — both compare hands and the lowest total wins. `callerSeatIndex`
   * is null for a forced showdown, which uses a neutral tie-split with no
   * caller favoritism; otherwise the caller wins outright if they're among
   * the tied-lowest, or pays the full multiple (split across the tied-lowest)
   * if not.
   */
  private settleShowdown(
    table: TableState,
    round: ClangRoundState,
    callerSeatIndex: number | null,
    type: "call" | "forced"
  ): void {
    const values = round.players.map((p) => ({ seatIndex: p.seatIndex, value: handValue(p.hand) }));
    const lowest = Math.min(...values.map((v) => v.value));
    const tiedLowest = values.filter((v) => v.value === lowest).map((v) => v.seatIndex);

    const payments: ClangPayment[] = [];
    let winners: number[];

    if (callerSeatIndex !== null && tiedLowest.includes(callerSeatIndex)) {
      winners = [callerSeatIndex];
      for (const p of round.players) {
        if (p.seatIndex === callerSeatIndex) continue;
        payments.push({ fromSeatIndex: p.seatIndex, toSeatIndex: callerSeatIndex, amount: round.stake });
      }
    } else if (callerSeatIndex !== null) {
      winners = tiedLowest;
      const totalOwed = round.stake * (round.players.length - 1);
      for (const share of splitAmountEvenly(totalOwed, tiedLowest, round.turnOrder)) {
        payments.push({ fromSeatIndex: callerSeatIndex, toSeatIndex: share.seatIndex, amount: share.amount });
      }
    } else {
      winners = tiedLowest;
      for (const loser of round.players) {
        if (tiedLowest.includes(loser.seatIndex)) continue;
        for (const share of splitAmountEvenly(round.stake, tiedLowest, round.turnOrder)) {
          payments.push({ fromSeatIndex: loser.seatIndex, toSeatIndex: share.seatIndex, amount: share.amount });
        }
      }
    }

    for (const payment of payments) applyPayment(table, payment);

    round.result = {
      type,
      callerSeatIndex,
      winnerSeatIndices: winners,
      payments,
      reveal: round.players.map((p) => ({ seatIndex: p.seatIndex, hand: p.hand, value: handValue(p.hand) })),
    };
    round.phase = "complete";
  }
}
