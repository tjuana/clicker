import { describe, expect, it } from 'vitest';
import { createWallKeys } from '../src/client/cycles/wall-keys';

describe('wall keys', () => {
  it('stays on while a second key is released: W, then the arrow, then the arrow up', () => {
    const keys = createWallKeys();
    expect(keys.press('KeyW')).toBe(true);
    expect(keys.press('ArrowUp')).toBe(false);
    expect(keys.release('ArrowUp')).toBe(false);
    expect(keys.held()).toBe(true);
    expect(keys.release('KeyW')).toBe(true);
    expect(keys.held()).toBe(false);
  });

  it('keeps the keyboard and the button from switching each other off', () => {
    const keys = createWallKeys();
    expect(keys.press('button')).toBe(true);
    expect(keys.press('KeyW')).toBe(false);
    expect(keys.release('button')).toBe(false);
    expect(keys.held()).toBe(true);
    expect(keys.release('KeyW')).toBe(true);
  });

  it('says off exactly once when focus is lost, and nothing when nothing was held', () => {
    const keys = createWallKeys();
    expect(keys.clear()).toBe(false);
    keys.press('KeyW');
    keys.press('button');
    expect(keys.clear()).toBe(true);
    expect(keys.clear()).toBe(false);
    expect(keys.held()).toBe(false);
  });

  it('ignores the release of something that was never down', () => {
    const keys = createWallKeys();
    expect(keys.release('KeyW')).toBe(false);
  });
});
