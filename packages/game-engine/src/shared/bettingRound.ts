import { Seat, TableState } from "./table.js";
import { HandPlayerState, HandState, currentStreetName } from "./handState.js";

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
}

function commitChips(seat: Seat, player: HandPlayerState, amount: number): void {
  if (amount > seat.stack) throw new Error(`Seat ${seat.seatIndex} cannot commit ${amount}, only has ${seat.stack}`);
  seat.stack -= amount;
  player.committedThisStreet += amount;
  player.totalContributed += amount;
  if (seat.stack === 0) player.allIn = true;
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
  };
  if (!seat || !player || player.folded || player.allIn || !hand.bettingRound) return none;

  const round = hand.bettingRound;
  const callAmount = Math.max(0, round.currentBet - player.committedThisStreet);
  const canCheck = callAmount === 0;
  const canCall = callAmount > 0;
  const maxRaiseTo = player.committedThisStreet + seat.stack;
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
