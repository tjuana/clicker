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
    get(target, key, receiver) {
      tally.touches += 1;
      return Reflect.get(target, key, receiver);
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
  let cost = 0;
  const prototype = Array.prototype as unknown as Record<string, unknown>;
  const originals = SCANNERS.map((name) => [name, prototype[name]] as const);

  for (const [name, original] of originals) {
    prototype[name] = function scanned(this: unknown[], ...args: unknown[]): unknown {
      cost += this.length;
      return (original as (...rest: unknown[]) => unknown).apply(this, args);
    };
  }

  try {
    run();
  } finally {
    for (const [name, original] of originals) prototype[name] = original;
  }

  return cost;
}
