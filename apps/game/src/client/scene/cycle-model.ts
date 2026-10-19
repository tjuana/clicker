import {
  BoxGeometry,
  type BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Brightness each part is multiplied by before the slot's colour: the rims and the side stripe
 * glow, the body stays dark. The same split as a wall and its edge — bloom only finds the bright
 * part, so the bike reads as a lit outline rather than a glowing block.
 */
const GLOW = 1;
const BODY = 0.32;
const DARK = 0.16;
const SIZE = 1.6;

function tinted(geometry: BufferGeometry, brightness: number): BufferGeometry {
  const count = geometry.getAttribute('position').count;
  geometry.setAttribute(
    'color',
    new Float32BufferAttribute(new Array<number>(count * 3).fill(brightness), 3),
  );
  return geometry;
}

function wheel(x: number): BufferGeometry[] {
  // A torus lies in the XY plane with its axis along Z: already a wheel rolling along X.
  const rim = new TorusGeometry(0.24, 0.05, 8, 24).translate(x, 0.29, 0);
  const disc = new CylinderGeometry(0.21, 0.21, 0.08, 20)
    .rotateX(Math.PI / 2)
    .translate(x, 0.29, 0);
  return [tinted(rim, GLOW), tinted(disc, DARK)];
}

/**
 * A light cycle, built from primitives so no model file has to be downloaded or licensed. It
 * points along +X, the direction of `dir` 0, sits on y = 0 and is about 2.2 cells long and 0.9
 * tall, so it stands well above the wall it lays.
 */
export function createCycleGeometry(): BufferGeometry {
  const parts = [
    ...wheel(-0.46),
    ...wheel(0.48),
    // The body between the wheels, a little above them, and its nose.
    tinted(new BoxGeometry(0.92, 0.2, 0.22).translate(0.02, 0.39, 0), BODY),
    tinted(new ConeGeometry(0.12, 0.3, 4).rotateZ(-Math.PI / 2).translate(0.62, 0.39, 0), BODY),
    // The rider's canopy.
    tinted(new SphereGeometry(1, 12, 8).scale(0.3, 0.11, 0.13).translate(-0.06, 0.52, 0), DARK),
    // The stripe along both flanks: the part that glows when the bike is seen side-on.
    tinted(new BoxGeometry(0.98, 0.035, 0.235).translate(0.04, 0.43, 0), GLOW),
  ];
  const merged = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  if (merged === null) throw new Error('light cycle parts do not share attributes');
  // Drawn at 1.6: at one cell long the bike sank into its own wall and vanished behind the camera.
  return merged.scale(SIZE, SIZE, SIZE);
}
