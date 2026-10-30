import { Color } from 'three';
import { describe, expect, it } from 'vitest';
import { BIKE_COLOURS, DIM_COLOURS, glowFor } from '../src/client/scene/look';
import { createWalls } from '../src/client/scene/walls';
import { slotColour } from '../src/client/slots';

/** A colour's hue as the share of each channel: the glow tables are the hex scaled, so this survives the scaling. */
const chroma = (c: { r: number; g: number; b: number }): number[] => {
  const sum = c.r + c.g + c.b;
  return [c.r / sum, c.g / sum, c.b / sum];
};

const named = (slot: number): number[] => chroma(new Color(slotColour(slot)));

/** Arena slots run 1 to 20 on a 20-rider grid: past the twelve hues, so the wrap is held too. */
const SLOTS = Array.from({ length: 20 }, (_, i) => i + 1);

describe("a slot's colour in the scene is the one the HUD names it in", () => {
  it('paints the bike, lit or not, in the hue of slotColour', () => {
    for (const slot of SLOTS) {
      for (const table of [BIKE_COLOURS, DIM_COLOURS]) {
        expect(chroma(glowFor(table, slot))).toEqual(
          named(slot).map((share) => expect.closeTo(share, 6)),
        );
      }
    }
  });

  it('lays the wall in the hue of slotColour', () => {
    for (const slot of SLOTS) {
      const walls = createWalls(64, 125);
      walls.lay([{ kind: 'put', cell: 10, slot, from: -1 }], 1, false);
      const painted = new Color();
      walls.mesh.getColorAt(0, painted);
      expect(chroma(painted)).toEqual(named(slot).map((share) => expect.closeTo(share, 6)));
    }
  });
});
