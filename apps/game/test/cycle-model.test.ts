import { describe, expect, it } from 'vitest';
import { createCycleGeometry } from '../src/client/scene/cycle-model';

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

  it('carries a brightness per vertex, so only rims and stripe reach the bloom', () => {
    const colours = geometry.getAttribute('color');
    expect(colours.count).toBe(geometry.getAttribute('position').count);
    const values = new Set<number>();
    for (let i = 0; i < colours.count; i += 1) values.add(Math.round(colours.getX(i) * 100));
    expect([...values].sort((a, b) => a - b)).toEqual([16, 32, 100]);
  });
});
