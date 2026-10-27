import { useLoader } from '@react-three/fiber';
import { TextureLoader } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ASSETS, SKY } from './scene/race-look';

/**
 * What the ring and its cars load when they mount, fetched while the players are still in the
 * lobby. These are the same loader and the same URLs `scene/ring.tsx` and `scene/race.tsx` pass
 * to `useLoader`, which is what makes its cache answer; `test/race-preload.test.ts` reads the
 * scene's source to see that the names have not drifted apart.
 */
export const RACE_MODELS = [
  'roadStraight',
  'roadCornerSmall',
  'roadCornerLarge',
  'roadCornerLarger',
  'raceCarRed',
].map((name) => `${ASSETS}/${name}.glb`);
export const RACE_TEXTURES = [
  'asphalt_track_diff_1k.jpg',
  'asphalt_track_nor_gl_1k.jpg',
  'leafy_grass_diff_1k.jpg',
  'leafy_grass_nor_gl_1k.jpg',
].map((name) => `${ASSETS}/${name}`);

export function preloadRace(): void {
  // The scene asks for the four road pieces and the car apart, so they are cached apart.
  useLoader.preload(GLTFLoader, RACE_MODELS.slice(0, 4));
  useLoader.preload(GLTFLoader, RACE_MODELS[4] as string);
  useLoader.preload(TextureLoader, RACE_TEXTURES);
  // The sky is read by drei's Environment, which has a cache of its own; warming the browser's is
  // the most that can be done from outside.
  fetch(SKY).catch(() => undefined);
}
