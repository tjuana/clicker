import { MeshReflectorMaterial } from '@react-three/drei';
import { useEffect, useMemo } from 'react';
import { AdditiveBlending, Color, ShaderMaterial, UniformsLib, UniformsUtils } from 'three';
import { FLOOR, GRID_COLOUR, GRID_LEVEL, GRID_SPACING } from './look';

/**
 * The arena's floor: a soft mirror. Mounted beside `Field`, not in it: drei's reflector never
 * disposes its render targets, and `Field` is rebuilt whenever the side or the tick changes;
 * the canvas's own unmount loses the whole WebGL context, which is the only cleanup it gets.
 */
export function Floor({ side }: { side: number }) {
  return (
    <>
      <ambientLight intensity={Math.PI} />
      <mesh rotation-x={-Math.PI / 2} position={[side / 2, 0, side / 2]} scale={[side, side, 1]}>
        <planeGeometry args={[1, 1]} />
        <MeshReflectorMaterial
          resolution={FLOOR.resolution}
          blur={FLOOR.blur}
          mixBlur={1}
          mixStrength={FLOOR.mixStrength}
          mirror={1}
          depthScale={0}
          color="#ffffff"
          roughness={1}
          metalness={0}
          toneMapped={false}
        />
      </mesh>
    </>
  );
}

const VERTEX = `#include <fog_pars_vertex>
varying vec2 vCell;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vCell = world.xz;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
#include <fog_vertex>
}`;

// fwidth makes a line one pixel wide at any distance, and the min() fades its edge: no stair-steps.
const FRAGMENT = `#include <fog_pars_fragment>
uniform vec3 colour;
varying vec2 vCell;
void main() {
  vec2 p = vCell / ${GRID_SPACING.toFixed(1)};
  vec2 g = abs(fract(p - 0.5) - 0.5) / fwidth(p);
  float line = 1.0 - min(min(g.x, g.y), 1.0);
  gl_FragColor = vec4(colour * line, 1.0);
#include <fog_fragment>
}`;

/**
 * Lines drawn over the floor. On layer 1, which the main camera enables and the reflector's own
 * camera does not: the mirror would otherwise smear the grid into the reflection.
 */
export function Grid({ side }: { side: number }) {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        toneMapped: false,
        fog: true,
        uniforms: UniformsUtils.merge([
          UniformsLib.fog,
          { colour: { value: new Color(GRID_COLOUR).multiplyScalar(GRID_LEVEL) } },
        ]),
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  return (
    <mesh
      rotation-x={-Math.PI / 2}
      position={[side / 2, 0.01, side / 2]}
      material={material}
      onUpdate={(mesh) => mesh.layers.set(1)}
    >
      <planeGeometry args={[side, side]} />
    </mesh>
  );
}
