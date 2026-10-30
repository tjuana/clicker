import type { InstancedBufferAttribute, ShaderMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { createPool } from '../src/client/scene/particles';
import { DUST } from '../src/client/scene/race-look';

const NAMES = ['origin', 'velocity', 'timing'] as const;

function pool(capacity: number) {
  const p = createPool(capacity, DUST);
  const attr = (name: string) => p.mesh.geometry.getAttribute(name) as InstancedBufferAttribute;
  const slot = (name: string, i: number) => Array.from(attr(name).array.slice(i * 3, i * 3 + 3));
  /** The renderer clears the ranges after it uploads them; with no renderer, the test does. */
  const uploaded = () => {
    for (const n of NAMES) attr(n).clearUpdateRanges();
  };
  return { p, attr, slot, uploaded };
}

const birth = (p: ReturnType<typeof createPool>, k: number, now = 0) =>
  p.spawn(k, k + 0.5, k + 0.25, 1, 2, 3, 0.9, 0.08, now);

/** Slots covered by an attribute's update ranges, as sorted indices. */
function covered(a: InstancedBufferAttribute): number[] {
  const out: number[] = [];
  for (const r of a.updateRanges) {
    for (let e = r.start; e < r.start + r.count; e += a.itemSize) out.push(e / a.itemSize);
  }
  return out.sort((x, y) => x - y);
}

describe('the particle pool', () => {
  it('holds what was passed in the slot born, and changes nothing else', () => {
    const { p, slot, attr } = pool(8);
    const before = Array.from(attr('origin').array);
    p.spawn(1, 2, 3, 4, 5, 6, 0.9, 0.08, 2.5);
    p.tick(2.5);
    expect(slot('origin', 0)).toEqual([1, 2, 3]);
    expect(slot('velocity', 0)).toEqual([4, 5, 6]);
    const t = slot('timing', 0);
    expect(t[0]).toBeCloseTo(2.5);
    expect(t[1]).toBeCloseTo(0.9);
    expect(t[2]).toBeCloseTo(0.08);
    const after = Array.from(attr('origin').array);
    expect(after.slice(3)).toEqual(before.slice(3));
  });

  it('writes the next slot for the next birth', () => {
    const { p, slot } = pool(8);
    birth(p, 1);
    birth(p, 2);
    expect(slot('origin', 0)[0]).toBe(1);
    expect(slot('origin', 1)[0]).toBe(2);
  });

  it('overwrites the oldest when full, and never grows', () => {
    const { p, slot, attr } = pool(4);
    const lengths = NAMES.map((n) => attr(n).array.length);
    for (let k = 1; k <= 5; k += 1) birth(p, k);
    expect(slot('origin', 0)[0]).toBe(5);
    expect(slot('origin', 1)[0]).toBe(2);
    expect(NAMES.map((n) => attr(n).array.length)).toEqual(lengths);
    expect(p.mesh.geometry.instanceCount).toBe(4);
  });

  it('uploads exactly the slots written since the last tick, as one range', () => {
    const { p, attr, uploaded } = pool(10);
    birth(p, 1);
    birth(p, 2);
    birth(p, 3);
    p.tick(0);
    for (const n of NAMES) {
      expect(attr(n).updateRanges).toHaveLength(1);
      expect(covered(attr(n))).toEqual([0, 1, 2]);
    }
    uploaded();
    birth(p, 4);
    birth(p, 5);
    p.tick(0.1);
    for (const n of NAMES) expect(covered(attr(n))).toEqual([3, 4]);
  });

  it('uploads two ranges when the ring wrapped between ticks', () => {
    const { p, attr, uploaded } = pool(5);
    for (let k = 0; k < 4; k += 1) birth(p, k);
    p.tick(0);
    uploaded();
    for (let k = 0; k < 3; k += 1) birth(p, k);
    p.tick(0.1);
    for (const n of NAMES) {
      expect(attr(n).updateRanges).toHaveLength(2);
      expect(covered(attr(n))).toEqual([0, 1, 4]);
    }
  });

  it('keeps the births of a frame the renderer skipped, until it uploads', () => {
    const { p, attr, uploaded } = pool(10);
    birth(p, 1);
    p.tick(0);
    birth(p, 2);
    birth(p, 3);
    p.tick(0.1);
    for (const n of NAMES) expect(covered(attr(n))).toEqual([0, 1, 2]);
    uploaded();
    birth(p, 4);
    p.tick(0.2);
    for (const n of NAMES) expect(covered(attr(n))).toEqual([3]);
  });

  it('makes no range objects of its own once the renderer has uploaded', () => {
    const { p, attr, uploaded } = pool(10);
    birth(p, 1);
    p.tick(0);
    const first = NAMES.map((n) => attr(n).updateRanges[0]);
    uploaded();
    birth(p, 2);
    p.tick(0.1);
    NAMES.forEach((n, i) => {
      expect(attr(n).updateRanges[0]).toBe(first[i]);
    });
  });

  it('uploads nothing in a tick with no births', () => {
    const { p, attr, uploaded } = pool(10);
    birth(p, 1);
    p.tick(0);
    uploaded();
    const versions = NAMES.map((n) => attr(n).version);
    p.tick(0.1);
    p.tick(0.2);
    expect(NAMES.map((n) => attr(n).version)).toEqual(versions);
    for (const n of NAMES) expect(attr(n).updateRanges).toHaveLength(0);
  });

  it('flags an upload when something was born', () => {
    const { p, attr } = pool(10);
    const versions = NAMES.map((n) => attr(n).version);
    birth(p, 1);
    p.tick(0);
    NAMES.forEach((n, i) => {
      expect(attr(n).version).toBeGreaterThan(versions[i] as number);
    });
  });

  it('converts its colour to the canvas, as every other material does', () => {
    const { p } = pool(4);
    expect((p.mesh.material as ShaderMaterial).fragmentShader).toContain(
      '#include <colorspace_fragment>',
    );
  });

  it('hands the shader the time it was ticked with', () => {
    const { p } = pool(4);
    p.tick(12.5);
    expect((p.mesh.material as ShaderMaterial).uniforms.time?.value).toBeCloseTo(12.5);
  });

  it('draws every slot whatever is alive', () => {
    const { p } = pool(16);
    expect(p.mesh.geometry.instanceCount).toBe(16);
    for (let k = 0; k < 40; k += 1) birth(p, k);
    p.tick(1000);
    expect(p.mesh.geometry.instanceCount).toBe(16);
  });

  it('uploads every slot, inside the array, after more births than slots in a frame', () => {
    const { p, attr } = pool(16);
    for (let k = 0; k < 40; k += 1) birth(p, k);
    p.tick(1);
    for (const n of NAMES) {
      for (const r of attr(n).updateRanges) {
        expect(r.start).toBeGreaterThanOrEqual(0);
        expect(r.start + r.count).toBeLessThanOrEqual(attr(n).array.length);
      }
      expect(covered(attr(n))).toEqual(Array.from({ length: 16 }, (_, i) => i));
    }
  });

  it('writes in a frame as much as it was born, however large the pool', () => {
    const changed = (capacity: number): { elements: number; uploaded: number } => {
      const { p, attr } = pool(capacity);
      const before = NAMES.map((n) => Array.from(attr(n).array));
      for (let k = 1; k <= 10; k += 1) birth(p, k, 1);
      p.tick(1);
      let elements = 0;
      NAMES.forEach((n, i) => {
        const a = attr(n).array;
        for (let e = 0; e < a.length; e += 1) if (a[e] !== before[i]?.[e]) elements += 1;
      });
      const uploaded = NAMES.reduce(
        (sum, n) => sum + attr(n).updateRanges.reduce((s, r) => s + r.count, 0),
        0,
      );
      return { elements, uploaded };
    };
    const small = changed(1_000);
    const large = changed(10_000);
    expect(small.uploaded).toBeGreaterThan(0);
    expect(large).toEqual(small);
  });
});
