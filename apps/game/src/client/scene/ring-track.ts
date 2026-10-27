import { TILE, type TrackData } from '@clicker/game';
import {
  Box3,
  type BufferGeometry,
  Float32BufferAttribute,
  Group,
  type Material,
  Matrix4,
  type Mesh,
  type Object3D,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BARRIER, REPEAT, TILE_LIFT } from './race-look';

/**
 * The ring race's track as the scene needs it: where each of the Kit's tiles stands and where the
 * barrier blocks lie. Everything is in tiles, x east and z south (the rules' y), and is worked out
 * from the piece list alone. The scene never calls the rules' geometry: it is a drawing of the
 * pieces, and the centreline below is a quarter circle or a straight per piece, nothing more.
 */

const DX = [1, 0, -1, 0] as const;
const DY = [0, 1, 0, -1] as const;
const at = (table: readonly number[], index: number) => table[index & 3] ?? 0;

/** One piece with its entry pose and, for a corner, the ring it is a quarter of. */
export interface Walked {
  kind: 'straight' | 'corner';
  /** Entry midpoint and direction (0 east, 1 south, 2 west, 3 north). */
  x: number;
  y: number;
  dir: number;
  tiles: number;
  length: number;
  /** Corner only: the ring's centre and the centreline's radius. */
  cx: number;
  cy: number;
  rc: number;
  right: boolean;
  /** Corner only: the direction from the entry towards the ring's centre. */
  side: number;
  size: number;
}

export function walk(data: TrackData): Walked[] {
  let x = data.start.x / TILE;
  let y = data.start.y / TILE;
  let dir: number = data.start.dir;
  return data.pieces.map((piece): Walked => {
    const entry = { x, y, dir };
    if (piece.kind === 'straight') {
      x += at(DX, dir) * piece.tiles;
      y += at(DY, dir) * piece.tiles;
      return {
        ...entry,
        kind: 'straight',
        tiles: piece.tiles,
        length: piece.tiles,
        cx: 0,
        cy: 0,
        rc: 0,
        right: false,
        side: 0,
        size: 0,
      };
    }
    const right = piece.turn === 'right';
    const side = right ? (dir + 1) & 3 : (dir + 3) & 3;
    const rc = piece.size - 0.5;
    const cx = x + at(DX, side) * rc;
    const cy = y + at(DY, side) * rc;
    x = cx + at(DX, dir) * rc;
    y = cy + at(DY, dir) * rc;
    dir = right ? (dir + 1) & 3 : (dir + 3) & 3;
    return {
      ...entry,
      kind: 'corner',
      tiles: 1,
      length: (Math.PI / 2) * rc,
      cx,
      cy,
      rc,
      right,
      side,
      size: piece.size,
    };
  });
}

/** The Kit's models: a straight, and the three quarter rings (size 1, 2, 3). */
export type ModelName = 'straight' | 'corner1' | 'corner2' | 'corner3';

export interface Placement {
  piece: number;
  model: ModelName;
  /** The centre of the model's bounds in the world, in tiles. */
  x: number;
  z: number;
  /** Rotation about +y. The Kit's tiles face -z; the rules' heading 0 is east (+x). */
  yaw: number;
}

/** A model facing -z, turned to face game direction `dir` (0 east, 1 south, ...). */
const yawOf = (dir: number) => (3 * Math.PI) / 2 - (dir * Math.PI) / 2;

export function placements(pieces: readonly Walked[]): Placement[] {
  const out: Placement[] = [];
  pieces.forEach((p, piece) => {
    if (p.kind === 'straight') {
      for (let k = 0; k < p.tiles; k++) {
        out.push({
          piece,
          model: 'straight',
          x: p.x + at(DX, p.dir) * (k + 0.5),
          z: p.y + at(DY, p.dir) * (k + 0.5),
          yaw: yawOf(p.dir),
        });
      }
      return;
    }
    // The block of s x s tiles whose corner is the ring's centre: it spreads from the centre back
    // away from the side and forwards along the entry direction.
    const back = (p.side + 2) & 3;
    const half = p.size / 2;
    // A left turn is the right-turn model entered one direction later (mirror of the same shape).
    const entry = p.right ? p.dir : (p.dir + 1) & 3;
    out.push({
      piece,
      model: `corner${p.size}` as ModelName,
      x: p.cx + (at(DX, back) + at(DX, p.dir)) * half,
      z: p.cy + (at(DY, back) + at(DY, p.dir)) * half,
      yaw: yawOf(entry),
    });
  });
  return out;
}

export type Layer = 'road' | 'grass' | 'kerb';
export const LAYERS: readonly Layer[] = ['road', 'grass', 'kerb'];

/** The Kit names its kerb `grey` on straights and leaves it `_defaultMat` on corners. */
const layerOf = (material: Material): Layer => {
  if (material.name === 'road') return 'road';
  if (material.name === 'grass') return 'grass';
  return 'kerb';
};

const scratch = new Matrix4();

/**
 * Bakes the placed tiles into one geometry per material, with UVs from the world position (the
 * Kit's own UVs are palette coordinates). The cloned geometry is the caller's to dispose; the
 * models are not touched.
 */
