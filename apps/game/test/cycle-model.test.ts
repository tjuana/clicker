import { describe, expect, it } from 'vitest';
import { CYCLE_PART, createCycleGeometry } from '../src/client/scene/cycle-model';

describe('the light-cycle model', () => {
  const geometry = createCycleGeometry();
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;

  it('stands on the floor, points along +X and stands above the walls', () => {
    expect(box?.min.y).toBeCloseTo(0, 2);
    expect((box?.max.x ?? 0) - (box?.min.x ?? 0)).toBeGreaterThan(1.9);
    expect((box?.max.x ?? 0) - (box?.min.x ?? 0)).toBeLessThan(2.5);
    expect((box?.max.z ?? 0) - (box?.min.z ?? 0)).toBeLessThan(0.6);
    expect(box?.max.y ?? 0).toBeGreaterThan(0.8);
    // Nose forward: more of the bike lies ahead of its centre than behind the rear wheel's axle.
    expect(box?.max.x ?? 0).toBeGreaterThan(Math.abs(box?.min.x ?? 0));
  });

  it('gives the body id only to the body and nose, never to the canopy or the discs', () => {
    const parts = geometry.getAttribute('part');
    const position = geometry.getAttribute('position');
    expect(parts.count).toBe(position.count);
    const found = new Set<number>();
    for (let i = 0; i < parts.count; i += 1) {
      found.add(parts.getX(i));
      if (parts.getX(i) !== CYCLE_PART.body) continue;
      // The body box and the nose cone, in the model's own units before the 1.6 scale.
      const [x, y, z] = [position.getX(i) / 1.6, position.getY(i) / 1.6, position.getZ(i) / 1.6];
      expect(x).toBeGreaterThan(-0.45);
      expect(x).toBeLessThan(0.78);
      expect(y).toBeGreaterThan(0.26);
      expect(y).toBeLessThan(0.52);
      expect(Math.abs(z)).toBeLessThan(0.13);
    }
    expect([...found].sort()).toEqual([CYCLE_PART.dark, CYCLE_PART.body, CYCLE_PART.glow]);
  });
});
