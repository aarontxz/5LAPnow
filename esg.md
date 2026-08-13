# ESG

## Setup
- Max 6 players.
- Everyone starts with 6 hole cards.
- 2 community boards, dealt in lockstep (like existing double-board bomb pot games).

## Hand structure
1. **Preflop**: blinds post, players act on their 6 starting cards (no redraw yet).
2. **Flop**: deal flop to both boards → redraw phase (draw up to 9 total hole cards) → betting phase.
3. **Turn**: deal turn to both boards → redraw phase (draw up to 12 total hole cards) → betting phase.
4. **River**: deal river to both boards → redraw phase (draw up to 15 total hole cards) → betting phase.
5. Showdown.

## Redraw mechanics
- Each redraw phase has a target hand size for that street: 9 after flop, 12 after turn, 15 after river.
- Each active player draws up to `target - current hand size`. Since targets are absolute (not a fixed per-street amount), a player who fell short of a prior target due to deck shortage is "owed" the make-up cards plus that street's normal increment (e.g., short 2 on the flop + normal 3 on the turn = draw 5 to reach 12).
- Redraw only adds cards — players never discard from an active hand. Hand size only shrinks via folding.
- **Deck shortage**: if the deck doesn't have enough cards for every active player to reach the street's target, every active player draws `floor(cards remaining in deck / active players)` instead, and the actual (lower) hand size becomes that street's new baseline for future "owed" math. Any remainder cards stay in the deck undealt.
- When a player folds, their hole cards are immediately shuffled back into the deck (increasing the pool for subsequent redraws).

## Hand evaluation (3 categories, 1 point each)
- **Board 1**: best hand using exactly 2 hole cards + 3 of board 1's cards (true PLO rules).
- **Board 2**: same, using board 2.
- **Hand strength**: best 5-card poker hand using only hole cards (all cards in hand, no board), no PLO restriction.
- Note: true PLO (exactly-2-hole-cards) evaluation isn't currently implemented in `packages/cards`' hand evaluator — the engine's existing Omaha games all use best-5-of-combined instead. This game needs new evaluation logic (not just a data-only `GameDefinition`).

## Scoring & winner
- Each of the 3 categories is worth 1 point, for a max of 3 points.
- If multiple players tie for best hand within a single category, they split that category's point evenly (e.g. 0.5 each for 2-way, 0.33 each for 3-way).
- The player(s) with the highest total point score take the whole pot.
- If multiple players tie on total point score, the pot is split evenly among them (no further tiebreak).
