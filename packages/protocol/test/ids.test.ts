import { describe, expect, it } from 'vitest';
import { generateId, isId } from '../src/ids';

describe('generateId', () => {
  it('makes a 22 character id that passes the check', () => {
    const id = generateId();

    expect(id).toHaveLength(22);
    expect(isId(id)).toBe(true);
  });

  it('does not repeat itself', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => generateId()));

    expect(ids.size).toBe(1000);
  });
});

describe('isId', () => {
  it('rejects a wrong length', () => {
    expect(isId('short')).toBe(false);
    expect(isId('a'.repeat(23))).toBe(false);
  });

  it('rejects characters outside base64url', () => {
    expect(isId(`${'a'.repeat(21)}+`)).toBe(false);
    expect(isId(`${'a'.repeat(21)}/`)).toBe(false);
  });
});
