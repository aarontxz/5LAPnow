import { Card, createStandardDeck, secureRandom, shuffle } from "@5lapnow/cards";
import { activeSeats, nextButtonSeatIndex, splitAmountEvenly, TableState } from "@5lapnow/game-engine";
import { classifyHand, handValue, type ClangBonusPayouts } from "./scoring.js";
import { ClangBonusHit, ClangPayment, ClangPhase, ClangPlayerState, ClangRoundState } from "./state.js";

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

function totalStacks(table: TableState): number {
  return table.seats.reduce((sum, s) => sum + s.stack, 0);
}

/**
 * Applies every payment, then asserts the table's total chip count is
 * unchanged — a list of {from, to, amount} triples is zero-sum by
 * construction, so this can only fail if a payment's seat somehow didn't
 * resolve to a real Seat object. Throws rather than silently proceeding,
 * since a violation here means chips were created or destroyed.
 */
function applyPaymentsConservatively(table: TableState, roundNumber: number, payments: ClangPayment[]): void {
  const before = totalStacks(table);
  for (const payment of payments) applyPayment(table, payment);
  const after = totalStacks(table);
  if (after !== before) {
    throw new Error(
      `Clang settlement violated chip conservation for round ${roundNumber}: total stacks ${before} -> ${after}`
    );
  }
}

/**
 * Runs one Clang round: deal, instant-21 window, turn-based Play/Eat/Call Clang,
 * settlement. Mirrors DeclarativeEngine's constructor-injected-RNG pattern so
 * tests can seed shuffles deterministically.
 */
export class ClangEngine {
  constructor(private readonly rng: () => number = secureRandom) {}

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
    // Tag each card with which physical deck it came from only once there
    // actually are multiple (deckCount > 1) — otherwise-identical cards
    // (same rank+suit) can then still be told apart everywhere a Card flows
    // to (hand rendering keys, cardsEqual). A single-deck round leaves every
    // card's deckIndex undefined, same as any other game.
    const cards = Array.from({ length: deckCount }, (_, deckIndex) =>
      createStandardDeck({ jokers: 0, deckIndex: deckCount > 1 ? deckIndex : undefined })
    ).flat();
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

