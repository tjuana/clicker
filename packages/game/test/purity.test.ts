import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { apply } from '../src/room/apply';
import { nextDeadline } from '../src/room/deadline';
import { abortRound, syncConnections } from '../src/room/recovery';
import { createRoomState } from '../src/room/state';
import { config } from './support';

/**
 * The rules are pure, and until now that was a sentence in CLAUDE.md held up by nothing. One
 * `Date.now()` is all it takes: the same state would stop producing the same result, replaying
 * a round from storage would drift, and every test in this package would become a function of
 * the clock. The property is cheap to keep and expensive to recover, so it is checked.
 *
 * Two layers, because each has a blind spot the other covers. Reading the source catches code
 * no test reaches; stubbing the globals catches a call made indirectly, through something the
 * source scan sees as an innocent function call.
 */

const SOURCE = new URL('../src', import.meta.url).pathname;

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

/** Comments talk about `Date.now()` precisely because it is banned; only code counts. */
function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

const AMBIENT = [
  ['Date.now', /\bDate\s*\.\s*now\b/],
  ['new Date', /\bnew\s+Date\b/],
  ['Math.random', /\bMath\s*\.\s*random\b/],
  ['performance.now', /\bperformance\s*\.\s*now\b/],
  ['crypto', /\bcrypto\s*\./],
  ['globalThis', /\bglobalThis\b/],
  ['process', /\bprocess\s*\./],
  ['a timer', /\bset(?:Timeout|Interval)\s*\(/],
  ['fetch', /\bfetch\s*\(/],
  ['console', /\bconsole\s*\./],
] as const;

describe('the rules in their source', () => {
  const files = sources(SOURCE);

  it('reads the whole package', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it.each(AMBIENT)('never reaches for %s', (_name, pattern) => {
    const offenders = files.filter((path) => pattern.test(code(path)));
    expect(offenders).toEqual([]);
  });

  /**
   * No imports but its own. The layer below the rules is empty by design: anything the rules
   * need arrives as an argument, so a dependency here is the first step of the server leaking
   * downwards into them.
   */
  it('imports nothing but itself', () => {
    const foreign = files.flatMap((path) =>
      Array.from(code(path).matchAll(/\bfrom\s+'([^']+)'/g))
        .map((match) => match[1] ?? '')
        .filter((specifier) => !specifier.startsWith('.'))
        .map((specifier) => `${path}: ${specifier}`),
    );
    expect(foreign).toEqual([]);
  });
});

/** Replaces every ambient source of time and randomness with a trap, for the duration of `run`. */
function sealed<T>(run: () => T): T {
  const realNow = Date.now;
  const realRandom = Math.random;
  const trap = (name: string) => () => {
    throw new Error(`${name} reached from packages/game: it must arrive as a parameter`);
  };

  Date.now = trap('Date.now()');
  Math.random = trap('Math.random()');
  try {
    return run();
  } finally {
    Date.now = realNow;
    Math.random = realRandom;
  }
}

describe('the rules at runtime', () => {
  /** A whole round, so the trap is in place across every phase and not just the easy one. */
  it('plays a full round without once asking the world what time it is', () => {
    expect(() =>
      sealed(() => {
        const settings = config();
        let state = createRoomState();

        state = apply(
          state,
          { type: 'join', playerId: 'a', connectionId: 'c1', name: 'Anna', hostKey: 'k' },
          0,
          settings,
        ).state;
        state = apply(
          state,
          { type: 'join', playerId: 'b', connectionId: 'c2', name: 'Boris' },
          0,
          settings,
        ).state;
        state = apply(state, { type: 'start', playerId: 'a' }, 100, settings).state;

        const goAt = state.round?.goAt ?? 0;
        for (let click = 0; click < 5; click += 1) {
          state = apply(
            state,
            { type: 'input', playerId: 'b', input: { type: 'click' } },
            goAt + click * 100,
            settings,
          ).state;
        }

        nextDeadline(state, settings);
        state = apply(state, { type: 'tick' }, goAt + settings.roundMs + 1000, settings).state;
        state = apply(
          state,
          { type: 'leave', playerId: 'b', connectionId: 'c2' },
          goAt + settings.roundMs + 2000,
          settings,
        ).state;

        syncConnections(state, { a: ['c1'] }, goAt + settings.roundMs + 3000);
        abortRound(state);
      }),
    ).not.toThrow();
  });
});
