import type { Card } from "@5lapnow/cards";
import type { ClangActionLogEntry } from "@5lapnow/clang-engine";
import type {
  ClangBonusHitView,
  ClangLastDrawView,
  ClangLastEatView,
  ClangLastPlayView,
  ClangPlayerView,
  ClangReplayStep,
  ClangResultView,
  ClangRoundLogPlayer,
  ClangRoundView,
} from "@5lapnow/shared-types";

export type { ClangReplayStep };

export interface ClangRoundReplayRow {
  roundNumber: number;
  stake: number;
  eatPaymentPerCard: number;
  outcome: ClangResultView;
  bonusHits: ClangBonusHitView[];
  players: ClangRoundLogPlayer[];
  actions: ClangActionLogEntry[];
}

interface PlayerAcc {
  seatIndex: number;
  displayName: string | null;
  hand: Card[];
  justDrewLastCard: boolean;
}

const RANK_LABELS: Record<number, string> = { 11: "J", 12: "Q", 13: "K", 14: "A" };
function rankLabel(rank: number): string {
  return RANK_LABELS[rank] ?? String(rank);
}

function describeAction(action: ClangActionLogEntry, nameOf: (seatIndex: number) => string): string {
  switch (action.type) {
    case "deal":
      return "Hands dealt";
    case "bonus":
      return `${nameOf(action.seatIndex)} hits a bonus (${action.category})`;
    case "play":
      return `${nameOf(action.seatIndex)} discards ${action.count}× ${rankLabel(action.rank)}`;
    case "eat":
      return `${nameOf(action.eaterSeatIndex)} eats ${nameOf(action.discarderSeatIndex)}'s ${rankLabel(action.rank)}${action.count > 1 ? "s" : ""}`;
    case "eatDeclined":
      return `${nameOf(action.seatIndex)} passes on eating`;
    case "draw":
      return `${nameOf(action.seatIndex)} draws a card`;
    case "callClangInstant":
      return `${nameOf(action.seatIndex)} calls Clang! (instant 21)`;
    case "callClang":
      return `${nameOf(action.seatIndex)} calls Clang`;
    case "forcedShowdown":
      return "Deck exhausted — forced showdown";
    case "emptyHand":
      return `${nameOf(action.seatIndex)} plays their last card and wins!`;
  }
}

/** Number of standard decks Clang shuffles together, mirroring ClangEngine.startRound's own rule. */
const SECOND_DECK_THRESHOLD = 5;

/**
 * Replays a persisted Clang round's enriched action log into a step-by-step
 * timeline shaped like the live `ClangRoundView`. Unlike poker, there's no
 * redaction to do here — Clang has no folding/mucking concept, every seat's
 * hand is already fully public once a round completes, so the reconstructed
 * `hand` per seat is always the real cards, growing/shrinking exactly as
 * they did live.
 */
export function buildClangReplay(row: ClangRoundReplayRow): ClangReplayStep[] {
  const players = new Map<number, PlayerAcc>();
  for (const p of row.players) {
    players.set(p.seatIndex, { seatIndex: p.seatIndex, displayName: p.displayName, hand: [], justDrewLastCard: false });
  }
  const nameOf = (seatIndex: number): string => players.get(seatIndex)?.displayName ?? `Seat ${seatIndex}`;

  const deckCount = row.players.length > SECOND_DECK_THRESHOLD ? 2 : 1;
  let drawPileCount = deckCount * 52 - row.players.length * 5;
  let discardPileCount = 0;
  let topDiscard: Card[] = [];
  let lastEat: ClangLastEatView | null = null;
  let lastDraw: ClangLastDrawView | null = null;
  let lastPlay: ClangLastPlayView | null = null;

  function clearJustDrew(except?: number): void {
    for (const p of players.values()) {
      if (p.seatIndex !== except) p.justDrewLastCard = false;
    }
  }

  function snapshot(actionIndex: number): ClangRoundView {
    const isFinalStep = actionIndex === row.actions.length - 1;
    const playerViews: ClangPlayerView[] = row.players.map((persisted) => {
      const acc = players.get(persisted.seatIndex) as PlayerAcc;
      return {
        seatIndex: acc.seatIndex,
        handCardCount: acc.hand.length,
        hand: [...acc.hand],
        handValue: isFinalStep ? persisted.handValue : null,
        justDrewLastCard: acc.justDrewLastCard,
      };
    });

    return {
      roundNumber: row.roundNumber,
      stake: row.stake,
      eatPaymentPerCard: row.eatPaymentPerCard,
      phase: isFinalStep ? "complete" : "turn",
      turnSeatIndex: null,
      pendingEat: null,
      lastEat,
      lastDraw,
      lastPlay,
      players: playerViews,
      bonusHits: row.bonusHits,
      legalActions: null,
      result: isFinalStep ? row.outcome : null,
      drawPileCount,
      topDiscard,
      discardPileCount,
    };
  }

  const steps: ClangReplayStep[] = [{ actionIndex: -1, description: "Round begins", round: snapshot(-1) }];

  row.actions.forEach((action, actionIndex) => {
    switch (action.type) {
      case "deal": {
        for (const { seatIndex, hand } of action.hands) {
          const p = players.get(seatIndex);
          if (p) p.hand = [...hand];
        }
        break;
      }
      case "draw": {
        const p = players.get(action.seatIndex);
        if (p) {
          p.hand.push(action.card);
          clearJustDrew(action.seatIndex);
          p.justDrewLastCard = true;
          drawPileCount = Math.max(0, drawPileCount - 1);
        }
        lastDraw = { seatIndex: action.seatIndex, actionIndex };
        break;
      }
      case "play": {
        const p = players.get(action.seatIndex);
        if (p) {
          p.hand = p.hand.filter((c) => c.rank !== action.rank);
          topDiscard = action.cards;
          discardPileCount += action.cards.length;
        }
        lastPlay = { seatIndex: action.seatIndex, count: action.count, actionIndex };
        break;
      }
      case "eat": {
        const eater = players.get(action.eaterSeatIndex);
        if (eater) {
          eater.hand = eater.hand.filter((c) => c.rank !== action.rank);
          topDiscard = action.cards;
          discardPileCount += action.cards.length;
        }
        lastEat = {
          discarderSeatIndex: action.discarderSeatIndex,
          eaterSeatIndex: action.eaterSeatIndex,
          rank: action.rank,
          amount: action.amount,
          actionIndex,
        };
        break;
      }
      case "bonus":
      case "eatDeclined":
      case "callClangInstant":
      case "callClang":
      case "forcedShowdown":
      case "emptyHand":
        break;
    }

    steps.push({ actionIndex, description: describeAction(action, nameOf), round: snapshot(actionIndex) });
  });

  return steps;
}
