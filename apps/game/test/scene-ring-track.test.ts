import { TILE, TRACKS } from '@clicker/game';
import type { Box3, BufferGeometry, Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { buildTrack, point } from '../../../packages/game/src/modes/race/track';
import corner2 from '../public/race/roadCornerLarge.glb?inline';
import corner3 from '../public/race/roadCornerLarger.glb?inline';
import corner1 from '../public/race/roadCornerSmall.glb?inline';
import straight from '../public/race/roadStraight.glb?inline';
import { BARRIER } from '../src/client/scene/race-look';
import {
  type Block,
  bake,
  blocks,
  type ModelName,
  placements,
  walk,
} from '../src/client/scene/ring-track';

const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];

/** Half the asphalt's width in tiles, measured from the Kit's straight (design section 2). */
const ASPHALT = 0.345;

/** The distance in the ground plane from (x, z) to the nearest vertex of a baked geometry. */
function nearest(geometry: BufferGeometry, x: number, z: number): number {
  const position = geometry.getAttribute('position');
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < position.count; i++) {
    best = Math.min(best, Math.hypot(position.getX(i) - x, position.getZ(i) - z));
  }
  return best;
}

/** The Kit's real files, decoded from the data URLs Vite inlines. */
async function load(url: string): Promise<Object3D> {
  const bytes = Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), (c) => c.charCodeAt(0));
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer, '');
  return gltf.scene;
}

const models = {
  straight: await load(straight),
  corner1: await load(corner1),
  corner2: await load(corner2),
  corner3: await load(corner3),
} satisfies Record<ModelName, Object3D>;

const ring = TRACKS.ring;
if (ring === undefined) throw new Error('the Ring is missing');
const pieces = walk(ring);

/**
 * The tiles a piece claims, worked out here from the piece list on its own: a straight's tiles
 * along its direction, a corner's s x s block with a corner on the ring's centre.
 */
function claimed(piece: number): Set<string> {
  const p = pieces[piece];
  if (p === undefined) throw new Error('no such piece');
  const tiles = new Set<string>();
  if (p.kind === 'straight') {
    for (let k = 0; k < p.tiles; k++) {
      const mx = p.x + (DX[p.dir] ?? 0) * (k + 0.5);
      const my = p.y + (DY[p.dir] ?? 0) * (k + 0.5);
      tiles.add(`${Math.floor(mx)},${Math.floor(my)}`);
    }
    return tiles;
  }
  const back = (p.side + 2) & 3;
  for (let a = 0; a < p.size; a++) {
    for (let b = 0; b < p.size; b++) {
      const tx = p.cx + (DX[back] ?? 0) * (a + 0.5) + (DX[p.dir] ?? 0) * (b + 0.5);
      const ty = p.cy + (DY[back] ?? 0) * (a + 0.5) + (DY[p.dir] ?? 0) * (b + 0.5);
      tiles.add(`${Math.floor(tx)},${Math.floor(ty)}`);
    }
  }
  return tiles;
}

describe('the ring race track', () => {
  it('starts where the rules say, in tiles', () => {
    expect(pieces[0]?.x).toBe(ring.start.x / TILE);
  });

  it('puts every piece of the Ring on the tiles it claims', () => {
    for (let piece = 0; piece < pieces.length; piece++) {
      const own = placements(pieces).filter((place) => place.piece === piece);
      const geometry = bake(models, own);
      const tiles = [...claimed(piece)].map((key) => key.split(',').map(Number));
      const xs = tiles.map(([x]) => x ?? 0);
      const ys = tiles.map(([, y]) => y ?? 0);
      // The claimed tiles' outer edges.
      const wanted = {
        minX: Math.min(...xs),
        maxX: Math.max(...xs) + 1,
        minZ: Math.min(...ys),
        maxZ: Math.max(...ys) + 1,
      };
      for (const layer of ['road', 'grass', 'kerb'] as const) {
        geometry[layer].computeBoundingBox();
        const box = geometry[layer].boundingBox as Box3;
        const slack = 1e-3;
        expect(box.min.x, `piece ${piece} ${layer} west`).toBeGreaterThanOrEqual(
          wanted.minX - slack,
        );
        expect(box.max.x, `piece ${piece} ${layer} east`).toBeLessThanOrEqual(wanted.maxX + slack);
        expect(box.min.z, `piece ${piece} ${layer} north`).toBeGreaterThanOrEqual(
          wanted.minZ - slack,
        );
        expect(box.max.z, `piece ${piece} ${layer} south`).toBeLessThanOrEqual(wanted.maxZ + slack);
      }
      // The tiles' bounds do not tell a corner from its mirror image, so also check the asphalt
      // meets its neighbours: it reaches both edges of the corridor where the piece is entered
      // and where it is left (the next piece's entry).
      const here = pieces[piece];
      const next = pieces[(piece + 1) % pieces.length];
      if (here === undefined || next === undefined) throw new Error('no such piece');
      for (const pose of [here, next]) {
        for (const side of [-1, 1]) {
          const x = pose.x - (DY[pose.dir] ?? 0) * side * ASPHALT;
          const z = pose.y + (DX[pose.dir] ?? 0) * side * ASPHALT;
          expect(nearest(geometry.road, x, z), `piece ${piece} road at (${x}, ${z})`).toBeLessThan(
            0.02,
          );
        }
      }
    }
  });

  it('stands no two tiles on one place', () => {
    const all = placements(pieces);
    const seen = new Set<string>();
    for (const place of all) {
      const key = `${Math.round(place.x * 2)},${Math.round(place.z * 2)}`;
      expect(seen.has(key), `two tiles at ${key}`).toBe(false);
      seen.add(key);
    }
  });
});

