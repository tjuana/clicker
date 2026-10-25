import { Color, type InstancedBufferAttribute, Matrix4 } from 'three';
import { describe, expect, it } from 'vitest';
import type { WallOp } from '../src/client/cycles/model';
import { createWalls } from '../src/client/scene/walls';

const SIDE = 64;
const TICK_MS = 125;

const put = (cell: number, slot: number, from = -1): WallOp => ({ kind: 'put', cell, slot, from });
const lift = (cell: number): WallOp => ({ kind: 'lift', cell });

/** What the GPU would be given for one instance, read back through the mesh's public attributes. */
function instance(walls: ReturnType<typeof createWalls>, i: number) {
  const matrix = new Matrix4();
  const colour = new Color();
  walls.mesh.getMatrixAt(i, matrix);
  walls.mesh.getColorAt(i, colour);
  const laid = walls.mesh.geometry.getAttribute('laid').getX(i);
  return { matrix: matrix.elements.slice(), colour: colour.getHex(), laid };
}

function attributes(walls: ReturnType<typeof createWalls>): InstancedBufferAttribute[] {
  return [
    walls.mesh.instanceMatrix,
    walls.mesh.instanceColor as InstancedBufferAttribute,
    walls.mesh.geometry.getAttribute('laid') as InstancedBufferAttribute,
  ];
}

/** Stands in for the renderer, which clears the ranges after it uploads them. */
function uploaded(walls: ReturnType<typeof createWalls>): void {
  for (const attribute of attributes(walls)) attribute.clearUpdateRanges();
}

const rangeLength = (attribute: InstancedBufferAttribute): number =>
  attribute.updateRanges.reduce((sum, range) => sum + range.count, 0);

/** Element offsets and lengths an attribute will upload, as a sorted set: order and repeats do not matter. */
function ranges(attribute: InstancedBufferAttribute): { start: number; count: number }[] {
  const seen = new Map<string, { start: number; count: number }>();
  for (const { start, count } of attribute.updateRanges)
    seen.set(`${start}:${count}`, { start, count });
  return [...seen.values()].sort((a, b) => a.start - b.start);
}

