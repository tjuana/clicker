import { describe, expect, it } from 'vitest';
import { createCycleGeometry } from '../src/client/scene/cycle-model';
import { CYCLE_BODY, CYCLE_DARK, CYCLE_GLOW } from '../src/client/scene/look';

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

  it('tells the parts apart by level: rims brightest, body between, discs and canopy darkest', () => {
    const levels = geometry.getAttribute('level');
    expect(levels.count).toBe(geometry.getAttribute('position').count);
    const found = new Set<number>();
    for (let i = 0; i < levels.count; i += 1) found.add(Math.round(levels.getX(i) * 1000) / 1000);
    expect([...found].sort((a, b) => a - b)).toEqual([CYCLE_DARK, CYCLE_BODY, CYCLE_GLOW]);
    expect(CYCLE_DARK).toBeLessThan(CYCLE_BODY);
    expect(CYCLE_BODY).toBeLessThan(CYCLE_GLOW);
  });

  it('has no stripe box: the flank stripe is drawn by the shader, not built', () => {
    // The body box is 0.92 x 0.2 x 0.22 and the stripe box was 0.235 wide, wider than the body: a
    // vertex out there is a stripe box.
    const z = geometry.getAttribute('position');
    let widest = 0;
    for (let i = 0; i < z.count; i += 1) {
      if (Math.abs(z.getY(i) / 1.6 - 0.43) < 0.02)
        widest = Math.max(widest, Math.abs(z.getZ(i)) / 1.6);
    }
    expect(widest).toBeLessThan(0.115);
  });
});
