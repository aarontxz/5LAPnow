import { Card, Deck, secureRandom } from "@5lapnow/cards";
import { GameDefinition } from "./gameDefinition.js";
import { activeSeats, nextButtonSeatIndex, TableState } from "./table.js";
import {
  HandPlayerState,
  HandState,
  activeHandPlayers,
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
      }
    }
    if (street.dealCommunityCards > 0) {
      hand.deck.burn();
      if (hand.boards.length > 1) {
        for (const b of hand.boards) b.push(...hand.deck.draw(street.dealCommunityCards));
        hand.board = hand.boards.flat();
      } else {
        hand.board.push(...hand.deck.draw(street.dealCommunityCards));
      }
    }

    const remaining = activeHandPlayers(hand);
    if (remaining.length <= 1) {
      hand.phase = "showdown";
      hand.bettingRound = null;
      return;
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
      // All-in runout or a street with no betting: keep dealing until showdown.
      hand.bettingRound = null;
      this.dealAndMaybeStartRound(table, hand);
    }
  }

  getLegalActions(table: TableState, hand: HandState, seatIndex: number): LegalActionInfo {
    return getBettingLegalActions(table, hand, seatIndex);
  }

  applyAction(table: TableState, hand: HandState, seatIndex: number, action: PlayerAction): void {
    if (hand.phase !== "betting") throw new Error("Hand is not in a betting phase");
    applyBettingAction(table, hand, seatIndex, action);
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
