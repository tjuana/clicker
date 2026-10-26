/** Position units per tile. */
export const TILE = 4096;
/** Heading steps per full turn; a power of two so wrapping is a mask. */
export const TURN = 4096;
/** The scale of sine and cosine: `ONE` is 1.0. */
export const ONE = 16384;

const QUARTER = TURN / 4;

/**
 * Taylor series to x^15 on [0, π/2]. Only + − × ÷, which IEEE 754 rounds exactly, so every
 * engine builds the same table; `Math.sin` is not guaranteed to, and the client will run these
 * rules too. The first omitted term is below 1e-11, far under half a unit of `ONE`.
 */
function taylor(x: number): number {
  const square = x * x;
  let term = x;
  let sum = x;
  for (let n = 3; n <= 15; n += 2) {
    term = (-term * square) / ((n - 1) * n);
    sum += term;
  }
  return sum;
}

const quarter: number[] = [];
for (let i = 0; i <= QUARTER; i += 1) {
  quarter.push(Math.round(taylor((i * (Math.PI / 2)) / QUARTER) * ONE));
}

/** The four quadrants are mirrors of the first, so only a quarter is computed. */
const TABLE = Int32Array.from({ length: TURN }, (_, h) => {
  if (h <= QUARTER) return quarter[h] ?? 0;
  if (h <= 2 * QUARTER) return quarter[2 * QUARTER - h] ?? 0;
  if (h <= 3 * QUARTER) return -(quarter[h - 2 * QUARTER] ?? 0);
  return -(quarter[4 * QUARTER - h] ?? 0);
});

/** Any integer heading: the mask makes negative and multi-turn values wrap. */
export function sin(heading: number): number {
  return TABLE[heading & (TURN - 1)] ?? 0;
}

export function cos(heading: number): number {
  return sin(heading + QUARTER);
}
