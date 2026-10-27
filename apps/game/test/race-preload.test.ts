import { describe, expect, it } from 'vitest';
import race from '../src/client/scene/race.tsx?raw';
import ring from '../src/client/scene/ring.tsx?raw';

describe('what the lobby preloads for the race', () => {
  it('names the files the scene loads', async () => {
    // Imported here and not at the top: the module pulls in three.js.
    const { RACE_MODELS, RACE_TEXTURES } = await import('../src/client/race-preload');
    // The scene builds the road names from a table; the car and the textures are spelled out.
    const source = `${ring}\n${race}`;
    for (const url of [...RACE_MODELS, ...RACE_TEXTURES]) {
      const name = (url.split('/').pop() as string).replace(/\.(glb|jpg)$/, '');
      expect(source, name).toContain(name);
    }
  });
});
