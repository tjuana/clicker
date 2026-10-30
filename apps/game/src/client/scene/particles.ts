import {
  AdditiveBlending,
  type BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  NormalBlending,
  PlaneGeometry,
  ShaderMaterial,
} from 'three';

/** What one pool looks like; the figures come from `race-look.ts`. */
export interface PoolLook {
  colour: string;
  gravity: number;
  grow: number;
  opacity: number;
  additive?: boolean;
}

// Stub: the geometry and material are real, `spawn` and `tick` do nothing yet.
export function createPool(capacity: number, look: PoolLook) {
  const plane = new PlaneGeometry(1, 1);
  const geometry = new InstancedBufferGeometry();
  geometry.setIndex(plane.getIndex() as BufferAttribute);
  geometry.setAttribute('position', plane.getAttribute('position'));
  geometry.setAttribute('uv', plane.getAttribute('uv'));
  for (const name of ['origin', 'velocity', 'timing']) {
    geometry.setAttribute(name, new InstancedBufferAttribute(new Float32Array(capacity * 3), 3));
  }
  geometry.instanceCount = capacity;
  const material = new ShaderMaterial({
    uniforms: { time: { value: 0 }, gravity: { value: look.gravity }, grow: { value: look.grow } },
    vertexShader: 'void main() { gl_Position = vec4(0.0); }',
    fragmentShader: 'void main() { gl_FragColor = vec4(1.0); }',
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    blending: look.additive === true ? AdditiveBlending : NormalBlending,
  });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  return {
    mesh,
    spawn(
      _x: number,
      _y: number,
      _z: number,
      _vx: number,
      _vy: number,
      _vz: number,
      _life: number,
      _size: number,
      _now: number,
    ): void {},
    tick(_now: number): void {},
    dispose(): void {
      geometry.dispose();
      material.dispose();
    },
  };
}
