import { BRAKE, GAS, LEFT, RIGHT } from '@clicker/game';
import { describe, expect, it } from 'vitest';
import { createRaceKeys } from '../src/client/race/keys';

describe('race keys', () => {
  it('combines held keys into a mask', () => {
    const keys = createRaceKeys();
    expect(keys.press('KeyW')).toBe(true);
    expect(keys.press('KeyD')).toBe(true);
    expect(keys.mask()).toBe(GAS | RIGHT);
    expect(keys.press('KeyS')).toBe(true);
    expect(keys.press('ArrowLeft')).toBe(true);
    expect(keys.mask()).toBe(GAS | BRAKE | LEFT | RIGHT);
  });

  it('keeps a bit while another source still holds it, and says so only when the mask changes', () => {
    const keys = createRaceKeys();
    expect(keys.press('KeyW')).toBe(true);
    expect(keys.press('ArrowUp')).toBe(false);
    expect(keys.press('button-gas')).toBe(false);
    expect(keys.release('KeyW')).toBe(false);
    expect(keys.release('ArrowUp')).toBe(false);
    expect(keys.mask()).toBe(GAS);
    expect(keys.release('button-gas')).toBe(true);
    expect(keys.mask()).toBe(0);
  });

  it('does not let a release clear a different bit', () => {
    const keys = createRaceKeys();
    keys.press('KeyW');
    keys.press('button-left');
    expect(keys.release('KeyW')).toBe(true);
    expect(keys.mask()).toBe(LEFT);
  });

  it('says clear once, and ignores keys that mean nothing', () => {
    const keys = createRaceKeys();
    expect(keys.clear()).toBe(false);
    expect(keys.press('KeyQ')).toBe(false);
    expect(keys.release('KeyQ')).toBe(false);
    keys.press('KeyW');
    keys.press('KeyA');
    expect(keys.clear()).toBe(true);
    expect(keys.clear()).toBe(false);
    expect(keys.mask()).toBe(0);
  });
});
