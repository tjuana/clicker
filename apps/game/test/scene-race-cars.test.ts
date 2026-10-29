import { RACE, TILE, TURN } from '@clicker/game';
import {
  Box3,
  BufferGeometry,
  Color,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  type Object3D,
  Vector3,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import car from '../public/race/raceCarRed.glb?inline';
import type { Sample } from '../src/client/race/timeline';
import { SLOT_COLOURS } from '../src/client/scene/look';
import { bakeCar, carYaw, chasePlace, paintBodies, poseCars } from '../src/client/scene/race-cars';
import { CAR, CHASE } from '../src/client/scene/race-look';

async function loadCar(): Promise<Object3D> {
  const bytes = Uint8Array.from(atob(car.slice(car.indexOf(',') + 1)), (c) => c.charCodeAt(0));
  return (await new GLTFLoader().parseAsync(bytes.buffer, '')).scene;
}

/** Where the car's nose goes when it is turned for a heading: its +z, rotated about +y. */
function nose(heading: number): Vector3 {
  return new Vector3(0, 0, 1).applyAxisAngle(new Vector3(0, 1, 0), carYaw(heading));
}

describe('the baked car', () => {
  it('is 0.3 tile long, centred on its footprint with the wheels on the ground', async () => {
    const parts = await bakeCar(await loadCar());
    const box = new Box3();
    for (const part of parts) {
      part.geometry.computeBoundingBox();
      box.union(part.geometry.boundingBox as Box3);
    }
    expect(box.max.z - box.min.z).toBeCloseTo(CAR.length, 4);
    expect(box.min.y).toBeCloseTo(0, 4);
    expect((box.min.x + box.max.x) / 2).toBeCloseTo(0, 4);
    expect((box.min.z + box.max.z) / 2).toBeCloseTo(0, 4);
  });

  it('is drawn no wider than the two circles it collides as, so it never sinks into a barrier', async () => {
    const parts = await bakeCar(await loadCar());
    const box = new Box3();
    for (const part of parts) {
      part.geometry.computeBoundingBox();
      box.union(part.geometry.boundingBox as Box3);
    }
    const collides = (2 * RACE.radius) / TILE;
    expect(box.max.x - box.min.x).toBeLessThanOrEqual(collides + 0.01);
  });

  it('keeps one part per material, the body white for the slot colour to show', async () => {
    const parts = await bakeCar(await loadCar());
    const names = parts.map((part) => part.material.name);
    expect(new Set(names).size).toBe(names.length);
    const body = parts.find((part) => part.material.name === CAR.bodyMaterial);
    expect(body).toBeDefined();
    expect((body?.material as MeshBasicMaterial | undefined)?.color.getHexString()).toBe('ffffff');
  });
});

describe('which way the car faces', () => {
  it('points its nose along the heading: east at 0, south a quarter turn on', () => {
    // The Kit's car faces +z while its tiles face -z: with the tiles' turn alone it drove backwards.
    const east = nose(0);
    expect([east.x, east.z]).toEqual([expect.closeTo(1, 6), expect.closeTo(0, 6)]);
    const south = nose(TURN / 4);
    expect([south.x, south.z]).toEqual([expect.closeTo(0, 6), expect.closeTo(1, 6)]);
    const west = nose(TURN / 2);
    expect(west.x).toBeCloseTo(-1, 6);
  });
});

describe('posing the cars', () => {
  const sample = (slots: number[]): Sample => ({
    alpha: 0,
    count: slots.length,
    cars: slots.map((slot, k) => ({
      slot,
      x: (k + 1) * TILE,
      y: 2 * TILE,
      heading: 0,
      speed: 0,
      lap: 0,
      flags: 0,
      alpha: 0,
    })),
  });
  const mesh = () => new InstancedMesh(new BufferGeometry(), new MeshBasicMaterial(), CAR.capacity);
  const where = (m: InstancedMesh, i: number) => {
    const matrix = new Matrix4();
    m.getMatrixAt(i, matrix);
    return new Vector3().setFromMatrixPosition(matrix);
  };

  it('puts a car at the instance of its slot, in tiles, and hides the slots not in the race', () => {
    const m = mesh();
    poseCars([m], sample([3, 1]));
    expect(where(m, 3).toArray()).toEqual([1, 0, 2]);
    expect(where(m, 1).toArray()).toEqual([2, 0, 2]);
    const gone = new Matrix4();
    m.getMatrixAt(0, gone);
    expect(gone.determinant()).toBe(0);
  });

  it('hides a car that has left since the last frame', () => {
    const m = mesh();
    poseCars([m], sample([0, 1]));
    poseCars([m], sample([1]));
    const matrix = new Matrix4();
    m.getMatrixAt(0, matrix);
    expect(matrix.determinant()).toBe(0);
  });

  it('skips a slot past the instances instead of writing out of bounds', () => {
    const m = mesh();
    expect(() => poseCars([m], sample([CAR.capacity + 4]))).not.toThrow();
  });
});

describe('painting the car bodies', () => {
  it('paints every car body a slot colour, the thirteenth like the first', () => {
    // The palette is shorter than the grid: instances past it keep three's default white unless
    // the slot wraps.
    const m = new InstancedMesh(new BufferGeometry(), new MeshBasicMaterial(), CAR.capacity);
    paintBodies(m);
    const got = new Color();
    for (let slot = 0; slot < CAR.capacity; slot++) {
      m.getColorAt(slot, got);
      expect(got.getHex()).toBe((SLOT_COLOURS[slot % SLOT_COLOURS.length] as Color).getHex());
    }
  });
});

describe('the chase camera place', () => {
  it('stands behind and above the car and looks ahead of it', () => {
    const stand = new Vector3();
    const look = new Vector3();
    chasePlace(5, 6, Math.PI / 2, stand, look); // heading south
    expect(stand.x).toBeCloseTo(5, 6);
    expect(stand.z).toBeCloseTo(6 - CHASE.behind, 6);
    expect(stand.y).toBe(CHASE.above);
    expect(look.z).toBeCloseTo(6 + CHASE.ahead, 6);
  });
});
