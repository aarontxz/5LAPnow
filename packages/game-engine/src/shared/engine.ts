import { Card, Deck, secureRandom } from "@5lapnow/cards";
import { GameDefinition } from "./gameDefinition.js";
import { activeSeats, nextButtonSeatIndex, TableState } from "./table.js";
import {
  HandPlayerState,
  HandState,
  activeHandPlayers,
  currentStreetName,
  orderSeatsFromButton,
} from "./handState.js";
import {
  PlayerAction,
  applyAction as applyBettingAction,
  getLegalActions as getBettingLegalActions,
  isBettingRoundClosed,
  nextToActSeatIndex,
  postForcedBet,
  resetStreetContributions,
  startBettingRound,
  LegalActionInfo,
} from "./bettingRound.js";
import { settleShowdown } from "./pots.js";
import { ShowdownResult } from "./handState.js";

/**
 * Executes any GameDefinition — hardcoded or AI-generated — against a table.
 * There is exactly one implementation of this class; per-variant behavior
 * comes entirely from the data in `gameDefinition`.
 */
export class DeclarativeEngine {
  constructor(
    private readonly gameDefinition: GameDefinition,
    private readonly rng: () => number = secureRandom
  ) {}

  initHand(table: TableState, handNumber: number): HandState {
    const eligible = activeSeats(table);
    if (eligible.length < 2) throw new Error("Need at least 2 active seats to start a hand");

    const buttonSeatIndex = nextButtonSeatIndex(table);
    table.buttonSeatIndex = buttonSeatIndex;
    const seatOrder = orderSeatsFromButton(table.seats, buttonSeatIndex);
    const deck = new Deck({ jokers: this.gameDefinition.deck.jokers, rng: this.rng });

    const players = new Map<number, HandPlayerState>();
    for (const seatIndex of seatOrder) {
      players.set(seatIndex, {
        seatIndex,
        holeCards: [],
        folded: false,
        allIn: false,
        totalContributed: 0,
        committedThisStreet: 0,
        hasActedThisRound: false,
        shown: false,
        foldedHoleCards: null,
      });
    }

    const boardArrays: Card[][] = Array.from({ length: this.gameDefinition.boards }, () => [] as Card[]);

    const hand: HandState = {
      gameDefinition: this.gameDefinition,
      handNumber,
      buttonSeatIndex,
      streetIndex: -1,
      board: boardArrays[0]!,
      boards: boardArrays,
      rabbitBoard: null,
      rabbitBoards: null,
      rabbitRevealedSeats: new Set(),
      deck,
      players,
      seatOrder,
      bettingRound: null,
      phase: "betting",
      results: null,
      actions: [],
    };

    const preflopFirstActor = this.postForcedBets(table, hand);
    this.dealAndMaybeStartRound(table, hand, preflopFirstActor);
    return hand;
  }

  /** Returns the seat that acts first preflop (left of the big blind). */
  private postForcedBets(table: TableState, hand: HandState): number | null {
    const { forcedBets } = this.gameDefinition;
    const order = hand.seatOrder;

    if (forcedBets.ante > 0) {
      for (const seatIndex of order) postForcedBet(table, hand, seatIndex, forcedBets.ante);
    }

    let bbSeatIndex: number;
    if (order.length === 2) {
      // Heads-up: the button posts the small blind.
      postForcedBet(table, hand, hand.buttonSeatIndex, forcedBets.smallBlind);
      bbSeatIndex = order.find((s) => s !== hand.buttonSeatIndex) as number;
      postForcedBet(table, hand, bbSeatIndex, forcedBets.bigBlind);
    } else {
      const sbSeatIndex = order[0] as number;
      bbSeatIndex = order[1] as number;
      postForcedBet(table, hand, sbSeatIndex, forcedBets.smallBlind);
      postForcedBet(table, hand, bbSeatIndex, forcedBets.bigBlind);
    }

    return nextToActSeatIndex(hand, bbSeatIndex);
  }

  private dealAndMaybeStartRound(table: TableState, hand: HandState, preflopFirstActor?: number | null): void {
    hand.streetIndex += 1;
    const street = this.gameDefinition.streets[hand.streetIndex];
    if (!street) {
      hand.phase = "showdown";
      hand.bettingRound = null;
      return;
    }

    if (street.dealHoleCards > 0) {
      for (const seatIndex of hand.seatOrder) {
        const player = hand.players.get(seatIndex);
        if (!player || player.folded) continue;
        player.holeCards.push(...hand.deck.draw(street.dealHoleCards));
        hand.actions.push({
          streetName: currentStreetName(hand),
          type: "dealHoleCards",
          seatIndex,
          count: street.dealHoleCards,
        });
      }
    }
    if (street.dealCommunityCards > 0) {
      hand.deck.burn();
      if (hand.boards.length > 1) {
        hand.boards.forEach((b, boardIndex) => {
          const cards = hand.deck.draw(street.dealCommunityCards);
          b.push(...cards);
          hand.actions.push({ streetName: currentStreetName(hand), type: "dealCommunityCards", boardIndex, cards });
        });
        hand.board = hand.boards.flat();
      } else {
        const cards = hand.deck.draw(street.dealCommunityCards);
        hand.board.push(...cards);
        hand.actions.push({ streetName: currentStreetName(hand), type: "dealCommunityCards", boardIndex: 0, cards });
      }
    }

    const remaining = activeHandPlayers(hand);
    if (remaining.length <= 1) {
      hand.phase = "showdown";
      hand.bettingRound = null;
      return;
    }

    if (street.redrawHoleCardsTo !== undefined) {
      this.performRedraw(hand, street.redrawHoleCardsTo);
    }

    const contestantsWhoCanAct = remaining.filter((p) => !p.allIn);
    if (street.bettingRound && contestantsWhoCanAct.length > 1) {
      const bigBlind = this.gameDefinition.forcedBets.bigBlind || 1;
      if (hand.streetIndex === 0) {
        startBettingRound(hand, preflopFirstActor ?? null, bigBlind, bigBlind);
      } else {
        resetStreetContributions(hand);
        const firstActor = nextToActSeatIndex(hand, hand.buttonSeatIndex);
        startBettingRound(hand, firstActor, bigBlind, 0);
      }
    } else {
      // All-in runout or a deal-only street: stop here instead of dealing every
      // remaining street in one uninterrupted burst — see `hasMoreDealing` /
      // `continueDealing`, which let the caller pace the reveal (e.g. a brief
      // pause per street) since there's no player input gating the pace here.
      hand.bettingRound = null;
    }
  }

