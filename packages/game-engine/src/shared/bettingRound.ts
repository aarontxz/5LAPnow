import { Seat, TableState } from "./table.js";
import { HandPlayerState, HandState, currentStreetName, totalPot } from "./handState.js";

export type PlayerAction =
  | { type: "fold" }
  | { type: "check" }
  | { type: "call" }
  | { type: "bet"; toAmount: number }
  | { type: "raise"; toAmount: number };

export interface LegalActionInfo {
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  callAmount: number;
  canBetOrRaise: boolean;
  minRaiseTo: number;
  maxRaiseTo: number;
  /**
   * The true, structure-unlimited all-in "toAmount" — committedThisStreet +
   * the player's entire remaining stack. Equals `maxRaiseTo` under no-limit
   * (nothing else can cap it there), but under pot-limit `maxRaiseTo` may sit
   * strictly below this when the pot cap binds before the stack does — i.e.
   * whenever `maxRaiseTo < allInTo`, going fully all-in isn't actually a
   * legal action; the most a player can commit is `maxRaiseTo`. Callers
   * (e.g. an "All-in" button) should treat all-in as unavailable in that
   * case rather than silently submitting a smaller amount under an "all-in"
   * label.
   */
  allInTo: number;
}

function commitChips(seat: Seat, player: HandPlayerState, amount: number): void {
  if (amount > seat.stack) throw new Error(`Seat ${seat.seatIndex} cannot commit ${amount}, only has ${seat.stack}`);
  seat.stack -= amount;
  player.committedThisStreet += amount;
  player.totalContributed += amount;
  if (seat.stack === 0) player.allIn = true;
}

/**
 * Standard pot-limit max raise-to amount: currentBet + (pot size after this
 * player calls), where "pot size after calling" is everything already
 * committed this hand (all streets, all players) plus the call itself.
 * Still floored by the player's actual stack. Must be computed before
 * `commitChips` mutates `totalContributed` for this action.
 */
function potLimitMaxRaiseTo(table: TableState, hand: HandState, seatIndex: number): number {
  const seat = table.seats[seatIndex];
  const player = hand.players.get(seatIndex);
  const round = hand.bettingRound;
  if (!seat || !player || !round) return 0;
  const callAmount = Math.min(Math.max(0, round.currentBet - player.committedThisStreet), seat.stack);
  const potAfterCall = totalPot(hand) + callAmount;
  const maxRaiseToAmount = round.currentBet + potAfterCall;
  return Math.min(maxRaiseToAmount, player.committedThisStreet + seat.stack);
}

export function postForcedBet(table: TableState, hand: HandState, seatIndex: number, amount: number): void {
  const seat = table.seats[seatIndex];
  const player = hand.players.get(seatIndex);
  if (!seat || !player) return;
  const committed = Math.min(amount, seat.stack);
  commitChips(seat, player, committed);
  if (committed > 0) {
    hand.actions.push({ streetName: currentStreetName(hand), seatIndex, type: "post", amount: committed });
  }
}

export function getLegalActions(table: TableState, hand: HandState, seatIndex: number): LegalActionInfo {
  const seat = table.seats[seatIndex];
  const player = hand.players.get(seatIndex);
  const none: LegalActionInfo = {
    canFold: false,
    canCheck: false,
    canCall: false,
    callAmount: 0,
    canBetOrRaise: false,
    minRaiseTo: 0,
    maxRaiseTo: 0,
    allInTo: 0,
  };
  if (!seat || !player || player.folded || player.allIn || !hand.bettingRound) return none;

  const round = hand.bettingRound;
  const callAmount = Math.max(0, round.currentBet - player.committedThisStreet);
  const canCheck = callAmount === 0;
  const canCall = callAmount > 0;
  const allInTo = player.committedThisStreet + seat.stack;
  const maxRaiseTo = hand.gameDefinition.bettingStructure === "pot-limit" ? potLimitMaxRaiseTo(table, hand, seatIndex) : allInTo;
  const minRaiseTo = Math.min(maxRaiseTo, round.currentBet + round.minRaiseIncrement);
  const canBetOrRaise = seat.stack > 0 && maxRaiseTo > round.currentBet;

  return {
    canFold: true,
    canCheck,
    canCall,
    callAmount: Math.min(callAmount, seat.stack),
    canBetOrRaise,
    minRaiseTo,
    maxRaiseTo,
    allInTo,
  };
}

