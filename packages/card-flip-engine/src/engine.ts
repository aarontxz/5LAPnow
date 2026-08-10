import { Card, createStandardDeck, secureRandom, shuffle } from "@5lapnow/cards";
import { activeSeats, nextButtonSeatIndex, TableState } from "@5lapnow/game-engine";
import { CardFlipPayment, CardFlipPlayerState, CardFlipRoundState } from "./state.js";
import { comparePartialHands, describePartialHand, evaluatePartialHand, isFourOfAKind, isStraightFlush } from "./scoring.js";
import { CardFlipGameDefinition } from "./gameDefinition.js";

export const MIN_CARD_FLIP_PLAYERS = 2;
export const PILE_COUNT = 3;

function applyPayment(table: TableState, payment: CardFlipPayment): void {
  const from = table.seats[payment.fromSeatIndex];
  const to = table.seats[payment.toSeatIndex];
  if (from) from.stack -= payment.amount;
  if (to) to.stack += payment.amount;
}

/**
 * Runs one "10 Card Flip" round: deal 3 shared draw piles. Each player, in
 * turn order, draws one card at a time (their choice of pile) and keeps
 * drawing — forced, not optional — until either their hand beats whoever
 * currently holds the strongest hand at the table (becoming the new leader,
 * ending their turn) or they hit the `cardsPerPlayer` cap without catching up
 * (their turn just ends, leader unchanged). Turn order cycles as many times
 * as it takes — a seat that hasn't hit the cap yet can come back around for
 * another turn — until every seat other than the current leader is capped
 * out, at which point nobody's left who could still dethrone them and the
 * round settles immediately, whoever is leader winning the stake from
 * everyone else.
 */
export class CardFlipEngine {
  constructor(private readonly rng: () => number = secureRandom) {}

  /** Production entry point: shuffles enough combined standard decks and deals. */
  startRound(table: TableState, roundNumber: number, config: CardFlipGameDefinition): CardFlipRoundState {
    const seats = activeSeats(table);
    const deckCount = Math.max(1, Math.ceil((config.cardsPerPlayer * seats.length) / 52));
    const cards = Array.from({ length: deckCount }, () => createStandardDeck({ jokers: 0 })).flat();
    const deck = shuffle(cards, this.rng);
    return this.startRoundWithDeck(table, roundNumber, config, deck);
  }

  /** Core deal logic, decoupled from shuffling so tests could hand-craft exact piles. */
  startRoundWithDeck(
    table: TableState,
    roundNumber: number,
    config: CardFlipGameDefinition,
    orderedDeck: Card[]
  ): CardFlipRoundState {
    const { cardsPerPlayer, stake } = config;
    const seats = activeSeats(table);
    if (seats.length < MIN_CARD_FLIP_PLAYERS) {
      throw new Error(`10 Card Flip requires at least ${MIN_CARD_FLIP_PLAYERS} players, got ${seats.length}`);
    }
    if (orderedDeck.length < cardsPerPlayer * seats.length) {
      throw new Error("Not enough cards to deal this round");
    }

    const button = nextButtonSeatIndex(table);
    table.buttonSeatIndex = button;
    const seatIndices = seats.map((s) => s.seatIndex);
    const buttonPos = seatIndices.indexOf(button);
    const turnOrder = [...seatIndices.slice(buttonPos), ...seatIndices.slice(0, buttonPos)];

    const deck = [...orderedDeck];
    const piles: Card[][] = [[], [], []];
    deck.forEach((card, i) => {
      (piles[i % PILE_COUNT] as Card[]).push(card);
    });

    const players: CardFlipPlayerState[] = turnOrder.map((seatIndex) => ({ seatIndex, hand: [] }));

    return {
      roundNumber,
      stake,
      cardsPerPlayer,
      bonusConfig: {
        unopenedCardBonus: config.unopenedCardBonus,
        straightFlushBonus: config.straightFlushBonus,
        fourOfAKindBonus: config.fourOfAKindBonus,
      },
      phase: "turn",
      piles,
      players,
      turnOrder,
      turnIndex: 0,
      leaderSeatIndex: null,
      actions: [{ type: "deal", seatIndices: turnOrder }],
      result: null,
    };
  }

