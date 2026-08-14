import type { Card } from "@5lapnow/cards";
import type { GameDefinition, HandActionLogEntry, PotResult } from "@5lapnow/game-engine";
import { recentlyDealtCounts } from "@5lapnow/game-engine";
import type { HandLogPlayer, HandPlayerView, HandView, PokerReplayStep } from "@5lapnow/shared-types";
import { mustShowSeatsFromResults } from "../table-snapshot";

export type { PokerReplayStep };

export interface PokerHandReplayRow {
  handNumber: number;
  gameName: string;
  board: Card[];
  boards: Card[][] | null;
  results: PotResult[];
  players: HandLogPlayer[];
  actions: HandActionLogEntry[];
  remainingDeck: Card[];
  rabbitBoard: Card[] | null;
  rabbitBoards: Card[][] | null;
}

interface PlayerAcc {
  seatIndex: number;
  userId: string | null;
  displayName: string | null;
  folded: boolean;
  committedThisStreet: number;
  totalContributed: number;
  holeCardCount: number;
  stack: number;
}

/** Builds a human-readable one-line label for an action, given the player's display name where relevant. */
function describeAction(action: HandActionLogEntry, nameOf: (seatIndex: number) => string): string {
  switch (action.type) {
    case "post":
      return `${nameOf(action.seatIndex)} posts ${action.amount ?? 0}`;
    case "fold":
      return `${nameOf(action.seatIndex)} folds`;
    case "check":
      return `${nameOf(action.seatIndex)} checks`;
    case "call":
      return `${nameOf(action.seatIndex)} calls ${action.amount ?? 0}`;
    case "bet":
      return `${nameOf(action.seatIndex)} bets ${action.amount ?? 0}`;
    case "raise":
      return `${nameOf(action.seatIndex)} raises to ${action.amount ?? 0}`;
    case "dealHoleCards":
      return `${nameOf(action.seatIndex)} dealt ${action.count} card${action.count === 1 ? "" : "s"}`;
    case "redraw":
      return `${nameOf(action.seatIndex)} draws ${action.count} card${action.count === 1 ? "" : "s"}`;
    case "dealCommunityCards": {
      const cards = action.cards.map((c) => `${c.rank}${c.suit[0]}`).join(" ");
      return action.boardIndex > 0 ? `Board ${action.boardIndex + 1}: ${action.streetName} — ${cards}` : `${action.streetName} dealt — ${cards}`;
    }
  }
}

/**
 * Replays a persisted hand's enriched action log into a step-by-step
 * timeline shaped like the live `HandView`, so the same components used
 * during live play can render it unchanged. `steps[0]` is the state right
 * after seats are dealt in (before any action); `steps[i+1]` is the state
 * after `actions[i]`.
 *
 * Visibility mirrors what a real spectator ever saw, not just what's safe to
 * store: the viewer's own hole cards grow into view as they're actually
 * dealt/redrawn (using the real identities, since there's no privacy
 * concern for your own cards), but any OTHER seat's hole cards only ever
 * appear on the final step, and only if that seat was actually revealed
 * (forced to show, or voluntarily shown) — exactly matching the fact that
 * nobody but the owner ever saw them earlier than that live, either.
 */