/** Whether two blocks' footprints overlap, by separating axes. */
function overlap(a: Block, b: Block): boolean {
  const corners = (block: Block) => {
    const c = Math.cos(block.yaw);
    const s = Math.sin(block.yaw);
    const hl = block.length / 2;
    const ht = BARRIER.thickness / 2;
    // A box rotated about +y by yaw: its long axis in the xz plane is (cos, -sin).
    return [
      [hl, ht],
      [hl, -ht],
      [-hl, -ht],
      [-hl, ht],
    ].map(([u, v]) => [
      block.x + (u ?? 0) * c + (v ?? 0) * s,
      block.z - (u ?? 0) * s + (v ?? 0) * c,
    ]);
  };
  const axes = (block: Block) => [
    [Math.cos(block.yaw), -Math.sin(block.yaw)],
    [Math.sin(block.yaw), Math.cos(block.yaw)],
  ];
  const ca = corners(a);
  const cb = corners(b);
  for (const [ax, az] of [...axes(a), ...axes(b)]) {
    const project = (points: number[][]) =>
      points.map(([x, z]) => (x ?? 0) * (ax ?? 0) + (z ?? 0) * (az ?? 0));
    const pa = project(ca);
    const pb = project(cb);
    if (Math.max(...pa) <= Math.min(...pb) + 1e-9 || Math.max(...pb) <= Math.min(...pa) + 1e-9) {
      return false;
    }
  }
  return true;
}

describe('the barriers', () => {
  const list = blocks(pieces);

  it('lays blocks down both sides', () => {
    expect(list.length).toBeGreaterThan(100);
  });

  it('never lets two blocks overlap, so none z-fights', () => {
    const clashes: string[] = [];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (a === undefined || b === undefined) continue;
        if (Math.hypot(a.x - b.x, a.z - b.z) > 2) continue;
        if (overlap(a, b)) clashes.push(`${i}/${j}`);
      }
    }
    expect(clashes).toEqual([]);
  });
});

/**
 * The scene is a drawing of the rules' track, so it is held to the rules' own geometry: a scene
 * that agrees only with itself (shifted a tile, or a corner turned a quarter) would draw the
 * barriers where the cars do not collide with them.
 */
describe('the scene track against the rules track', () => {
  const rules = buildTrack(ring);

  it('walks every piece to the same entry pose, ring and turn', () => {
    expect(pieces.length).toBe(rules.pieces.length);
    pieces.forEach((own, i) => {
      const theirs = rules.pieces[i];
      if (theirs === undefined) throw new Error('no such piece');
      expect(own.kind, `piece ${i} kind`).toBe(theirs.kind);
      expect([own.x, own.y, own.dir], `piece ${i} entry`).toEqual([
        theirs.x / TILE,
        theirs.y / TILE,
        theirs.dir,
      ]);
      if (own.kind === 'corner' && theirs.kind === 'corner') {
        expect([own.cx, own.cy, own.rc, own.side, own.right], `piece ${i} ring`).toEqual([
          theirs.cx / TILE,
          theirs.cy / TILE,
          theirs.rc / TILE,
          theirs.side,
          theirs.right,
        ]);
      }
    });
  });

  it('draws exactly the tiles the rules claim, each for its own piece', () => {
    const wanted = new Map<string, number>();
    for (const [key, owner] of rules.tiles) {
      const stride = 2 * 4096 + 1;
      wanted.set(`${Math.floor(key / stride) - 4096},${(key % stride) - 4096}`, owner);
    }
    const drawn = new Map<string, number>();
    for (const place of placements(pieces)) {
      const size = place.model === 'straight' ? 1 : Number(place.model.slice(6));
      for (let a = 0; a < size; a++) {
        for (let b = 0; b < size; b++) {
          drawn.set(
            `${Math.round(place.x - size / 2) + a},${Math.round(place.z - size / 2) + b}`,
            place.piece,
          );
        }
      }
    }
    expect(drawn).toEqual(wanted);
  });

  /** Whether the ground-plane point lies in any triangle of the geometry. */
  function covers(geometry: BufferGeometry, x: number, z: number): boolean {
    const position = geometry.getAttribute('position');
    const index = geometry.getIndex();
    const count = index === null ? position.count : index.count;
    const vertex = (n: number) => (index === null ? n : index.getX(n));
    for (let t = 0; t < count; t += 3) {
      const a = vertex(t);
      const b = vertex(t + 1);
      const c = vertex(t + 2);
      const side = (p: number, q: number) =>
        (position.getX(q) - position.getX(p)) * (z - position.getZ(p)) -
        (position.getZ(q) - position.getZ(p)) * (x - position.getX(p));
      const s1 = side(a, b);
      const s2 = side(b, c);
      const s3 = side(c, a);
      if ((s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0)) return true;
    }
    return false;
  }

  it('lays asphalt, kerb and grass at the lateral offsets the rules would put a car', () => {
    const expected = [
      [0, 'road'],
      [0.3, 'road'],
      [-0.3, 'road'],
      [0.38, 'kerb'],
      [-0.38, 'kerb'],
      [0.46, 'grass'],
      [-0.46, 'grass'],
    ] as const;
    pieces.forEach((_, i) => {
      const own = placements(pieces).filter((place) => place.piece === i);
      const geometry = bake(models, own);
      const length = rules.pieces[i]?.length ?? 0;
      for (const share of [0.1, 0.3, 0.5, 0.7, 0.9]) {
        for (const [lateral, layer] of expected) {
          const at = point(rules, i, length * share, lateral * TILE);
          expect(
            covers(geometry[layer], at.x / TILE, at.y / TILE),
            `piece ${i} at ${share} lateral ${lateral} wants ${layer}`,
          ).toBe(true);
        }
      }
    });
  });
});
