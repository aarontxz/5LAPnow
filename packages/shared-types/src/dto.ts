import type { Card } from "@5lapnow/cards";
import type { SeatStatus, HandPhase, PotResult, LegalActionInfo } from "@5lapnow/game-engine";
import type { ClangHandCategory, ClangPayment, ClangPhase } from "@5lapnow/clang-engine";
import type { CardFlipPayment, CardFlipPhase } from "@5lapnow/card-flip-engine";
import type { TableGameKind } from "./rest.js";

export interface ChatMessageView {
  id: string;
  userId: string;
  /** Snapshotted at send time — stays accurate even if the sender's name changes later. */
  displayName: string;
  body: string;
  createdAt: string;
}

export interface PublicSeatView {
  seatIndex: number;
  playerId: string | null;
  displayName: string | null;
  stack: number;
  status: SeatStatus;
  /** Owner queued a stack change while a hand was in progress; takes effect when the next hand starts. */
  pendingStackAdjustment: number | null;
}

/** One scoring category's live hand-strength readout (e.g. "Top Board", "Hand Strength" for point-race games; a single unlabeled entry for standard single-board games). `description` is null until enough cards are on the table to evaluate that specific category yet. */
export interface HandStrengthCategory {
  label: string;
  description: string | null;
}

export interface HandPlayerView {
  seatIndex: number;
  folded: boolean;
  allIn: boolean;
  committedThisStreet: number;
  totalContributed: number;
  holeCardCount: number;
  /** Populated only for the viewer's own seat, or once the hand is complete: seats that were forced to show at a contested showdown, plus any seat that chose to voluntarily reveal. */
  holeCards: Card[] | null;
  /** True only for the viewer's own seat: the hand is complete, they weren't forced to show (won uncontested or folded), and they haven't already revealed. */
  canShow: boolean;
  /** Live hand-strength readout, one entry per scoring category this game actually pays out on (one per board, plus a hole-cards-only category for point-race games that use one) — null only when `holeCards` is hidden from this viewer. */
  handStrengthCategories: HandStrengthCategory[] | null;
  /** How many of this seat's hole cards came from the most recent deal/redraw event (0 once any other action has happened since) — e.g. ESG's mid-street top-up. Counts from the end of deal-order, before display sorting. */
  recentlyDealtCount: number;
}

export interface HandView {
  handNumber: number;
  streetName: string;
  phase: HandPhase;
  board: Card[];
  /** Populated only for multi-board games; null for standard single-board games. */
  boards: Card[][] | null;
  /** Undealt community cards shown after rabbit hunting; null until revealed or when all cards were already dealt. */
  rabbitBoard: Card[] | null;
  rabbitBoards: Card[][] | null;
  pot: number;
  turnSeatIndex: number | null;
  players: HandPlayerView[];
  results: PotResult[] | null;
  /** Populated only for the viewer when it is their turn to act. */
  legalActions: LegalActionInfo | null;
}

export interface SeatRequestView {
  id: string;
  seatIndex: number;
  userId: string;
  displayName: string;
  requestedBuyIn: number;
}

export interface ClangPendingEatView {
  discarderSeatIndex: number;
  eaterSeatIndex: number;
  rank: number;
}

export interface ClangLastEatView {
  discarderSeatIndex: number;
  eaterSeatIndex: number;
  rank: number;
  /** Chips paid (eatPaymentPerCard × cards eaten) — for the chip-fly animation's label. */
  amount: number;
  /** Position of this eat in the round's action log — increments monotonically, so the frontend can tell a repeat of the same discarder/eater/rank apart from the previous one. */
  actionIndex: number;
}

export interface ClangResultView {
  type: "instant" | "call" | "forced";
  callerSeatIndex: number | null;
  winnerSeatIndices: number[];
  payments: ClangPayment[];
}

export interface ClangBonusHitView {
  seatIndex: number;
  category: ClangHandCategory;
  payout: number;
}

