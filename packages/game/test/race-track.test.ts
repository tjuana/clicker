import { describe, expect, it } from 'vitest';
import { TILE, TURN } from '../src/modes/race/fixed';
import {
  buildTrack,
  DX,
  DY,
  type Piece,
  point,
  project,
  type TrackData,
  TrackError,
  walk,
} from '../src/modes/race/track';
import { TRACKS } from '../src/modes/race/tracks';

const ring = TRACKS.ring as TrackData;
const track = buildTrack(ring);

const S = (tiles: 1 | 2): Piece => ({ kind: 'straight', tiles });
const R = (size: 1 | 2 | 3): Piece => ({ kind: 'corner', size, turn: 'right' });

function withPieces(pieces: Piece[]): TrackData {
  return { ...ring, pieces };
}

/** Where the message of a failed build points, or fails the test if the build succeeded. */
function faultOf(data: TrackData): string {
  try {
    buildTrack(data);
  } catch (error) {
    expect(error).toBeInstanceOf(TrackError);
    return (error as Error).message;
  }
  throw new Error('the track was accepted');
}

describe('the Ring', () => {
  it('is 29.28 tiles round, to a unit per corner', () => {
    const tiles = 12 + 5 * Math.PI + Math.PI / 2;
    expect(Math.abs(track.length - tiles * TILE)).toBeLessThanOrEqual(6);
  });

  it('lays its pieces end to end', () => {
    let start = 0;
    track.pieces.forEach((piece) => {
      expect(piece.start).toBe(start);
      start += piece.length;
    });
    expect(start).toBe(track.length);
  });

  it('claims fifty tiles inside a 10 by 9 box, each by one piece', () => {
    expect(track.tiles.size).toBe(50);
    expect([track.bounds.width, track.bounds.height]).toEqual([10, 9]);
  });
});

describe('the validator', () => {
  it('refuses a chain that does not close, naming the piece that misses the start', () => {
    const pieces = [...ring.pieces.slice(0, -1), S(1)];
    expect(faultOf(withPieces(pieces))).toMatch(/piece 12\b.*close/);
  });

  it('refuses a piece that sits on a tile another one claimed, naming both', () => {
    // Four one-tile corners make a loop and return to the start; the fifth lies on the first.
    const pieces = [R(1), R(1), R(1), R(1), R(1), R(1), S(1), S(1)];
    expect(faultOf(withPieces(pieces))).toMatch(/piece 4\b.*piece 0\b/);
  });

  it('refuses a corner among the last two pieces: the grid stands on straights', () => {
    const pieces = [...ring.pieces.slice(0, -1), R(1)];
    expect(faultOf(withPieces(pieces))).toMatch(/piece 12\b.*straight/);
  });

  it('refuses a track of fewer than eight pieces', () => {
    expect(faultOf(withPieces([S(1), S(1), S(1), S(1)]))).toMatch(/8 pieces/);
  });

  it('refuses a piece out of range, naming it', () => {
    const pieces = ring.pieces.slice();
    pieces[3] = { kind: 'straight', tiles: 3 as 1 };
    expect(faultOf(withPieces(pieces))).toMatch(/piece 3\b/);
    pieces[3] = { kind: 'corner', size: 4 as 1, turn: 'left' };
    expect(faultOf(withPieces(pieces))).toMatch(/piece 3\b/);
  });

  it('refuses a start that is not an integer, not on an edge midpoint, or too far away', () => {
    for (const start of [
      { ...ring.start, x: ring.start.x + 0.5 },
      { ...ring.start, y: ring.start.y + 1 },
      { ...ring.start, x: 5000 * TILE },
      { ...ring.start, dir: 4 as 0 },
    ]) {
      expect(faultOf({ ...ring, start })).toMatch(/start/);
    }
  });
});

