import { Card } from "@5lapnow/cards";
import { ReservedCommunityDeal } from "./handState.js";

export interface RabbitReveal {
  rabbitBoard: Card[];
  rabbitBoards: Card[][] | null;
}

/**
 * Reveals the community cards that would have come on every street after
 * `fromStreetIndex`, straight from those streets' `ReservedCommunityDeal`s —
 * cosmetic only, never touches the real board. Every board card is carved
 * out of the deck and fixed at hand init (see `HandState.reservedCommunityDeals`),
 * so this reports the true predetermined cards rather than drawing fresh
 * ones — a fold's cards reshuffled back into the deck can never leak in
 * here either. Pure/non-mutating so it works identically whether fed a live
 * hand's `reservedCommunityDeals` or a persisted `Hand.remainingDeck`
 * snapshot for a replay, long after the live hand is gone.
 */
export function computeRabbitReveal(
  fromStreetIndex: number,
  boardsCount: number,
  reservedCommunityDeals: (ReservedCommunityDeal | null)[]
): RabbitReveal {
  const remainingDeals = reservedCommunityDeals
    .slice(fromStreetIndex + 1)
    .filter((deal): deal is ReservedCommunityDeal => deal !== null);

  if (boardsCount > 1) {
    const rabbitBoards: Card[][] = Array.from({ length: boardsCount }, () => []);
    for (const deal of remainingDeals) {
      deal.boardCards.forEach((cards, boardIndex) => rabbitBoards[boardIndex]!.push(...cards));
    }
    return { rabbitBoard: rabbitBoards.flat(), rabbitBoards };
  }

  const rabbitBoard: Card[] = [];
  for (const deal of remainingDeals) rabbitBoard.push(...(deal.boardCards[0] ?? []));

  return { rabbitBoard, rabbitBoards: null };
}