    const bonusHits = this.applyBonusHits(table, roundNumber, players, bonusPayouts);

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
      instantClangClosedSeats: [],
      pendingEat: null,
      emptyHandSeatIndex: null,
      deckExhausted: false,
      bonusHits,
      actions: [
        {
          type: "deal",
          seatIndices: turnOrder,
          hands: players.map((p) => ({ seatIndex: p.seatIndex, hand: p.hand })),
        },
        ...bonusHits.map((h) => ({ type: "bonus" as const, seatIndex: h.seatIndex, category: h.category, payout: h.payout })),
      ],
      result: null,
      settled: false,
    };
  }

  /**
   * Pays out any configured starting-hand bounties immediately at deal time —
   * every other seated player pays the payout to whoever was dealt that
   * category. Independent of the round's later outcome (does not end the round).
   */
  private applyBonusHits(
    table: TableState,
    roundNumber: number,
    players: ClangPlayerState[],
    bonusPayouts: ClangBonusPayouts
  ): ClangBonusHit[] {
    const hits: ClangBonusHit[] = [];
    for (const player of players) {
      const category = classifyHand(player.hand);
      const payout = bonusPayouts[category];
      if (!payout) continue;

      const payments: ClangPayment[] = [];
      for (const other of players) {
        if (other.seatIndex === player.seatIndex) continue;
        payments.push({ fromSeatIndex: other.seatIndex, toSeatIndex: player.seatIndex, amount: payout });
      }
      applyPaymentsConservatively(table, roundNumber, payments);
      hits.push({ seatIndex: player.seatIndex, category, payout, payments });
    }
    return hits;
  }

  /** Out-of-turn: legal any time before this seat's own first turn, for a holder of exactly 21. */
  callInstantClang(table: TableState, round: ClangRoundState, seatIndex: number): void {
    if (round.phase === "complete" || round.instantClangClosedSeats.includes(seatIndex)) {
      throw new Error("Instant Clang is not available right now");
    }
    const player = this.requirePlayer(round, seatIndex);
    if (handValue(player.hand) !== INSTANT_CLANG_VALUE) {
      throw new Error("You need exactly 21 points to call an instant Clang");
    }
    round.actions.push({ type: "callClangInstant", seatIndex });
    this.settleInstantWin(table, round, seatIndex);
  }

  /**
   * On your turn, before you may discard: draw one card from the pile if
   * there's one left. Must be the first thing you do — `playRank` then
   * discards from this now-6-card hand, so you always get to see what you
   * drew before choosing what to throw. Checked AFTER the draw, not before:
   * whoever draws the pile's actual last card still gets it (a normal
   * draw), and it's THEIR turn — not the next player's — that becomes the
   * round's last possible one. 
   */
  draw(table: TableState, round: ClangRoundState, seatIndex: number): void {
    this.requireTurn(round, seatIndex, ["turn", "instant-window"]);
    this.requireNoOutstandingInstantClang(round);
    this.closeInstantClangWindow(round, seatIndex);
    if (round.drawPile.length > 0) {
      this.drawOne(round, seatIndex);
    }
    if (round.drawPile.length === 0) {
      round.deckExhausted = true;
    }
    round.phase = "awaiting-discard";
  }

  /** After drawing: discard all cards of `rank` from your hand, then open the next player's Eat window if they can match it. */
  playRank(table: TableState, round: ClangRoundState, seatIndex: number, rank: number): void {
    this.requireTurn(round, seatIndex, ["awaiting-discard"]);
    const player = this.requirePlayer(round, seatIndex);
    const { removed, remaining } = extractRank(player.hand, rank);
    if (removed.length === 0) throw new Error(`You have no cards of rank ${rank}`);

    player.hand = remaining;
    round.discardPile.push(...removed);
    round.lastDiscardCount = removed.length;
    round.actions.push({ type: "play", seatIndex, rank, count: removed.length, cards: removed });
    if (remaining.length === 0 && round.emptyHandSeatIndex === null) {
      round.emptyHandSeatIndex = seatIndex;
    }

    const eaterSeatIndex = round.turnOrder[(round.turnIndex + 1) % round.turnOrder.length] as number;
    const eater = this.requirePlayer(round, eaterSeatIndex);
    const eaterHasMatch = eater.hand.some((c) => c.rank === rank);

    if (eaterHasMatch) {
      // The eat decision is the eater's own turn now, not a suspended version
      // of the discarder's — advancing turnIndex here (rather than leaving it
      // on the discarder until the whole chain resolves) is what lets
      // `turnOrder[turnIndex]` correctly point at whoever actually has a
      // decision pending at every step, eat chains included.
      round.turnIndex = (round.turnIndex + 1) % round.turnOrder.length;
      round.phase = "awaiting-eat";
      round.pendingEat = { discarderSeatIndex: seatIndex, eaterSeatIndex, rank, chainDepth: 0 };
      return;
    }

    this.finishDiscarderTurn(table, round, { skipCount: 1 });
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
    this.closeInstantClangWindow(round, seatIndex);
    eater.hand = remaining;
    round.discardPile.push(...removed);
    round.lastDiscardCount = removed.length;
    if (remaining.length === 0 && round.emptyHandSeatIndex === null) {
      round.emptyHandSeatIndex = seatIndex;
    }

    const amount = round.eatPaymentPerCard * removed.length;
    applyPaymentsConservatively(table, round.roundNumber, [{ fromSeatIndex: discarderSeatIndex, toSeatIndex: seatIndex, amount }]);

    round.actions.push({ type: "eat", discarderSeatIndex, eaterSeatIndex: seatIndex, rank, count: removed.length, amount, cards: removed });

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
        // Same reasoning as playRank above: the decision has moved on to the
        // next eater in the chain, so turnIndex moves with it.
        round.turnIndex = nextCandidateIndex;
        round.pendingEat = { discarderSeatIndex, eaterSeatIndex: nextCandidateSeatIndex, rank, chainDepth: newDepth };
        // phase stays "awaiting-eat"
        return;
      }
    }

    round.pendingEat = null;
    // turnIndex is already sitting on the eater who just finished the chain
    // (advanced as we went, above) — one more step reaches whoever's next.
    this.finishDiscarderTurn(table, round, { skipCount: 1 });
  }

  /** Voluntary decline of an available Eat — the decliner's own normal turn still comes up right after. */
  passEat(table: TableState, round: ClangRoundState, seatIndex: number): void {
    if (round.phase !== "awaiting-eat" || round.pendingEat?.eaterSeatIndex !== seatIndex) {
      throw new Error("You cannot pass right now");
    }
    const { rank } = round.pendingEat;
    round.actions.push({ type: "eatDeclined", seatIndex, rank });
    round.pendingEat = null;
    // turnIndex is already sitting on the decliner (advanced when their eat
    // window opened) — their own turn is what comes next, so it doesn't move.
    this.finishDiscarderTurn(table, round, { skipCount: 0 });
  }

  /** On your turn, instead of drawing: reveal all hands, lowest total wins. Only available before you've drawn — once you draw you're committed to discarding. */
  callClangNormal(table: TableState, round: ClangRoundState, seatIndex: number): void {
    this.requireTurn(round, seatIndex, ["turn", "instant-window"]);
    this.requireNoOutstandingInstantClang(round);
    this.closeInstantClangWindow(round, seatIndex);
    round.actions.push({ type: "callClang", seatIndex });
    this.settleShowdown(table, round, seatIndex, "call");
  }

  private requireTurn(round: ClangRoundState, seatIndex: number, allowedPhases: ClangPhase[]): void {
    if (!allowedPhases.includes(round.phase)) throw new Error("No action is available right now");
    if (round.turnOrder[round.turnIndex] !== seatIndex) throw new Error("It is not your turn");
  }

  /** A seat's instant-Clang eligibility ends the moment they take their own first turn action. */
  private closeInstantClangWindow(round: ClangRoundState, seatIndex: number): void {
    if (!round.instantClangClosedSeats.includes(seatIndex)) round.instantClangClosedSeats.push(seatIndex);
  }

  /**
   * Seats that still hold an uncalled instant-Clang-eligible 21 — the same
   * set Draw and Call Clang block on (see `requireNoOutstandingInstantClang`).
   * Exposed publicly so a caller with an away-seat auto-play loop (see
   * ClangService.resolveAwayTurns) can call `callInstantClang` on such a
   * seat's behalf when it's the only thing unblocking the round, rather than
   * stalling forever behind an AFK player's natural 21.
   */
  outstandingInstantClangSeats(round: ClangRoundState): number[] {
    return round.players
      .filter((p) => !round.instantClangClosedSeats.includes(p.seatIndex) && handValue(p.hand) === INSTANT_CLANG_VALUE)
      .map((p) => p.seatIndex);
  }

  /**
   * Blocks Draw and Call Clang (the two ways a turn can otherwise close
   * someone's instant-Clang window or move the round along) while any seat
   * anywhere at the table still holds exactly 21 with their own window still
   * open — including the seat about to act, who should be pressing Instant
   * Clang instead. Since this always fires on the round's very first turn
   * before anyone else gets one, blocking it here blocks the whole round:
   * nobody can act until every outstanding instant Clang is called.
   */
  private requireNoOutstandingInstantClang(round: ClangRoundState): void {
    if (this.outstandingInstantClangSeats(round).length > 0) {
      throw new Error("A player can still call an instant Clang — wait for them to act first");
    }
  }

  private requirePlayer(round: ClangRoundState, seatIndex: number): ClangPlayerState {
    const player = round.players.find((p) => p.seatIndex === seatIndex);
    if (!player) throw new Error(`Seat ${seatIndex} is not in this round`);
    return player;
  }

  /** Draws one card for `seatIndex` from the draw pile. Caller (`draw`) has already confirmed the pile is non-empty. */
  private drawOne(round: ClangRoundState, seatIndex: number): void {
    const card = round.drawPile.pop() as Card;
    const player = this.requirePlayer(round, seatIndex);
    player.hand.push(card);
    round.actions.push({ type: "draw", seatIndex, card });
  }

  /**
   * Advances the turn by `skipCount` positions from wherever `turnIndex`
   * currently sits. By the time this is called, `turnIndex` has already been
   * kept in sync with whoever most recently had a live decision (the
   * discarder during their own turn; each eater in turn during an eat chain
   * — see `playRank`/`eat`), so callers only ever pass 1 (advance past
   * whoever that was, to the next real turn — a normal no-eat completion, or
   * an eat chain that just ended) or 0 (stay put — a decline, since the
   * decliner's own turn is what comes next and `turnIndex` is already on
   * them). Checked first, ahead of everything else: if any seat's hand
   * emptied out during the Play/Eat sequence that just finished (see
   * `emptyHandSeatIndex`), the round ends right here as that seat's win —
   * nobody gets to draw again, even if the deck was also exhausted this same
   * turn. Otherwise, if this turn's draw left the pile empty — whether it
   * found the pile already empty, or drew the actual last card out of it
   * (`deckExhausted`) — the round instead ends right here in a forced
   * showdown — this was the round's last possible turn.
   */
  private finishDiscarderTurn(
    table: TableState,
    round: ClangRoundState,
    opts: { skipCount: number }
  ): void {
    if (round.emptyHandSeatIndex !== null) {
      this.settleEmptyHandWin(table, round);
      return;
    }
    if (round.deckExhausted) {
      this.forcedShowdown(table, round);
      return;
    }
    round.turnIndex = (round.turnIndex + opts.skipCount) % round.turnOrder.length;
    round.phase = "turn";
  }

  private forcedShowdown(table: TableState, round: ClangRoundState): void {
    round.pendingEat = null;
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
      payments.push({ fromSeatIndex: p.seatIndex, toSeatIndex: winnerSeatIndex, amount: round.stake });
    }
    applyPaymentsConservatively(table, round.roundNumber, payments);

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
   * Settles a round ended by a seat emptying its hand (see
   * `emptyHandSeatIndex`) — an outright win like an instant Clang: every
   * other seat pays the winner `stake`, with no hand-value comparison (an
   * empty hand would trivially be the lowest anyway, but this is decided by
   * who got there first, not by value).
   */
  private settleEmptyHandWin(table: TableState, round: ClangRoundState): void {
    const winnerSeatIndex = round.emptyHandSeatIndex as number;
    const payments: ClangPayment[] = [];
    for (const p of round.players) {
      if (p.seatIndex === winnerSeatIndex) continue;
      payments.push({ fromSeatIndex: p.seatIndex, toSeatIndex: winnerSeatIndex, amount: round.stake });
    }
    applyPaymentsConservatively(table, round.roundNumber, payments);

    round.actions.push({ type: "emptyHand", seatIndex: winnerSeatIndex });
    round.result = {
      type: "emptyHand",
      callerSeatIndex: null,
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

    applyPaymentsConservatively(table, round.roundNumber, payments);

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