export function nextToActSeatIndex(hand: HandState, afterSeatIndex: number): number | null {
  const order = hand.seatOrder;
  const startIdx = order.indexOf(afterSeatIndex);
  for (let step = 1; step <= order.length; step++) {
    const idx = order[(startIdx + step) % order.length] as number;
    const p = hand.players.get(idx);
    if (p && !p.folded && !p.allIn) return idx;
  }
  return null;
}

export function applyAction(table: TableState, hand: HandState, seatIndex: number, action: PlayerAction): void {
  const round = hand.bettingRound;
  if (!round) throw new Error("No betting round in progress");
  if (round.turnSeatIndex !== seatIndex) throw new Error("Not this player's turn");
  const seat = table.seats[seatIndex];
  const player = hand.players.get(seatIndex);
  if (!seat || !player) throw new Error(`Invalid seat ${seatIndex}`);

  let loggedAmount: number | null = null;

  switch (action.type) {
    case "fold": {
      player.folded = true;
      break;
    }
    case "check": {
      if (player.committedThisStreet !== round.currentBet) {
        throw new Error("Cannot check when facing a bet");
      }
      break;
    }
    case "call": {
      const callAmount = Math.min(round.currentBet - player.committedThisStreet, seat.stack);
      if (callAmount < 0) throw new Error("Nothing to call");
      commitChips(seat, player, callAmount);
      loggedAmount = callAmount;
      break;
    }
    case "bet":
    case "raise": {
      const { toAmount } = action;
      if (toAmount <= round.currentBet) throw new Error("Bet/raise must exceed the current bet");
      const increment = toAmount - player.committedThisStreet;
      if (increment > seat.stack) throw new Error("Cannot bet/raise more than the stack");
      if (hand.gameDefinition.bettingStructure === "pot-limit") {
        const maxTo = potLimitMaxRaiseTo(table, hand, seatIndex);
        if (toAmount > maxTo) throw new Error(`Bet/raise to ${toAmount} exceeds pot-limit max of ${maxTo}`);
      }

      const raiseSize = toAmount - round.currentBet;
      const isFullRaise = raiseSize >= round.minRaiseIncrement;
      const previousCurrentBet = round.currentBet;

      commitChips(seat, player, increment);
      round.currentBet = Math.max(round.currentBet, toAmount);
      loggedAmount = toAmount;

      if (isFullRaise || previousCurrentBet === 0) {
        round.minRaiseIncrement = raiseSize;
        round.lastAggressorSeatIndex = seatIndex;
        for (const p of hand.players.values()) {
          if (p.seatIndex !== seatIndex && !p.folded && !p.allIn) p.hasActedThisRound = false;
        }
      }
      // Short all-in raises raise the amount to call but don't reopen action
      // for players who already matched the previous bet.
      break;
    }
  }

  hand.actions.push({ streetName: currentStreetName(hand), seatIndex, type: action.type, amount: loggedAmount });

  player.hasActedThisRound = true;
  round.turnSeatIndex = nextToActSeatIndex(hand, seatIndex);
}

export function isBettingRoundClosed(hand: HandState): boolean {
  if (!hand.bettingRound) return true;
  const contestants = [...hand.players.values()].filter((p) => !p.folded);
  if (contestants.length <= 1) return true;
  const stillToAct = contestants.filter((p) => !p.allIn);
  if (stillToAct.length === 0) return true;
  return stillToAct.every((p) => p.hasActedThisRound && p.committedThisStreet === hand.bettingRound!.currentBet);
}

/**
 * Begins a betting round. Callers must handle `committedThisStreet` themselves
 * beforehand: leave it as-is for preflop (forced bets already posted via
 * `postForcedBet`), or call `resetStreetContributions` first for later streets.
 */
export function startBettingRound(
  hand: HandState,
  firstToActSeatIndex: number | null,
  minRaiseIncrement: number,
  carryOverCurrentBet = 0
): void {
  for (const p of hand.players.values()) {
    if (!p.folded) p.hasActedThisRound = false;
  }
  hand.bettingRound = {
    currentBet: carryOverCurrentBet,
    minRaiseIncrement,
    turnSeatIndex: firstToActSeatIndex,
    lastAggressorSeatIndex: null,
  };
}

export function resetStreetContributions(hand: HandState): void {
  for (const p of hand.players.values()) {
    p.committedThisStreet = 0;
  }
}