describe('the walls', () => {
  it('moves matrix, colour and date together when a lift swaps the last wall into the hole', () => {
    const walls = createWalls(SIDE, TICK_MS);
    walls.lay([put(10, 1)], 1, false);
    walls.lay([put(11, 2, 10)], 2, false);
    walls.lay([put(12, 3, 11)], 3, false);
    const third = instance(walls, 2);
    const first = instance(walls, 0);
    expect(third.laid).not.toBe(instance(walls, 1).laid);

    walls.lay([lift(11)], 4, false);
    walls.flush();

    expect(walls.mesh.count).toBe(2);
    expect(instance(walls, 0)).toEqual(first);
    expect(instance(walls, 1)).toEqual(third);
  });

  it('dates a reset trail one tick apart, oldest first, each bike from its own length', () => {
    const walls = createWalls(SIDE, TICK_MS);
    walls.lay([put(10, 1), put(11, 1, 10), put(12, 1, 11)], 10, true);
    expect([0, 1, 2].map((i) => instance(walls, i).laid)).toEqual([1.0, 1.125, 1.25]);

    // Two bikes, interleaved with a longer trail first: the dates follow each slot's own count.
    walls.lay([put(20, 1), put(21, 1, 20), put(22, 1, 21), put(30, 2), put(31, 2, 30)], 10, true);
    expect([0, 1, 2, 3, 4].map((i) => instance(walls, i).laid)).toEqual([
      1.0, 1.125, 1.25, 1.125, 1.25,
    ]);
  });

  it('dates a put of an ordinary step by its own tick', () => {
    const walls = createWalls(SIDE, TICK_MS);
    walls.lay([put(10, 1)], 16, false);
    expect(instance(walls, 0).laid).toBe(2.0);
  });

  it('uploads as much for one put and one lift among 100 walls as among 1000', () => {
    const lengths: number[] = [];
    for (const n of [100, 1000]) {
      const walls = createWalls(SIDE, TICK_MS);
      const ops: WallOp[] = [];
      for (let k = 0; k < n; k += 1) ops.push(put(k, 1, k === 0 ? -1 : k - 1));
      walls.lay(ops, 5, false);
      walls.flush();
      uploaded(walls);

      walls.lay([put(n + 5, 2), lift(3)], 6, false);
      walls.flush();
      lengths.push(rangeLength(walls.mesh.instanceMatrix));
      expect(rangeLength(walls.mesh.instanceMatrix)).toBeLessThanOrEqual(32);
      expect(rangeLength(walls.mesh.instanceMatrix)).toBeGreaterThan(0);
    }
    expect(lengths[0]).toBe(lengths[1]);
  });

  it('clears the previous walls on a reset', () => {
    const walls = createWalls(SIDE, TICK_MS);
    walls.lay([put(1, 1), put(2, 1, 1), put(3, 1, 2)], 1, false);
    walls.lay([put(9, 2)], 2, true);
    walls.flush();
    expect(walls.mesh.count).toBe(1);
  });

  it('hands the GPU exactly the instances a step touched, in all three buffers', () => {
    const walls = createWalls(SIDE, TICK_MS);
    walls.lay([put(10, 1), put(11, 1, 10), put(12, 1, 11)], 1, false);
    walls.flush();
    uploaded(walls);
    const before = attributes(walls).map((a) => a.version);

    // A put appends at index 3; lifting cell 10 (index 0) moves the last instance, 3, into the hole.
    walls.lay([put(13, 2), lift(10)], 2, false);
    walls.flush();

    const sizes = [16, 3, 1];
    attributes(walls).forEach((attribute, k) => {
      const size = sizes[k] as number;
      expect(attribute.version).toBeGreaterThan(before[k] as number);
      expect(ranges(attribute)).toEqual([
        { start: 0, count: size },
        { start: 3 * size, count: size },
      ]);
    });
  });

  it('uploads the hole a lift fills, not the end it vacates', () => {
    const walls = createWalls(SIDE, TICK_MS);
    walls.lay([put(10, 1), put(11, 1, 10), put(12, 1, 11), put(13, 1, 12)], 1, false);
    walls.flush();
    uploaded(walls);

    walls.lay([lift(11)], 2, false);
    walls.flush();

    // Instance 3 moved into hole 1: only the hole is written, the vacated end is not.
    expect(ranges(walls.mesh.instanceMatrix)).toEqual([{ start: 16, count: 16 }]);
    expect(ranges(walls.mesh.instanceColor as InstancedBufferAttribute)).toEqual([
      { start: 3, count: 3 },
    ]);
  });

  it('lays a repeated full of the same round as a fresh walls object would', () => {
    const cells = [put(10, 1), put(11, 1, 10), put(12, 1, 11), put(30, 2), put(31, 2, 30)];
    const again = [...cells, put(32, 2, 31)];

    const walls = createWalls(SIDE, TICK_MS);
    walls.lay(cells, 10, true);
    walls.flush();
    walls.lay(again, 10, true);
    walls.flush();

    const fresh = createWalls(SIDE, TICK_MS);
    fresh.lay(again, 10, true);
    fresh.flush();

    expect(walls.mesh.count).toBe(6);
    expect(fresh.mesh.count).toBe(6);
    // Dates are left out: a cell held before keeps its own, by design.
    for (let i = 0; i < 6; i += 1) {
      expect(instance(walls, i).matrix).toEqual(instance(fresh, i).matrix);
      expect(instance(walls, i).colour).toEqual(instance(fresh, i).colour);
    }
  });

  it('keeps the pulse of a cell it already holds when a full of the same round arrives', () => {
    const walls = createWalls(SIDE, TICK_MS);
    walls.lay([put(10, 1), put(30, 2)], 1, false);
    walls.lay([put(11, 1, 10)], 2, false);
    // A boost lays two cells in one tick, a stall none: counting cells back would misdate all of it.
    walls.lay([put(12, 1, 11), put(13, 1, 12)], 3, false);
    walls.lay([put(14, 1, 13)], 4, false);
    const live = [0, 1, 2, 3, 4, 5].map((i) => instance(walls, i).laid);
    expect(live).toEqual([0.125, 0.125, 0.25, 0.375, 0.375, 0.5]);

    // The same round's full at tick 7: cell 30 now belongs to slot 3, cell 40 is new to this client.
    walls.lay(
      [
        put(10, 1),
        put(11, 1, 10),
        put(12, 1, 11),
        put(13, 1, 12),
        put(14, 1, 13),
        put(40, 1, 14),
        put(30, 3),
      ],
      7,
      true,
    );
    expect([0, 1, 2, 3, 4, 5, 6].map((i) => instance(walls, i).laid)).toEqual([
      0.125, 0.25, 0.375, 0.375, 0.5, 0.875, 0.875,
    ]);
  });
});
