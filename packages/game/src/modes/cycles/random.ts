/**
 * mulberry32: a 32-bit generator built from multiplications and shifts alone.
 *
 * `Math.random` is banned in the rules, and for more than purity: the client will one day run
 * these same rules to predict its own bike, and only a generator made of integer operations is
 * guaranteed to produce the same sequence on every JavaScript engine. The seed lives in the
 * state, so a replay from the same state draws the same numbers.
 */
export function random(seed: number): { value: number; seed: number } {
  const next = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(next ^ (next >>> 15), next | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { value: ((t ^ (t >>> 14)) >>> 0) / 4294967296, seed: next };
}

/** An integer in [0, bound). */
export function randomBelow(seed: number, bound: number): { value: number; seed: number } {
  const drawn = random(seed);
  return { value: Math.floor(drawn.value * bound), seed: drawn.seed };
}
