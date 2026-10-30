import {
  type Blending,
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
} from 'three';

type UpdateRange = { start: number; count: number };

export interface PoolLook {
  colour: string;
  blending: Blending;
  /** Downward acceleration, tiles/s². */
  gravity: number;
  /** How much a particle grows over its life: 1 doubles it. */
  grow: number;
  opacity: number;
}

const VERTEX = `attribute vec3 origin;
attribute vec3 velocity;
attribute vec3 timing;
uniform float time;
uniform float gravity;
uniform float grow;
varying float vAge;
varying vec2 vUv;
void main() {
  float age = time - timing.x;
  float t = age / max(timing.y, 1e-4);
  float alive = step(0.0, age) * step(t, 1.0);
  vec3 p = origin + velocity * age - vec3(0.0, 0.5 * gravity * age * age, 0.0);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  mv.xy += position.xy * timing.z * (1.0 + grow * t) * alive;
  gl_Position = projectionMatrix * mv;
  vAge = t;
  vUv = uv;
}`;

const FRAGMENT = `uniform vec3 colour;
uniform float opacity;
varying float vAge;
varying vec2 vUv;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float a = (1.0 - smoothstep(0.5, 1.0, d)) * (1.0 - vAge) * opacity;
  gl_FragColor = vec4(colour, a);
}`;

export function createPool(capacity: number, look: PoolLook) {
  const quad = new PlaneGeometry(1, 1);
  const geometry = new InstancedBufferGeometry();
  geometry.index = quad.index;
  geometry.setAttribute('position', quad.getAttribute('position'));
  geometry.setAttribute('uv', quad.getAttribute('uv'));
  const attribute = (size: number) => {
    const a = new InstancedBufferAttribute(new Float32Array(capacity * size), size);
    a.setUsage(DynamicDrawUsage);
    return a;
  };
  const origin = attribute(3);
  const velocity = attribute(3);
  const timing = attribute(3);
  geometry.setAttribute('origin', origin);
  geometry.setAttribute('velocity', velocity);
  geometry.setAttribute('timing', timing);
  geometry.instanceCount = capacity;
  // Never born: every particle starts dead.
  for (let i = 0; i < capacity; i++) timing.array[3 * i] = -1e9;

  const material = new ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      gravity: { value: look.gravity },
      grow: { value: look.grow },
      colour: { value: new Color(look.colour) },
      opacity: { value: look.opacity },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: look.blending,
    toneMapped: false,
  });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  const time = material.uniforms.time as { value: number };

  const attributes = [origin, velocity, timing];
  /** Two ranges an attribute may need in a frame, made once. */
  const ranges = attributes.map(() => [
    { start: 0, count: 0 },
    { start: 0, count: 0 },
  ]);
  let next = 0;
  let first = -1;
  let count = 0;

  function spawn(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    size: number,
    now: number,
  ): void {
    const i = next;
    next = (next + 1) % capacity;
    if (first < 0) first = i;
    count = Math.min(capacity, count + 1);
    origin.array[3 * i] = x;
    origin.array[3 * i + 1] = y;
    origin.array[3 * i + 2] = z;
    velocity.array[3 * i] = vx;
    velocity.array[3 * i + 1] = vy;
    velocity.array[3 * i + 2] = vz;
    timing.array[3 * i] = now;
    timing.array[3 * i + 1] = life;
    timing.array[3 * i + 2] = size;
  }

  function tick(now: number): void {
    time.value = now;
    if (count === 0) return;
    const end = first + count;
    const wraps = end > capacity;
    for (let k = 0; k < attributes.length; k += 1) {
      const a = attributes[k] as InstancedBufferAttribute;
      const mine = ranges[k] as [UpdateRange, UpdateRange];
      const [one, two] = mine;
      if (a.updateRanges.length === 0) {
        // Nothing pending: push our own two objects, so a frame makes none. Three empties the
        // list after it uploads, which frees them for the next frame.
        one.start = first * 3;
        one.count = (wraps ? capacity - first : count) * 3;
        a.updateRanges.push(one);
        if (wraps) {
          two.start = 0;
          two.count = (end - capacity) * 3;
          a.updateRanges.push(two);
        }
      } else {
        // A frame the renderer skipped left its ranges pending, and they may be our objects:
        // pushing them again would alias them. This is rare, so it may allocate; stacking is what
        // keeps the skipped frame's births.
        if (!wraps) a.addUpdateRange(first * 3, count * 3);
        else {
          a.addUpdateRange(first * 3, (capacity - first) * 3);
          a.addUpdateRange(0, (end - capacity) * 3);
        }
      }
      a.needsUpdate = true;
    }
    first = -1;
    count = 0;
  }

  function dispose(): void {
    quad.dispose();
    geometry.dispose();
    material.dispose();
  }

  return { mesh, spawn, tick, dispose };
}