export interface ClangPlayerView {
  seatIndex: number;
  handCardCount: number;
  /** Populated only for the viewer's own seat while live, or every seat once the round is complete. */
  hand: Card[] | null;
  /** Live for the viewer's own seat while the round is running; populated for everyone once the round is complete. */
  handValue: number | null;
  /** True if the last card in `hand` is the one this seat most recently drew (cleared once anyone else acts). Only meaningful when `hand` is populated. */
  justDrewLastCard: boolean;
}

export interface ClangLegalActions {
  /** Start of turn: draw a card before you can discard. */
  canDraw: boolean;
  /** After drawing: discard from your now-6-card hand. */
  canPlay: boolean;
  canCallClangNormal: boolean;
  canCallInstantClang: boolean;
  canEat: boolean;
  canPassEat: boolean;
}

export interface ClangRoundView {
  roundNumber: number;
  stake: number;
  eatPaymentPerCard: number;
  phase: ClangPhase;
  turnSeatIndex: number | null;
  pendingEat: ClangPendingEatView | null;
  /** The most recent successful Eat (any number of chained eats back), for the frontend's chip-fly/banner — null before anyone has eaten this round. */
  lastEat: ClangLastEatView | null;
  players: ClangPlayerView[];
  bonusHits: ClangBonusHitView[];
  /** Populated only for the viewer when they're seated in this round. */
  legalActions: ClangLegalActions | null;
  result: ClangResultView | null;
  drawPileCount: number;
  /** All cards from the most recent discard (a Play or an Eat may drop more than one card at once), face-up for everyone. Empty before anything has been discarded. */
  topDiscard: Card[];
  discardPileCount: number;
}

export interface CardFlipPlayerView {
  seatIndex: number;
  handCardCount: number;
  /** Unlike Clang/poker, every seat's hand is public in Card Flip — you need to see the leader's hand to know what you have to beat. */
  hand: Card[];
  /** Best-hand label ("Pair of Kings", "Ace High") for this seat's current cards — works below 5 cards, unlike poker. Null only before the first card is drawn. */
  handStrengthLabel: string | null;
  /** True if the last card in `hand` is the one this seat most recently drew (cleared once anyone else draws). */
  justDrewLastCard: boolean;
}

export interface CardFlipLegalActions {
  canDraw: boolean;
}

export interface CardFlipResultView {
  winnerSeatIndices: number[];
  payments: CardFlipPayment[];
}

export interface CardFlipRoundView {
  roundNumber: number;
  stake: number;
  cardsPerPlayer: number;
  phase: CardFlipPhase;
  turnSeatIndex: number | null;
  /** Whoever currently holds the strongest hand at the table — the target the current turn's player must beat. Null only before anyone has drawn enough cards to be evaluated. */
  leaderSeatIndex: number | null;
  /** Card counts remaining in each of the 3 shared draw piles. */
  pileCounts: number[];
  /** Which pile (0/1/2) the most recent draw came from, so the UI can reveal it there. */
  lastDrawPileIndex: number | null;
  /** The actual card most recently drawn, shown face-up at its pile's position (flip-revealed) until the next draw. */
  lastDrawnCard: Card | null;
  players: CardFlipPlayerView[];
  /** Populated only for the viewer when they're seated in this round. */
  legalActions: CardFlipLegalActions | null;
  result: CardFlipResultView | null;
}

export interface TableSnapshot {
  tableId: string;
  gameKind: TableGameKind;
  gameDefinitionId: string;
  gameName: string;
  ownerId: string;
  /** Null until the owner has requested/taken a seat and picked a name. */
  ownerDisplayName: string | null;
  seats: PublicSeatView[];
  /** Seats currently awaiting the owner's approval (or auto-approval for the owner's own seat). */
  pendingRequests: SeatRequestView[];
  buttonSeatIndex: number | null;
  handInProgress: boolean;
  hand: HandView | null;
  /** Which game will be used for the next hand/round (owner-set override, any engine — or the current game as default). */
  nextGameDefinitionId: string;
  nextGameName: string;
  clangRound: ClangRoundView | null;
  /** Prefill hints for the owner's next "Deal" form, from the last round dealt at this table. */
  clangLastStake: number | null;
  clangLastEatPaymentPerCard: number | null;
  cardFlipRound: CardFlipRoundView | null;
}
