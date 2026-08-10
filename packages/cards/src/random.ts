import { randomInt } from "node:crypto";

/** Kept under the 2^48 ceiling node:crypto's randomInt enforces — still far more precision than a 52-card shuffle needs. */
const RANGE = 2 ** 48;

/**
 * Cryptographically secure drop-in replacement for Math.random(): same `() => number`
 * shape, uniform float in [0, 1). Math.random is a statistical PRNG (V8 uses
 * xorshift128+) whose internal state is recoverable from a handful of observed
 * outputs — unsuitable as the default shuffle source for a game where fairness
 * actually matters.
 */
export function secureRandom(): number {
  return randomInt(0, RANGE) / RANGE;
}