  /**
   * On your turn: draw one card from the chosen pile (0, 1, or 2). Whether
   * your turn continues (you must draw again) or ends (control passes to the
   * next seat, or the round settles) is entirely determined by the
   * beat-the-leader rule — never a player choice.
   */
  draw(table: TableState, round: CardFlipRoundState, seatIndex: number, pileIndex: number): void {
    if (round.phase !== "turn") throw new Error("No action is available right now");
    if (round.turnOrder[round.turnIndex] !== seatIndex) throw new Error("It is not your turn");
    const pile = round.piles[pileIndex];
    if (!pile) throw new Error("Invalid pile");
    if (pile.length === 0) throw new Error("That pile is empty");

    const player = this.requirePlayer(round, seatIndex);
    const card = pile.pop() as Card;
    player.hand.push(card);
    round.actions.push({ type: "draw", seatIndex, pileIndex });

    const leader = round.leaderSeatIndex !== null ? this.requirePlayer(round, round.leaderSeatIndex) : null;
    const beatsLeader = leader === null || this.beats(player.hand, leader.hand);

    if (beatsLeader) {
      round.leaderSeatIndex = seatIndex;
    } else if (player.hand.length < round.cardsPerPlayer) {
      return; // hasn't caught up yet and still has room to keep drawing
    }
    // Either this player just took the lead, or they hit the cap without catching up — their turn is over either way.

    // Once every OTHER seat is capped out, nobody is left who could still
    // draw and dethrone the leader — more draws from the leader themselves
    // can't change the outcome (comparing their hand against their own
    // leader title never "beats" it), so settle immediately instead of
    // pointlessly cycling them through more forced draws.
    const leaderSeatIndex = round.leaderSeatIndex as number; // always set by now — the very first draw always sets it
    const othersStillInPlay = round.players.some(
      (p) => p.seatIndex !== leaderSeatIndex && p.hand.length < round.cardsPerPlayer
    );
    if (!othersStillInPlay) {
      this.settle(table, round);
      return;
    }

    // Find the next player who still needs cards.
    const n = round.turnOrder.length;
    for (let step = 1; step <= n; step++) {
      const candidateIndex = (round.turnIndex + step) % n;
      const candidateSeatIndex = round.turnOrder[candidateIndex] as number;
      const candidate = this.requirePlayer(round, candidateSeatIndex);
      if (candidate.hand.length < round.cardsPerPlayer) {
        round.turnIndex = candidateIndex;
        return;
      }
    }
  }

  /** True if `challengerHand` strictly beats `leaderHand` — works at any hand size (a pair beats no pair, three of a kind beats a pair, etc., even below 5 cards); a tie leaves the existing leader in place. */
  private beats(challengerHand: Card[], leaderHand: Card[]): boolean {
    return comparePartialHands(evaluatePartialHand(challengerHand), evaluatePartialHand(leaderHand)) > 0;
  }

  private requirePlayer(round: CardFlipRoundState, seatIndex: number): CardFlipPlayerState {
    const player = round.players.find((p) => p.seatIndex === seatIndex);
    if (!player) throw new Error(`Seat ${seatIndex} is not in this round`);
    return player;
  }

  /**
   * Whoever holds the leader title once every seat has had its turn wins the
   * stake from every other player outright, plus whatever bonuses the round's
   * config attaches: extra per card of `cardsPerPlayer` the winner never had
   * to draw (they held the lead before using up their allotted flips), and
   * flat bonuses if their final hand is a four of a kind or straight flush.
   */
  private settle(table: TableState, round: CardFlipRoundState): void {
    const winnerSeatIndex = round.leaderSeatIndex as number;
    const winner = this.requirePlayer(round, winnerSeatIndex);
    const unopenedCards = Math.max(0, round.cardsPerPlayer - winner.hand.length);
    let amount = round.stake + unopenedCards * round.bonusConfig.unopenedCardBonus;
    if (isStraightFlush(winner.hand)) amount += round.bonusConfig.straightFlushBonus;
    else if (isFourOfAKind(winner.hand)) amount += round.bonusConfig.fourOfAKindBonus;

    const payments: CardFlipPayment[] = [];
    for (const p of round.players) {
      if (p.seatIndex === winnerSeatIndex) continue;
      const payment: CardFlipPayment = { fromSeatIndex: p.seatIndex, toSeatIndex: winnerSeatIndex, amount };
      applyPayment(table, payment);
      payments.push(payment);
    }

    round.result = {
      winnerSeatIndices: [winnerSeatIndex],
      payments,
      reveal: round.players.map((p) => ({
        seatIndex: p.seatIndex,
        hand: p.hand,
        bestHandLabel: describePartialHand(p.hand),
      })),
    };
    round.phase = "complete";
    round.actions.push({ type: "complete" });
  }
}
