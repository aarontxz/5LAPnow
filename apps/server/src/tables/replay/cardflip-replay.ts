import type { Card } from "@5lapnow/cards";
import type { CardFlipActionLogEntry } from "@5lapnow/card-flip-engine";
import { comparePartialHands, evaluatePartialHand, describePartialHand } from "@5lapnow/card-flip-engine";
import type {
  CardFlipPlayerView,
  CardFlipReplayStep,
  CardFlipResultView,
  CardFlipRoundLogPlayer,
  CardFlipRoundView,
} from "@5lapnow/shared-types";

export type { CardFlipReplayStep };

export interface CardFlipRoundReplayRow {
  roundNumber: number;
  stake: number;
  cardsPerPlayer: number;
  outcome: CardFlipResultView;
  players: CardFlipRoundLogPlayer[];
  actions: CardFlipActionLogEntry[];
}

const PILE_COUNT = 3;

interface PlayerAcc {
  seatIndex: number;
  displayName: string | null;
  hand: Card[];
  justDrewLastCard: boolean;
}

function describeAction(action: CardFlipActionLogEntry, nameOf: (seatIndex: number) => string): string {
  switch (action.type) {
    case "deal":
      return "Piles dealt";
    case "draw":
      return `${nameOf(action.seatIndex)} draws from pile ${action.pileIndex + 1}`;
    case "complete":
      return "Round complete";
  }
}

/**
 * Replays a persisted Card Flip round's action log into a step-by-step
 * timeline shaped like the live `CardFlipRoundView`. No redaction needed —
 * every seat's hand is public in Card Flip even live (you need to see the
 * leader's hand to know what beats it), so the reconstruction is a
 * straightforward replay of draws.
 */
export function buildCardFlipReplay(row: CardFlipRoundReplayRow): CardFlipReplayStep[] {
  const players = new Map<number, PlayerAcc>();
  for (const p of row.players) {
    players.set(p.seatIndex, { seatIndex: p.seatIndex, displayName: p.displayName, hand: [], justDrewLastCard: false });
  }
  const nameOf = (seatIndex: number): string => players.get(seatIndex)?.displayName ?? `Seat ${seatIndex}`;

  // Mirrors CardFlipEngine.startRound's own math: enough combined 52-card decks to
  // cover every seat's cardsPerPlayer, dealt round-robin into PILE_COUNT piles.
  const deckCount = Math.max(1, Math.ceil((row.cardsPerPlayer * row.players.length) / 52));
  const totalCards = deckCount * 52;
  const pileCounts = Array.from({ length: PILE_COUNT }, (_, i) => Math.floor(totalCards / PILE_COUNT) + (i < totalCards % PILE_COUNT ? 1 : 0));
  let leaderSeatIndex: number | null = null;
  let lastDrawPileIndex: number | null = null;
  let lastDrawnCard: Card | null = null;

  function clearJustDrew(except?: number): void {
    for (const p of players.values()) {
      if (p.seatIndex !== except) p.justDrewLastCard = false;
    }
  }

  function snapshot(actionIndex: number): CardFlipRoundView {
    const isFinalStep = actionIndex === row.actions.length - 1;
    const playerViews: CardFlipPlayerView[] = row.players.map((persisted) => {
      const acc = players.get(persisted.seatIndex) as PlayerAcc;
      return {
        seatIndex: acc.seatIndex,
        handCardCount: acc.hand.length,
        hand: [...acc.hand],
        handStrengthLabel: acc.hand.length > 0 ? describePartialHand(acc.hand) : null,
        justDrewLastCard: acc.justDrewLastCard,
      };
    });

    return {
      roundNumber: row.roundNumber,
      stake: row.stake,
      cardsPerPlayer: row.cardsPerPlayer,
      phase: isFinalStep ? "complete" : "turn",
      turnSeatIndex: null,
      leaderSeatIndex,
      pileCounts: [...pileCounts],
      lastDrawPileIndex,
      lastDrawnCard,
      players: playerViews,
      legalActions: null,
      result: isFinalStep ? row.outcome : null,
    };
  }

  const steps: CardFlipReplayStep[] = [{ actionIndex: -1, description: "Round begins", round: snapshot(-1) }];

  row.actions.forEach((action, actionIndex) => {
    if (action.type === "draw") {
      const p = players.get(action.seatIndex);
      if (p) {
        p.hand.push(action.card);
        clearJustDrew(action.seatIndex);
        p.justDrewLastCard = true;
        const pile = pileCounts[action.pileIndex];
        if (pile !== undefined) pileCounts[action.pileIndex] = Math.max(0, pile - 1);
        lastDrawPileIndex = action.pileIndex;
        lastDrawnCard = action.card;

        const leader = leaderSeatIndex !== null ? players.get(leaderSeatIndex) : null;
        if (!leader || comparePartialHands(evaluatePartialHand(p.hand), evaluatePartialHand(leader.hand)) > 0) {
          leaderSeatIndex = p.seatIndex;
        }
      }
    }

    steps.push({ actionIndex, description: describeAction(action, nameOf), round: snapshot(actionIndex) });
  });

  return steps;
}
