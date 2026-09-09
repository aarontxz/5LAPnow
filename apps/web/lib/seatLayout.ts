export const MAX_SEATS = 10;

// Fixed rectangle layout: seat 0 is bottom-center, seats 1-4 run up the LEFT
// side, seat 5 is top-center (across from you), seats 6-9 run back down the
// right side. Every seat renders at one of these positions by RELATIVE index
// (see relativeSeatIndex) so seat 0 is always wherever the viewer is sitting
// — everyone's own screen shows themselves at the bottom, table non-circular.
//
// The left-then-right ordering is deliberate: acting order is ascending seat
// index (see orderSeatsFromButton in the engine), so laying relative index 1
// out on the viewer's left makes the action travel bottom → left → top →
// right, i.e. CLOCKWISE around the felt, matching live poker. Mirroring these
// positions is what sets the visual rotation direction for every game on the
// platform — the engine has no notion of clockwise at all.
const RECT_POSITIONS: Array<{ left: number; top: number }> = [
  { left: 50, top: 90 },
  { left: 14, top: 76 },
  { left: 14, top: 58 },
  { left: 14, top: 40 },
  { left: 14, top: 22 },
  { left: 50, top: 10 },
  { left: 86, top: 22 },
  { left: 86, top: 40 },
  { left: 86, top: 58 },
  { left: 86, top: 76 },
];

// Rotates an absolute seatIndex so the viewer's own seat always maps to
// relative position 0 (bottom-center); everyone else falls in clockwise
// around the rectangle from there. Falls back to the absolute index when the
// viewer isn't seated (spectating).
export function relativeSeatIndex(seatIndex: number, mySeatIndex: number | null): number {
  if (mySeatIndex === null) return seatIndex % MAX_SEATS;
  return (seatIndex - mySeatIndex + MAX_SEATS) % MAX_SEATS;
}

export function seatPosition(relativeIndex: number): { left: string; top: string } {
  const pos = RECT_POSITIONS[relativeIndex] ?? RECT_POSITIONS[0];
  return { left: `${pos.left}%`, top: `${pos.top}%` };
}

// Unit vector pointing from a seat's rectangle position back toward the
// table's center — used to push a bet's chip token partway out of the seat
// box toward the pot without it ever fully reaching the center.
export function chipDirection(relativeIndex: number): { x: number; y: number } {
  const pos = RECT_POSITIONS[relativeIndex] ?? RECT_POSITIONS[0];
  const dx = 50 - pos.left;
  const dy = 50 - pos.top;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}
