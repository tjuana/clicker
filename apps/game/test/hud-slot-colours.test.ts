import { describe, expect, it } from 'vitest';
import { SLOT_COLOURS } from '../src/client/scene/look';
import { raceColour, slotColour } from '../src/client/slot-colours';

const sceneHex = (index: number): string =>
  `#${(SLOT_COLOURS[index % SLOT_COLOURS.length] as { getHexString(): string }).getHexString()}`;

describe('the HUD names a player in the colour the scene paints them', () => {
  it('in the arena, where slots count from one', () => {
    for (let slot = 1; slot <= 20; slot++) {
      expect(slotColour(slot).toLowerCase(), `slot ${slot}`).toBe(sceneHex(slot - 1));
    }
  });

  it('in the race, where slots count from zero', () => {
    for (let slot = 0; slot < 20; slot++) {
      expect(raceColour(slot).toLowerCase(), `slot ${slot}`).toBe(sceneHex(slot));
    }
  });
});
