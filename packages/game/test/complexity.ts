/**
 * Measuring how work grows with input size, so asymptotics can be asserted instead of argued.
 *
 * Wall-clock timing cannot do this job. On a shared CI runner the noise is larger than the
 * signal, and a test that measures milliseconds is exactly the flaky test this project forbids.
 * A count of property accesses is deterministic — the same input yields the same number on
 * every machine and every run — so comparing two input sizes measures the algorithm rather
 * than the hardware it happened to run on.
 */

export interface Tally {
  touches: number;
}

/**
 * Wraps a record so every key read, enumeration and descriptor lookup against it is counted.
 * Spreading the record costs one count per key, which is precisely the work a spread does;
 * a keyed lookup costs one, however large the record is. That difference is the whole point.
 */
export function counted<T extends object>(record: T, tally: Tally): T {
  return new Proxy(record, {
    get(target, key) {
      tally.touches += 1;
      // The target, not the proxy, is the receiver: typed arrays refuse to run their own
      // getters, such as `length`, on anything but a real typed array.
      return Reflect.get(target, key);
    },
    ownKeys(target) {
      tally.touches += 1;
      return Reflect.ownKeys(target);
    },
    getOwnPropertyDescriptor(target, key) {
      tally.touches += 1;
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
}

/**
 * Sizes an order of magnitude apart. They describe no real room — `maxPlayers` is fifty — they
 * are chosen only to separate the curves: across a tenfold input, constant work stays near 1,
 * linear work lands near 10 and quadratic work near 100. With gaps that wide a threshold never
 * has to be precise, which is what keeps these tests from going flaky as the code moves.
 */
const SMALL = 100;
const LARGE = 1000;

/** Linear work lands near this; anything quadratic lands near a hundred times it. */
export const LINEAR = LARGE / SMALL;

/**
 * Runs `work` at both sizes and returns how much the work multiplied.
 * `work` must return a tally of the operations its subject performed at that size.
 */
export function growth(work: (size: number) => number): number {
  const small = work(SMALL);
  const large = work(LARGE);
  return large / Math.max(1, small);
}

/** Array methods that walk the whole array looking for something. */
const SCANNERS = ['includes', 'indexOf', 'lastIndexOf', 'find', 'findIndex', 'some', 'every'];

/** The rest of the ways to walk a whole array: the passes that build, filter or fold one. */
const PASSES = ['map', 'filter', 'forEach', 'reduce'];

/**
 * Runs `run` with each named member of `prototype` replaced by a wrapper that adds `price(this)`
 * to a running total before calling the original, and returns the total. Everything is restored
 * in `finally`, so a throwing `run` cannot leave a prototype patched for the next test.
 */
function charge(
  prototype: object,
  keys: (string | symbol)[],
  price: (self: unknown) => number,
  run: () => void,
): number {
  let cost = 0;
  const patched = prototype as Record<string | symbol, unknown>;
  const originals = keys.map((key) => [key, patched[key]] as const);

  for (const [key, original] of originals) {
    patched[key] = function charged(this: unknown, ...args: unknown[]): unknown {
      cost += price(this);
      return (original as (...rest: unknown[]) => unknown).apply(this, args);
    };
  }

  try {
    run();
  } finally {
    for (const [key, original] of originals) patched[key] = original;
  }

  return cost;
}

const lengthOf = (self: unknown): number => (self as unknown[]).length;

/**
 * Charges every array scan inside `run` the length it had to walk, and returns the total.
 *
 * The proxy above cannot see this. A scan over an array the function built for itself touches
 * nothing the test owns, so the counter stays silent while the code goes quadratic — which is
 * exactly what happened the first time these tests were written, and they passed.
 *
 * A scan nested inside a pass is the commonest way linear code turns quadratic, so it gets its
 * own instrument. Scans over fixed-size arrays cost a constant and simply do not grow; only a
 * scan whose array grows with the room shows up when the size changes.
 */
export function scanCost(run: () => void): number {
  return charge(Array.prototype, SCANNERS, lengthOf, run);
}

/**
 * Charges the length of every pass over an array inside `run` — the scans above, plus `map`,
 * `filter`, `forEach`, `reduce` and the iterator that `for…of` and spread use.
 *
 * The tick works on copies it makes itself, and neither the record proxy nor `scanCost` ever
 * sees those: a loop over the tick's own list of bikes, nested in a loop over the same list,
 * touches nothing the test owns and scans nothing for a value. Only counting the passes
 * themselves catches it. Loops written with an index (`for (let i = 0; …)`) are invisible to
 * every instrument here; the rules use them for the hot path and are checked by review.
 */
export function traversalCost(run: () => void): number {
  return charge(Array.prototype, [...SCANNERS, ...PASSES, Symbol.iterator], lengthOf, run);
}

/**
 * Charges one for every keyed lookup or write on a `Map` or `Set` inside `run`.
 *
 * `traversalCost` is blind to a loop written with an index, and a settling loop that rebuilds a
 * `Set` and a `Map` on every pass is made of exactly those: it is quadratic in a chain of bikes
 * and neither the proxy, the scans nor the passes ever see it. What it cannot hide is the keyed
 * operations, one per bike per pass, so counting them makes the repetition visible.
 */
export function keyedCost(run: () => void): number {
  const mapOps = ['get', 'set', 'has', 'delete'];
  const setOps = ['add', 'has', 'delete'];
  let cost = 0;
  const one = (): number => 1;
  const inner = (): void => {
    cost += charge(Set.prototype, setOps, one, run);
  };
  cost += charge(Map.prototype, mapOps, one, inner);
  return cost;
}