  /**
   * True once dealing has paused mid-runout — a street was just dealt with
   * nothing left for anyone to decide (all-in, or a deal-only street), but
   * the hand hasn't reached showdown yet. Only ever true right after
   * `initHand`/`applyAction`/`continueDealing` returns; never true while
   * waiting on a real player decision. Callers should call `continueDealing`
   * again — ideally after a short pause — until this goes false.
   */
  hasMoreDealing(hand: HandState): boolean {
    return hand.phase === "betting" && hand.bettingRound === null;
  }

  /** Deals exactly the next street (see `hasMoreDealing`). Call in a loop until `hasMoreDealing` returns false. */
  continueDealing(table: TableState, hand: HandState): void {
    this.dealAndMaybeStartRound(table, hand);
  }

  /** Cards still needed for every future street's guaranteed community-card deal (burn + per-board cards), so redraw never eats into supply community dealing depends on. */
  private reservedForFutureCommunityDeals(hand: HandState): number {
    let reserve = 0;
    for (let i = hand.streetIndex + 1; i < this.gameDefinition.streets.length; i++) {
      const s = this.gameDefinition.streets[i];
      if (s && s.dealCommunityCards > 0) reserve += 1 + s.dealCommunityCards * hand.boards.length;
    }
    return reserve;
  }

  /**
   * Tops every active player's hole cards up toward `target`, deck
   * permitting — but community-card dealing on future streets always takes
   * priority, so redraw only ever spends what's left after reserving enough
   * for every remaining street's community deal. If what's left can't cover
   * every player's full owed amount, every active player instead draws the
   * same (smaller) amount — floor(available / activePlayerCount) — and the
   * shortfall carries forward as a larger "owed" gap at the next redraw.
   */
  private performRedraw(hand: HandState, target: number): void {
    const activeSeatIndices = hand.seatOrder.filter((seatIndex) => {
      const player = hand.players.get(seatIndex);
      return player && !player.folded;
    });
    if (activeSeatIndices.length === 0) return;

    const owed = new Map<number, number>();
    let totalOwed = 0;
    for (const seatIndex of activeSeatIndices) {
      const player = hand.players.get(seatIndex) as HandPlayerState;
      const amount = Math.max(0, target - player.holeCards.length);
      owed.set(seatIndex, amount);
      totalOwed += amount;
    }
    if (totalOwed === 0) return;

    const available = Math.max(0, hand.deck.remaining - this.reservedForFutureCommunityDeals(hand));

    if (available >= totalOwed) {
      for (const seatIndex of activeSeatIndices) {
        const amount = owed.get(seatIndex) as number;
        if (amount === 0) continue;
        const player = hand.players.get(seatIndex) as HandPlayerState;
        player.holeCards.push(...hand.deck.draw(amount));
        hand.actions.push({ streetName: currentStreetName(hand), type: "redraw", seatIndex, count: amount });
      }
      return;
    }

    const perPlayer = Math.floor(available / activeSeatIndices.length);
    if (perPlayer === 0) return;
    for (const seatIndex of activeSeatIndices) {
      const player = hand.players.get(seatIndex) as HandPlayerState;
      player.holeCards.push(...hand.deck.draw(perPlayer));
      hand.actions.push({ streetName: currentStreetName(hand), type: "redraw", seatIndex, count: perPlayer });
    }
  }

  getLegalActions(table: TableState, hand: HandState, seatIndex: number): LegalActionInfo {
    return getBettingLegalActions(table, hand, seatIndex);
  }

  applyAction(table: TableState, hand: HandState, seatIndex: number, action: PlayerAction): void {
    if (hand.phase !== "betting") throw new Error("Hand is not in a betting phase");
    applyBettingAction(table, hand, seatIndex, action);
    if (action.type === "fold" && this.gameDefinition.reshuffleFoldedCardsIntoDeck) {
      const player = hand.players.get(seatIndex);
      if (player) {
        // Snapshot for history before the physical cards go back into the deck —
        // the reshuffle is about live dealing supply, not a privacy decision, so
        // there's no reason folding here should also make the hand unrecoverable.
        player.foldedHoleCards = [...player.holeCards];
        hand.deck.returnAndShuffle(player.holeCards);
        player.holeCards = [];
      }
    }
    if (isBettingRoundClosed(hand)) {
      hand.bettingRound = null;
      const remaining = activeHandPlayers(hand);
      if (remaining.length <= 1) {
        hand.phase = "showdown";
      } else {
        this.dealAndMaybeStartRound(table, hand);
      }
    }
  }

  evaluateShowdown(table: TableState, hand: HandState): ShowdownResult {
    if (hand.phase !== "showdown") throw new Error("Hand is not ready for showdown");
    const result = settleShowdown(table, hand);
    hand.results = result;
    hand.phase = "complete";
    return result;
  }
}
