import { Card } from "@5lapnow/cards";
import { GameDefinition } from "./gameDefinition.js";

export interface RabbitReveal {
  rabbitBoard: Card[];
  rabbitBoards: Card[][] | null;
}

/**
 * Deals the community cards that would have come on every street after
 * `fromStreetIndex`, purely from `remainingDeckCards` (in order) — cosmetic
 * only, never touches the real board. Pure/non-mutating so it works
 * identically whether fed a live hand's leftover deck or a persisted
 * `Hand.remainingDeck` snapshot for a replay, long after the live hand is
 * gone.
 */
export function computeRabbitReveal(
  gameDefinition: GameDefinition,
  fromStreetIndex: number,
  boardsCount: number,
  remainingDeckCards: Card[]
): RabbitReveal {
  const cards = [...remainingDeckCards];
  const draw = (n: number): Card[] => cards.splice(0, n);
  const burn = (): void => {
    cards.shift();
  };

  const remainingStreets = gameDefinition.streets.slice(fromStreetIndex + 1).filter((s) => s.dealCommunityCards > 0);

  if (boardsCount > 1) {
    const rabbitBoards: Card[][] = Array.from({ length: boardsCount }, () => []);
    for (const street of remainingStreets) {
      burn();
      for (const board of rabbitBoards) board.push(...draw(street.dealCommunityCards));
    }
    return { rabbitBoard: rabbitBoards.flat(), rabbitBoards };
  }

  const rabbitBoard: Card[] = [];
  for (const street of remainingStreets) {
    burn();
    rabbitBoard.push(...draw(street.dealCommunityCards));
  }
  return { rabbitBoard, rabbitBoards: null };
}
