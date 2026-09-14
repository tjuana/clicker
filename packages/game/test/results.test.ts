import { describe, expect, it } from 'vitest';
import { comparePublicIds, computeResults } from '../src/modes/clicker/results';
import { score } from './support';

describe('computeResults', () => {
  it('puts the biggest score first and numbers the ranks', () => {
    const rows = computeResults(
      {
        '1': score({ clicks: 10, lastCountedAt: 500 }),
        '2': score({ clicks: 30, lastCountedAt: 500 }),
        '3': score({ clicks: 20, lastCountedAt: 500 }),
      },
      { '1': 'Аня', '2': 'Боря', '3': 'Вера' },
    );

    expect(rows.map((row) => [row.name, row.rank])).toEqual([
      ['Боря', 1],
      ['Вера', 2],
      ['Аня', 3],
    ]);
  });

  it('gives an equal score to whoever reached it first', () => {
    const rows = computeResults(
      {
        '1': score({ clicks: 10, lastCountedAt: 900 }),
        '2': score({ clicks: 10, lastCountedAt: 700 }),
      },
      { '1': 'Аня', '2': 'Боря' },
    );

    expect(rows.map((row) => row.name)).toEqual(['Боря', 'Аня']);
  });

  it('falls back to publicId when nobody clicked', () => {
    const rows = computeResults({ '2': score(), '1': score() }, { '2': 'Боря', '1': 'Аня' });

    expect(rows.map((row) => row.name)).toEqual(['Аня', 'Боря']);
    expect(rows.every((row) => row.clicks === 0)).toBe(true);
  });

  it('breaks a full tie by publicId as a number, not as a string', () => {
    const rows = computeResults(
      {
        '10': score({ clicks: 10, lastCountedAt: 700 }),
        '2': score({ clicks: 10, lastCountedAt: 700 }),
      },
      { '10': 'Боря', '2': 'Аня' },
    );

    expect(rows.map((row) => row.publicId)).toEqual(['2', '10']);
  });
});

describe('comparePublicIds', () => {
  it('orders ids as numbers', () => {
    expect(comparePublicIds('2', '10')).toBeLessThan(0);
    expect(comparePublicIds('10', '2')).toBeGreaterThan(0);
    expect(comparePublicIds('7', '7')).toBe(0);
  });

  it('sorts a list the way a string sort would not', () => {
    expect(['10', '2', '1'].sort(comparePublicIds)).toEqual(['1', '2', '10']);
  });
});