export function buildPokerReplay(row: PokerHandReplayRow, gameDefinition: GameDefinition, viewerUserId: string | null): PokerReplayStep[] {
  const numBoards = row.boards ? row.boards.length : 1;
  const mustShow = mustShowSeatsFromResults(row.results);

  const players = new Map<number, PlayerAcc>();
  for (const p of row.players) {
    players.set(p.seatIndex, {
      seatIndex: p.seatIndex,
      userId: p.userId,
      displayName: p.displayName,
      folded: false,
      committedThisStreet: 0,
      totalContributed: 0,
      holeCardCount: 0,
      stack: p.stackBefore ?? 0,
    });
  }

  const nameOf = (seatIndex: number): string => players.get(seatIndex)?.displayName ?? `Seat ${seatIndex}`;

  const boards: Card[][] = Array.from({ length: numBoards }, () => []);
  let currentStreetName = "";

  function snapshotHandView(streetName: string, actionIndex: number): HandView {
    const isFinalStep = actionIndex === row.actions.length - 1;
    const totalPot = [...players.values()].reduce((sum, p) => sum + p.totalContributed, 0);
    // actionIndex is the index of the action just applied; slice includes it (+1) — matches
    // recentlyDealtCounts' "as of this point in the log" contract exactly.
    const dealtCounts = recentlyDealtCounts(row.actions.slice(0, actionIndex + 1));
    const lastAction = actionIndex >= 0 ? { ...row.actions[actionIndex]!, actionIndex } : null;

    const playerViews: HandPlayerView[] = row.players.map((persisted) => {
      const acc = players.get(persisted.seatIndex) as PlayerAcc;
      const isOwnSeat = viewerUserId !== null && persisted.userId === viewerUserId;
      const revealedToEveryone = isFinalStep && (mustShow.has(persisted.seatIndex) || persisted.shown);

      let holeCards: Card[] | null = null;
      if (isOwnSeat && persisted.holeCards) {
        // Grows into view as this seat's own cards are actually dealt/redrawn.
        holeCards = persisted.holeCards.slice(0, acc.holeCardCount);
      } else if (revealedToEveryone) {
        holeCards = persisted.holeCards;
      }

      return {
        seatIndex: acc.seatIndex,
        folded: acc.folded,
        allIn: acc.stack <= 0 && acc.totalContributed > 0,
        committedThisStreet: acc.committedThisStreet,
        totalContributed: acc.totalContributed,
        holeCardCount: acc.holeCardCount,
        holeCards,
        canShow: false,
        handStrengthCategories: null,
        recentlyDealtCount: dealtCounts.get(persisted.seatIndex) ?? 0,
      };
    });

    return {
      handNumber: row.handNumber,
      streetName,
      phase: isFinalStep ? "complete" : "betting",
      board: boards.flat(),
      boards: numBoards > 1 ? boards.map((b) => [...b]) : null,
      rabbitBoard: isFinalStep ? row.rabbitBoard : null,
      rabbitBoards: isFinalStep ? row.rabbitBoards : null,
      pot: totalPot,
      turnSeatIndex: null,
      players: playerViews,
      results: isFinalStep ? row.results : null,
      legalActions: null,
      lastAction,
    };
  }

  const steps: PokerReplayStep[] = [{ actionIndex: -1, description: "Hand begins", hand: snapshotHandView("preflop", -1) }];

  row.actions.forEach((action, actionIndex) => {
    const streetName = "streetName" in action ? action.streetName : currentStreetName;
    if (streetName !== currentStreetName) {
      // Mirrors resetStreetContributions: every active seat's committedThisStreet
      // resets when a new street begins, before that street's first action applies.
      for (const p of players.values()) p.committedThisStreet = 0;
      currentStreetName = streetName;
    }

    switch (action.type) {
      case "post":
      case "call": {
        const p = players.get(action.seatIndex);
        if (p && action.amount !== null) {
          p.committedThisStreet += action.amount;
          p.totalContributed += action.amount;
          p.stack -= action.amount;
        }
        break;
      }
      case "bet":
      case "raise": {
        const p = players.get(action.seatIndex);
        if (p && action.amount !== null) {
          const delta = action.amount - p.committedThisStreet;
          p.committedThisStreet = action.amount;
          p.totalContributed += delta;
          p.stack -= delta;
        }
        break;
      }
      case "check":
        break;
      case "fold": {
        const p = players.get(action.seatIndex);
        if (p) p.folded = true;
        break;
      }
      case "dealHoleCards":
      case "redraw": {
        const p = players.get(action.seatIndex);
        if (p) p.holeCardCount += action.count;
        break;
      }
      case "dealCommunityCards": {
        const board = boards[action.boardIndex];
        if (board) board.push(...action.cards);
        break;
      }
    }

    steps.push({
      actionIndex,
      description: describeAction(action, nameOf),
      hand: snapshotHandView(currentStreetName, actionIndex),
    });
  });

  return steps;
}