describe('project and point', () => {
  // Past 0.345 the asphalt is over; the wall stands at 0.4 for a car of radius 0.1, and beside
  // the centre of a one-tile corner the angle is too sensitive to a unit of rounding to ask more.
  const LATERALS = [-0.3, -0.15, 0, 0.15, 0.3].map((l) => Math.round(l * TILE));

  it('return a point to where it came from, on every piece', () => {
    const worst: string[] = [];
    track.pieces.forEach((piece, index) => {
      for (let step = 0; step <= 16; step += 1) {
        const along = Math.round((piece.length * step) / 16);
        for (const lateral of LATERALS) {
          const p = point(track, index, along, lateral);
          const q = project(track, index, p.x, p.y);
          if (Math.abs(q.along - along) > 2 || Math.abs(q.lateral - lateral) > 2) {
            worst.push(`piece ${index} ${along}/${lateral}: ${q.along}/${q.lateral}`);
          }
        }
      }
    });
    expect(worst).toEqual([]);
  });

  it('give the centreline of a straight in a straight line facing the way it runs', () => {
    const p = point(track, 1, 1000, 0);
    const start = point(track, 1, 0, 0);
    expect(p.heading).toBe(start.heading);
    expect(p.heading % (TURN / 4)).toBe(0);
    expect(Math.hypot(p.x - start.x, p.y - start.y)).toBeCloseTo(1000, 0);
  });

  it('turn the heading by a quarter turn over a corner, to the right or to the left', () => {
    const turned = (index: number) => {
      const first = point(track, index, 0, 0).heading;
      const last = point(track, index, track.pieces[index]?.length ?? 0, 0).heading;
      return (last - first + TURN) % TURN;
    };
    expect(turned(0)).toBe(TURN / 4); // R3
    expect(turned(4)).toBe((3 * TURN) / 4); // L1
  });

  it('put the right of travel at positive lateral', () => {
    const p = point(track, 1, 0, 500);
    const centre = point(track, 1, 0, 0);
    // The first straight runs south after the first right turn: its right is west.
    expect(p.x - centre.x).toBe(-500);
    expect(p.y).toBe(centre.y);
  });

  it('keep going as a straight line past either end of a corner, along growing monotonically', () => {
    track.pieces.forEach((piece, index) => {
      if (piece.kind !== 'corner') return;
      const exit = track.pieces[(index + 1) % track.pieces.length];
      if (!exit) throw new Error('no exit');
      const rx = (exit.dir + 1) & 3;
      for (const lateral of [-0.3, 0, 0.3].map((l) => l * TILE)) {
        let previous = Number.NEGATIVE_INFINITY;
        for (let s = -0.4 * TILE; s <= 0.8 * TILE; s += 128) {
          const x = exit.x + (DX[exit.dir] ?? 0) * s + (DX[rx] ?? 0) * lateral;
          const y = exit.y + (DY[exit.dir] ?? 0) * s + (DY[rx] ?? 0) * lateral;
          const { along } = project(track, index, Math.round(x), Math.round(y));
          expect(along, `piece ${index}, s ${s}, lateral ${lateral}`).toBeGreaterThan(previous);
          previous = along;
        }
      }
    });
  });

  it('measure along linearly before the entry of a corner as well', () => {
    const entry = track.pieces[0];
    if (!entry) throw new Error('no piece');
    const back = project(track, 0, entry.x - 300, entry.y);
    expect(back.along).toBe(-300);
    expect(Math.abs(back.lateral)).toBeLessThanOrEqual(2);
  });
});

describe('walk', () => {
  const exitOf = (index: number) => {
    const next = track.pieces[(index + 1) % track.pieces.length];
    if (!next) throw new Error('no piece');
    return next;
  };

  it('stays in the piece while the car is inside it', () => {
    const p = point(track, 1, 2000, 100);
    expect(walk(track, 1, p.x, p.y)).toMatchObject({ piece: 1, along: 2000, crossed: 0 });
  });

  it('steps onto the next piece at the exit edge', () => {
    const edge = exitOf(1);
    const walked = walk(
      track,
      1,
      edge.x + 100 * (DX[edge.dir] ?? 0),
      edge.y + 100 * (DY[edge.dir] ?? 0),
    );
    expect(walked).toMatchObject({ piece: 2, crossed: 0 });
    expect(walked.along).toBeGreaterThan(0);
    expect(walked.along).toBeLessThan(200);
  });

  it('steps back at the entry edge', () => {
    const entry = track.pieces[2];
    if (!entry) throw new Error('no piece');
    const walked = walk(
      track,
      2,
      entry.x - 100 * (DX[entry.dir] ?? 0),
      entry.y - 100 * (DY[entry.dir] ?? 0),
    );
    expect(walked.piece).toBe(1);
    expect(walked.crossed).toBe(0);
    expect(Math.abs((track.pieces[1]?.length ?? 0) - walked.along - 100)).toBeLessThanOrEqual(2);
  });

  it('reports crossing the start line forward and backward', () => {
    const last = track.pieces.length - 1;
    const line = track.pieces[0];
    if (!line) throw new Error('no piece');
    const dx = DX[line.dir] ?? 0;
    const dy = DY[line.dir] ?? 0;
    const forward = walk(track, last, line.x + 50 * dx, line.y + 50 * dy);
    expect(forward).toMatchObject({ piece: 0, crossed: 1 });
    expect(forward.along).toBeGreaterThan(0);
    const backward = walk(track, 0, line.x - 50 * dx, line.y - 50 * dy);
    expect(backward).toMatchObject({ piece: last, crossed: -1 });
    expect(backward.along).toBeLessThan(track.pieces[last]?.length ?? 0);
  });
});
