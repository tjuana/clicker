import { TILE, TURN } from './fixed';

/** Directions: 0 east, 1 south, 2 west, 3 north (y down), as the light cycles. */
export const DX = [1, 0, -1, 0];
export const DY = [0, 1, 0, -1];

export type Piece =
  | { kind: 'straight'; tiles: 1 | 2 }
  | { kind: 'corner'; size: 1 | 2 | 3; turn: 'left' | 'right' };

export interface TrackData {
  id: string;
  name: string;
  /** The midpoint of the first piece's entry edge, in units. */
  start: { x: number; y: number; dir: 0 | 1 | 2 | 3 };
  pieces: Piece[];
}

interface Base {
  /** Where the piece is entered, and the direction it is entered in. */
  x: number;
  y: number;
  dir: number;
  /** Distance round the centreline from the start line to this piece's entry. */
  start: number;
  length: number;
}

export interface BuiltStraight extends Base {
  kind: 'straight';
}

export interface BuiltCorner extends Base {
  kind: 'corner';
  right: boolean;
  /** The centre of the quarter ring, and the centreline's radius round it. */
  cx: number;
  cy: number;
  rc: number;
  /** The direction from the entry point to the centre. */
  side: number;
}

export type Built = BuiltStraight | BuiltCorner;

export interface Track {
  id: string;
  pieces: Built[];
  /** Round the centreline, in units. */
  length: number;
  /** Tile key to the piece that claims it. */
  tiles: Map<number, number>;
  /** The box of claimed tiles; the bump grid is indexed inside it. */
  bounds: { x: number; y: number; width: number; height: number };
}

export class TrackError extends Error {
  override name = 'TrackError';
}

const LIMIT = 4096;
const MIN_PIECES = 8;

/** Tile coordinates are bounded by `LIMIT`, so a key needs no hash. */
export function tileKey(tx: number, ty: number): number {
  return (tx + LIMIT) * (2 * LIMIT + 1) + (ty + LIMIT);
}

/** Of a vector, the parts along direction `d` and to its right. */
const along = (d: number, x: number, y: number) => x * (DX[d] ?? 0) + y * (DY[d] ?? 0);
const across = (d: number, x: number, y: number) => along((d + 1) & 3, x, y);

function fail(index: number, what: string): never {
  throw new TrackError(`piece ${index}: ${what}`);
}

