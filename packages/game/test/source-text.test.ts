import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * A raw NUL makes git treat a whole file as binary, and a raw bidi override changes what a
 * reviewer reads without changing what the compiler sees. CLAUDE.md forbids both; this makes
 * the rule fail the build instead of waiting for someone to remember it. Every character is
 * written as an escape here, for the same reason.
 */

const ROOT = new URL('../../..', import.meta.url).pathname;
const ROOTS = ['packages', 'apps/game/src', 'apps/game/test', 'apps/game/e2e', 'docs', '.claude'];
const EXTENSION = /\.(ts|tsx|md|json|jsonc)$/;
// Code point ranges, not a regex literal: the formatter turns escapes inside one back into the raw
// characters. Tab (U+0009), line feed (U+000A) and carriage return (U+000D) are ordinary whitespace.
const INVISIBLE: ReadonlyArray<readonly [number, number]> = [
  [0x0000, 0x0008],
  [0x000b, 0x000c],
  [0x000e, 0x001f],
  [0x007f, 0x007f],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2066, 0x2069],
  [0xfeff, 0xfeff],
];

function hasInvisible(text: string): boolean {
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (INVISIBLE.some(([low, high]) => code >= low && code <= high)) return true;
  }
  return false;
}

function trackedFiles(): string[] {
  const listed = execFileSync('git', ['ls-files', '-z', '--', ...ROOTS], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return listed.split('\u0000').filter((path) => EXTENSION.test(path));
}

describe('source text', () => {
  it('holds no invisible characters', () => {
    const found: string[] = [];
    for (const path of trackedFiles()) {
      readFileSync(`${ROOT}${path}`, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          if (hasInvisible(line)) found.push(`${path}:${index + 1}`);
        });
    }
    expect(found).toEqual([]);
  });

  it('notices one', () => {
    expect(hasInvisible(`a${String.fromCodePoint(0x202e)}b`)).toBe(true);
    expect(hasInvisible('plain\ttext')).toBe(false);
  });
});
