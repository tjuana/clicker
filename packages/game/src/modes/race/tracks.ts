import { TILE } from './fixed';
import type { Piece, TrackData } from './track';

const S = (tiles: 1 | 2): Piece => ({ kind: 'straight', tiles });
const R = (size: 1 | 2 | 3): Piece => ({ kind: 'corner', size, turn: 'right' });
const L = (size: 1 | 2 | 3): Piece => ({ kind: 'corner', size, turn: 'left' });

/**
 * 29.28 tiles round in a 10 × 9 box. The start line is where the main straight ends, so the
 * grid stands on the last two straights.
 */
const RING: TrackData = {
  id: 'ring',
  name: 'The Ring',
  start: { x: 6 * TILE, y: TILE / 2, dir: 0 },
  pieces: [R(3), S(2), R(3), S(2), L(1), R(1), S(1), R(3), S(2), S(1), R(3), S(2), S(2)],
};

export const TRACKS: Record<string, TrackData> = { [RING.id]: RING };
