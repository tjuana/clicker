import { describe, expect, it } from 'vitest';
import * as game from '../src/index';

describe('what the rules hand to a client that draws the track', () => {
  it('exports the units and the pieces of every track, as data', () => {
    expect(game.TILE).toBe(4096);
    expect(game.TURN).toBe(4096);
    const ring: game.TrackData | undefined = game.TRACKS.ring;
    const piece: game.Piece | undefined = ring?.pieces[0];
    expect(piece).toEqual({ kind: 'corner', size: 3, turn: 'right' });
    expect(ring?.pieces.length).toBeGreaterThan(8);
  });
});