export function bake(
  models: Record<ModelName, Object3D>,
  placed: readonly Placement[],
): Record<Layer, BufferGeometry> {
  const parts: Record<Layer, BufferGeometry[]> = { road: [], grass: [], kerb: [] };
  const centres = new Map<Object3D, Vector3>();
  const box = new Box3();
  for (const place of placed) {
    const model = models[place.model];
    // The Kit's root node carries an offset of its own (-0.35, -0.01, -0.65): centre by the real
    // bounds, never by the mesh data.
    let centre = centres.get(model);
    if (centre === undefined) {
      model.updateWorldMatrix(true, true);
      centre = box.setFromObject(model).getCenter(new Vector3());
      centres.set(model, centre);
    }
    const group = new Group();
    const copy = model.clone(true);
    copy.position.set(-centre.x, TILE_LIFT, -centre.z);
    group.add(copy);
    group.position.set(place.x, 0, place.z);
    group.rotation.y = place.yaw;
    group.updateMatrixWorld(true);
    group.traverse((object) => {
      const mesh = object as Mesh;
      if (!mesh.isMesh) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const layer = layerOf(materials[0] as Material);
      const geometry = mesh.geometry.clone().applyMatrix4(scratch.copy(mesh.matrixWorld));
      const position = geometry.getAttribute('position');
      const uv = new Float32Array(position.count * 2);
      for (let i = 0; i < position.count; i++) {
        uv[2 * i] = position.getX(i) * REPEAT[layer];
        uv[2 * i + 1] = position.getZ(i) * REPEAT[layer];
      }
      geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2));
      parts[layer].push(geometry);
    });
  }
  const merged = {} as Record<Layer, BufferGeometry>;
  for (const layer of LAYERS) {
    const geometry = mergeGeometries(parts[layer]);
    for (const part of parts[layer]) part.dispose();
    if (geometry === null) throw new Error(`the track has no ${layer} geometry`);
    merged[layer] = geometry;
  }
  return merged;
}

export interface Block {
  x: number;
  z: number;
  /** Rotation about +y that lays a box's long side along the centreline. */
  yaw: number;
  /** The block's length along the centreline's tangent. */
  length: number;
  red: boolean;
}

/** The centreline at distance `along` into a piece, with its tangent and the unit vector to its right. */
function centreline(p: Walked, along: number) {
  if (p.kind === 'straight') {
    const tx = at(DX, p.dir);
    const ty = at(DY, p.dir);
    return { x: p.x + tx * along, y: p.y + ty * along, tx, ty, rx: -ty, ry: tx };
  }
  // The ring's centre is `rc` from the entry towards `side`; the car sweeps from the direction
  // pointing back at the entry to the one pointing at the exit.
  const angle = (along / p.length) * (Math.PI / 2);
  const back = (p.side + 2) & 3;
  const ux = at(DX, back) * Math.cos(angle) + at(DX, p.dir) * Math.sin(angle);
  const uy = at(DY, back) * Math.cos(angle) + at(DY, p.dir) * Math.sin(angle);
  // Clockwise (y down) for a right turn: the tangent is u turned a quarter the way the car turns.
  const sign = p.right ? 1 : -1;
  const tx = -sign * uy;
  const ty = sign * ux;
  return { x: p.cx + ux * p.rc, y: p.cy + uy * p.rc, tx, ty, rx: -ty, ry: tx };
}

/**
 * How far a wall at `lateral` (positive to the right of travel) is from the ring's centre, as a
 * multiple of the centreline's radius; 1 on a straight. The right is the inside of a right turn.
 */
const radiusShare = (p: Walked, lateral: number) =>
  p.kind === 'straight' ? 1 : (p.rc - (p.right ? lateral : -lateral)) / p.rc;

/** Whether the inner wall of a piece shrinks to nothing: the small corner's inside is a point. */
const vanishes = (p: Walked, lateral: number) =>
  p.kind === 'corner' && radiusShare(p, lateral) * p.rc < BARRIER.minRadius;

/**
 * Red and white blocks down both sides of the corridor. Each block is exactly its share of the
 * wall on its own side, so neighbours meet without overlapping; on a curve the outer side is
 * longer and the inner shorter in proportion to their radii.
 */
export function blocks(pieces: readonly Walked[]): Block[] {
  const out: Block[] = [];
  const count = [0, 0];
  pieces.forEach((p, i) => {
    const before = pieces[(i + pieces.length - 1) % pieces.length] as Walked;
    const after = pieces[(i + 1) % pieces.length] as Walked;
    const steps = Math.max(2, Math.round(p.length * BARRIER.perTile));
    for (let k = 0; k < steps; k++) {
      const along = ((k + 0.5) / steps) * p.length;
      const c = centreline(p, along);
      [-1, 1].forEach((sign, side) => {
        const lateral = sign * BARRIER.lateral;
        if (vanishes(p, lateral)) return;
        const slot = p.length / steps;
        let length =
          slot *
          radiusShare(p, lateral) *
          (p.kind === 'corner' ? BARRIER.curveShare : BARRIER.straightShare);
        // Where the wall on this side runs into a neighbour whose inner wall vanished, the two
        // walls meet at a right angle and their squares would cross: stand back from the corner.
        if (
          (k === 0 && vanishes(before, lateral)) ||
          (k === steps - 1 && vanishes(after, lateral))
        ) {
          length -= BARRIER.cornerGap;
        }
        const index = count[side] ?? 0;
        count[side] = index + 1;
        out.push({
          x: c.x + c.rx * lateral,
          z: c.y + c.ry * lateral,
          yaw: -Math.atan2(c.ty, c.tx),
          length,
          red: index % 2 === 0,
        });
      });
    }
  });
  return out;
}

/** The box of the placed tiles, for the sun's shadow camera and the overview. */
export function bounds(pieces: readonly Walked[]) {
  const box = new Box3();
  const half = new Vector3();
  for (const place of placements(pieces)) {
    const size = place.model === 'straight' ? 1 : Number(place.model.slice(6));
    half.set(size / 2, 0, size / 2);
    box.expandByPoint(new Vector3(place.x, 0, place.z).sub(half));
    box.expandByPoint(new Vector3(place.x, 0, place.z).add(half));
  }
  return box;
}
