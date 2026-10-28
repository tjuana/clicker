import {
  BoxGeometry,
  type BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  MeshBasicMaterial,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import {
  CYCLE_BODY,
  CYCLE_DARK,
  CYCLE_GLOW,
  CYCLE_RIM,
  CYCLE_RIM_EXPONENT,
  CYCLE_SEAM,
  CYCLE_STRIPE,
  SEAM_SPACING,
  SEAM_WIDTH,
  STRIPE_HALF,
  STRIPE_Y,
} from './look';

const SIZE = 1.6;

/**
 * Which material a vertex belongs to (RTR 6.5, material mapping). The shader maps the id to a base
 * level from look.ts and gives only the body seams and the stripe, so any level can be retuned by
 * eye without changing which parts get the pattern: a level used as the id broke when two parts'
 * levels came close.
 */
export const CYCLE_PART = { dark: 0, body: 1, glow: 2 } as const;
type Part = (typeof CYCLE_PART)[keyof typeof CYCLE_PART];

/**
 * One float per vertex, the part id. The colour attribute could not carry it: three multiplies the
 * instance colour into it before the fragment sees it.
 */
function tinted(geometry: BufferGeometry, part: Part): BufferGeometry {
  const count = geometry.getAttribute('position').count;
  geometry.setAttribute('part', new Float32BufferAttribute(new Array<number>(count).fill(part), 1));
  return geometry;
}

function wheel(x: number): BufferGeometry[] {
  // A torus lies in the XY plane with its axis along Z: already a wheel rolling along X.
  const rim = new TorusGeometry(0.24, 0.05, 8, 24).translate(x, 0.29, 0);
  const disc = new CylinderGeometry(0.21, 0.21, 0.08, 20)
    .rotateX(Math.PI / 2)
    .translate(x, 0.29, 0);
  return [tinted(rim, CYCLE_PART.glow), tinted(disc, CYCLE_PART.dark)];
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
    tinted(new BoxGeometry(0.92, 0.2, 0.22).translate(0.02, 0.39, 0), CYCLE_PART.body),
    tinted(
      new ConeGeometry(0.12, 0.3, 4).rotateZ(-Math.PI / 2).translate(0.62, 0.39, 0),
      CYCLE_PART.body,
    ),
    // The rider's canopy.
    tinted(
      new SphereGeometry(1, 12, 8).scale(0.3, 0.11, 0.13).translate(-0.06, 0.52, 0),
      CYCLE_PART.dark,
    ),
  ];
  const merged = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  if (merged === null) throw new Error('light cycle parts do not share attributes');
  // Drawn at 1.6: at one cell long the bike sank into its own wall and vanished behind the camera.
  return merged.scale(SIZE, SIZE, SIZE);
}

const glsl = (value: number): string => value.toFixed(4);

/**
 * The bikes' material: a MeshBasicMaterial whose shader draws the surface from the model's own
 * coordinates, so one instanced draw serves every bike and no texture is read. Body panels seams
 * (RTR 6.3 procedural texturing) and the flank stripe are line coverage from fwidth, a box filter
 * over the pixel, so a line is a pixel wide with a soft edge at any distance; when seams come
 * closer than about two pixels (a far bike) they fade to their average instead of shimmering.
 * The stripe is a band in the shader and not a box in the geometry: less geometry, and it
 * antialiases the same way. A Fresnel rim (RTR 9.5) lifts every grazing edge.
 */
export function createCycleMaterial(): MeshBasicMaterial {
  const material = new MeshBasicMaterial({ toneMapped: false });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float part;
varying float vPart;
varying vec3 vObj;
varying vec3 vViewNormal;
varying vec3 vViewPos;`,
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
vPart = part;
vObj = position;
vViewNormal = normalize(normalMatrix * mat3(instanceMatrix) * normal);
vViewPos = mvPosition.xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying float vPart;
varying vec3 vObj;
varying vec3 vViewNormal;
varying vec3 vViewPos;
// Share of a pixel (fw wide) that a band of half-width h, d away from its centre, covers.
float band(float d, float h, float fw) {
  return clamp(h - d + 0.5 * fw, 0.0, min(2.0 * h, fw)) / fw;
}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
float isBody = 1.0 - step(0.5, abs(vPart - ${CYCLE_PART.body}.0));
float base = mix(
  mix(${glsl(CYCLE_DARK)}, ${glsl(CYCLE_BODY)}, step(0.5, vPart)),
  ${glsl(CYCLE_GLOW)},
  step(1.5, vPart));
vec2 fw = max(fwidth(vObj.xy), vec2(1e-5));
float toSeam = abs(fract(vObj.x / ${glsl(SEAM_SPACING)} - 0.5) - 0.5) * ${glsl(SEAM_SPACING)};
float seam = mix(
  ${glsl(SEAM_WIDTH / SEAM_SPACING)},
  band(toSeam, ${glsl(SEAM_WIDTH / 2)}, fw.x),
  smoothstep(2.0, 4.0, ${glsl(SEAM_SPACING)} / fw.x));
float stripe = band(abs(vObj.y - ${glsl(STRIPE_Y)}), ${glsl(STRIPE_HALF)}, fw.y);
float level = mix(base, ${glsl(CYCLE_SEAM)}, seam * isBody);
level = mix(level, ${glsl(CYCLE_STRIPE)}, stripe * isBody);
float rim = pow(max(1.0 - abs(dot(normalize(vViewNormal), normalize(-vViewPos))), 0.0), ${glsl(CYCLE_RIM_EXPONENT)});
diffuseColor.rgb *= level + ${glsl(CYCLE_RIM)} * rim;`,
      );
  };
  return material;
}