export function buildTrack(data: TrackData): Track {
  const { start, pieces: chain } = data;
  if (!Number.isInteger(start.x) || !Number.isInteger(start.y)) fail0('the start must be integers');
  if (![0, 1, 2, 3].includes(start.dir)) fail0('the start direction must be 0, 1, 2 or 3');
  // The pose is an edge midpoint: a multiple of a tile across the way it faces' axis of travel,
  // half a tile on the other, so every tile the pieces claim is a whole one.
  const lengthwise = start.dir % 2 === 0 ? start.x : start.y;
  const sideways = start.dir % 2 === 0 ? start.y : start.x;
  if (lengthwise % TILE !== 0 || mod(sideways, TILE) !== TILE / 2) {
    fail0('the start must be the midpoint of a tile edge');
  }
  if (Math.abs(start.x) > LIMIT * TILE || Math.abs(start.y) > LIMIT * TILE) {
    fail0(`the start lies outside ±${LIMIT} tiles`);
  }
  if (chain.length < MIN_PIECES) fail0(`a track needs at least ${MIN_PIECES} pieces`);

  chain.forEach((piece, index) => {
    if (piece.kind === 'straight') {
      if (piece.tiles !== 1 && piece.tiles !== 2) fail(index, 'a straight is 1 or 2 tiles long');
    } else if (piece.kind === 'corner') {
      if (![1, 2, 3].includes(piece.size)) fail(index, 'a corner is of size 1, 2 or 3');
      if (piece.turn !== 'left' && piece.turn !== 'right')
        fail(index, 'a corner turns left or right');
    } else {
      fail(index, 'a piece is a straight or a corner');
    }
  });
  for (const index of [chain.length - 2, chain.length - 1]) {
    if (chain[index]?.kind !== 'straight') {
      fail(index, 'one of the last two pieces must be a straight: the grid stands on them');
    }
  }

  const pieces: Built[] = [];
  const tiles = new Map<number, number>();
  const claim = (x: number, y: number, index: number) => {
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    const key = tileKey(tx, ty);
    const owner = tiles.get(key);
    if (owner !== undefined) {
      fail(index, `claims tile (${tx}, ${ty}) already claimed by piece ${owner}`);
    }
    tiles.set(key, index);
  };

  let { x, y } = start;
  let dir: number = start.dir;
  let distance = 0;
  chain.forEach((piece, index) => {
    const dx = DX[dir] ?? 0;
    const dy = DY[dir] ?? 0;
    if (piece.kind === 'straight') {
      for (let k = 0; k < piece.tiles; k += 1) {
        claim(x + dx * (k * TILE + TILE / 2), y + dy * (k * TILE + TILE / 2), index);
      }
      const length = piece.tiles * TILE;
      pieces.push({ kind: 'straight', x, y, dir, start: distance, length });
      x += dx * length;
      y += dy * length;
      distance += length;
    } else {
      const right = piece.turn === 'right';
      const side = right ? (dir + 1) & 3 : (dir + 3) & 3;
      const rc = piece.size * TILE - TILE / 2;
      const cx = x + (DX[side] ?? 0) * rc;
      const cy = y + (DY[side] ?? 0) * rc;
      // The block of s × s tiles between the centre, the entry side and the way of travel.
      const back = (side + 2) & 3;
      for (let a = 0; a < piece.size; a += 1) {
        for (let b = 0; b < piece.size; b += 1) {
          const ua = a * TILE + TILE / 2;
          const ub = b * TILE + TILE / 2;
          claim(cx + (DX[back] ?? 0) * ua + dx * ub, cy + (DY[back] ?? 0) * ua + dy * ub, index);
        }
      }
      const length = Math.round((Math.PI / 2) * rc);
      pieces.push({ kind: 'corner', x, y, dir, start: distance, length, right, cx, cy, rc, side });
      x = cx + dx * rc;
      y = cy + dy * rc;
      dir = right ? (dir + 1) & 3 : (dir + 3) & 3;
      distance += length;
    }
    if (Math.abs(x) > LIMIT * TILE || Math.abs(y) > LIMIT * TILE) {
      fail(index, `leaves the ±${LIMIT} tiles the track may occupy`);
    }
  });

  const last = chain.length - 1;
  if (x !== start.x || y !== start.y || dir !== start.dir) {
    fail(last, `leaves at (${x}, ${y}) facing ${dir} and does not close on the start`);
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const key of tiles.keys()) {
    const tx = Math.floor(key / (2 * LIMIT + 1)) - LIMIT;
    const ty = (key % (2 * LIMIT + 1)) - LIMIT;
    minX = Math.min(minX, tx);
    maxX = Math.max(maxX, tx);
    minY = Math.min(minY, ty);
    maxY = Math.max(maxY, ty);
  }
  const bounds = { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
  return { id: data.id, pieces, length: distance, tiles, bounds };
}

function fail0(what: string): never {
  throw new TrackError(what);
}

function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/**
 * A point's place in a piece: distance along the centreline and across it, positive to the
 * right of travel. A straight is linear. A corner measures the angle round its centre by the
 * "diamond angle" — the share of the vector that points at the exit rather than the entry —
 * which needs no trigonometry and is monotonic over the quarter. Before the entry and past the
 * exit it carries on as a straight line instead, lateral included: the diamond angle turns back out there, and a
 * car that left through the exit would have its `along` shrink and never reach the next piece.
 */
export function project(
  track: Track,
  piece: number,
  x: number,
  y: number,
): { along: number; lateral: number } {
  const p = track.pieces[piece];
  if (!p) throw new RangeError(`no piece ${piece}`);
  const ex = x - p.x;
  const ey = y - p.y;
  if (p.kind === 'straight') return { along: along(p.dir, ex, ey), lateral: across(p.dir, ex, ey) };

  const vx = x - p.cx;
  const vy = y - p.cy;
  const radius = Math.round(Math.sqrt(vx * vx + vy * vy));
  const lateral = p.right ? p.rc - radius : radius - p.rc;
  const before = along(p.dir, ex, ey);
  const forward = along(p.dir, vx, vy);
  if (before < 0 && forward < 0) return { along: before, lateral: across(p.dir, ex, ey) };

  const exitDir = p.right ? (p.dir + 1) & 3 : (p.dir + 3) & 3;
  const fx = x - (p.cx + (DX[p.dir] ?? 0) * p.rc);
  const fy = y - (p.cy + (DY[p.dir] ?? 0) * p.rc);
  const past = along(exitDir, fx, fy);
  if (past > 0) return { along: p.length + past, lateral: across(exitDir, fx, fy) };

  const back = (p.side + 2) & 3;
  const a = Math.max(0, along(back, vx, vy));
  const b = Math.max(0, along(p.dir, vx, vy));
  return { along: a + b === 0 ? 0 : Math.round((b * p.length) / (a + b)), lateral };
}

/**
 * The inverse of `project` inside a piece, with the heading of the centreline there. Outside
 * `[0, length]` a corner is held at its ends.
 */
export function point(
  track: Track,
  piece: number,
  distance: number,
  lateral: number,
): { x: number; y: number; heading: number } {
  const p = track.pieces[piece];
  if (!p) throw new RangeError(`no piece ${piece}`);
  const quarter = p.dir * (TURN / 4);
  if (p.kind === 'straight') {
    return {
      x: p.x + (DX[p.dir] ?? 0) * distance + (DX[(p.dir + 1) & 3] ?? 0) * lateral,
      y: p.y + (DY[p.dir] ?? 0) * distance + (DY[(p.dir + 1) & 3] ?? 0) * lateral,
      heading: quarter,
    };
  }
  const own = Math.max(0, Math.min(p.length, distance));
  const back = (p.side + 2) & 3;
  // The direction from the centre, undone from the diamond angle and normalised.
  const ux = (DX[back] ?? 0) * (p.length - own) + (DX[p.dir] ?? 0) * own;
  const uy = (DY[back] ?? 0) * (p.length - own) + (DY[p.dir] ?? 0) * own;
  const norm = Math.sqrt(ux * ux + uy * uy);
  const radius = p.right ? p.rc - lateral : p.rc + lateral;
  const turn = Math.round((own * (TURN / 4)) / p.length);
  return {
    x: Math.round(p.cx + (ux * radius) / norm),
    y: Math.round(p.cy + (uy * radius) / norm),
    heading: (quarter + (p.right ? turn : -turn)) & (TURN - 1),
  };
}

/** Portals stepped at most per call: a car moves far less than a piece in a tick. */
const MAX_STEPS = 4;

/**
 * Project into `piece`, and while the car is beyond an end step to the neighbour sharing that
 * edge — DooM_42's portal walk. The cost is the steps taken, not the length of the track.
 * `crossed` is +1 when the start line was passed forward, -1 backward.
 */
export function walk(
  track: Track,
  piece: number,
  x: number,
  y: number,
): { piece: number; along: number; lateral: number; crossed: -1 | 0 | 1 } {
  const count = track.pieces.length;
  let crossed = 0;
  let current = piece;
  let place = project(track, current, x, y);
  for (let step = 0; step < MAX_STEPS; step += 1) {
    const length = track.pieces[current]?.length ?? 0;
    if (place.along > length) {
      current = (current + 1) % count;
      if (current === 0) crossed += 1;
    } else if (place.along < 0) {
      if (current === 0) crossed -= 1;
      current = (current + count - 1) % count;
    } else {
      break;
    }
    place = project(track, current, x, y);
  }
  return { piece: current, ...place, crossed: crossed as -1 | 0 | 1 };
}
