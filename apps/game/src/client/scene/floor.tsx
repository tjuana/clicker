import { useStore, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import {
  AdditiveBlending,
  type Camera,
  Color,
  HalfFloatType,
  PlaneGeometry,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector2,
  WebGLRenderTarget,
} from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { gaussianTaps } from './blur-kernel';
import { FLOOR, GRID_COLOUR, GRID_LEVEL, GRID_SPACING } from './look';

// The mirror's own shader: the reflection, projected, times a strength, with fog. `color` is
// declared because Reflector's constructor sets it and throws without it; nothing reads it.
const FLOOR_SHADER = {
  name: 'ArenaFloor',
  uniforms: UniformsUtils.merge([
    UniformsLib.fog,
    {
      color: { value: null },
      tDiffuse: { value: null },
      textureMatrix: { value: null },
      strength: { value: FLOOR.strength },
    },
  ]),
  vertexShader: `uniform mat4 textureMatrix;
varying vec4 vUv;
#include <fog_pars_vertex>
void main() {
  vUv = textureMatrix * vec4(position, 1.0);
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
#include <fog_vertex>
}`,
  fragmentShader: `uniform sampler2D tDiffuse;
uniform float strength;
varying vec4 vUv;
#include <fog_pars_fragment>
void main() {
  gl_FragColor = vec4(texture2DProj(tDiffuse, vUv).rgb * strength, 1.0);
#include <fog_fragment>
}`,
};

/** One axis of the separable Gaussian: TAPS bilinear reads along `texelStep`, weighted. */
function blurMaterial(sigma: number, axis: Vector2): ShaderMaterial {
  const { offsets, weights } = gaussianTaps(sigma);
  return new ShaderMaterial({
    defines: { TAPS: offsets.length },
    uniforms: {
      src: { value: null },
      offsets: { value: offsets },
      weights: { value: weights },
      // Mutated in place on resize: this is the texel size along the axis, zero across it.
      texelStep: { value: axis },
    },
    vertexShader:
      'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `uniform sampler2D src;
uniform float offsets[TAPS];
uniform float weights[TAPS];
uniform vec2 texelStep;
varying vec2 vUv;
void main() {
  vec3 sum = vec3(0.0);
  for (int i = 0; i < TAPS; i++) sum += texture2D(src, vUv + offsets[i] * texelStep).rgb * weights[i];
  gl_FragColor = vec4(sum, 1.0);
}`,
    depthTest: false,
    depthWrite: false,
  });
}

const targetSize = (css: number): number => Math.max(1, Math.round(css * FLOOR.fraction));

/**
 * The arena's floor: a wet-asphalt mirror. Three's Reflector renders the arena upside down into a
 * texture; before the floor is drawn that texture is blurred by two passes of a separable Gaussian
 * (RTR 12.1), narrow across and wide down, so a bike's reflection is a soft vertical streak
 * (RTR 9.8, Figure 11.40: microfacets stretch a reflection along the view). All three targets are
 * a fraction of the canvas, the same size, so the bilinear offsets in texels hold.
 *
 * Mounted beside `Field`, not in it: `Field` is rebuilt on every side or tick change. Rebuilt
 * here only when the side changes, and then everything it made is disposed.
 */
export function Floor({ side }: { side: number }) {
  const store = useStore();
  const size = useThree((s) => s.size);

  const floor = useMemo(() => {
    const { width, height } = store.getState().size;
    const w = targetSize(width);
    const h = targetSize(height);
    // multisample 0: the edges are blurred away anyway.
    const reflector = new Reflector(new PlaneGeometry(side, side), {
      textureWidth: w,
      textureHeight: h,
      multisample: 0,
      shader: FLOOR_SHADER,
    });
    reflector.rotation.x = -Math.PI / 2;
    reflector.position.set(side / 2, 0, side / 2);
    const material = reflector.material as ShaderMaterial;
    material.fog = true;

    // The reflection camera is cloned from the main one once, layers included; the grid is on
    // layer 1 and must not be mirrored.
    const reflectionCamera = reflector.getReflectionCamera.bind(reflector);
    reflector.getReflectionCamera = (camera: Camera) => {
      const mirror = reflectionCamera(camera);
      mirror.layers.set(0);
      return mirror;
    };

    const options = { type: HalfFloatType, depthBuffer: false };
    const across = new WebGLRenderTarget(w, h, options);
    const down = new WebGLRenderTarget(w, h, options);
    const acrossStep = new Vector2(1 / w, 0);
    const downStep = new Vector2(0, 1 / h);
    const horizontal = blurMaterial(FLOOR.sigmaAcross, acrossStep);
    const vertical = blurMaterial(FLOOR.sigmaDown, downStep);
    const quad = new FullScreenQuad(horizontal);
    // The uniform objects, held so the frame does not look them up.
    const horizontalSrc = horizontal.uniforms.src as { value: unknown };
    const verticalSrc = vertical.uniforms.src as { value: unknown };
    const shown = material.uniforms.tDiffuse as { value: unknown };

    // Runs inside the frame, inside the composer's scene pass: nothing here allocates.
    const reflect = reflector.onBeforeRender;
    reflector.onBeforeRender = (renderer, scene, camera, geometry, mat, group) => {
      reflect.call(reflector, renderer, scene, camera, geometry, mat, group);
      const current = renderer.getRenderTarget();
      horizontalSrc.value = reflector.getRenderTarget().texture;
      quad.material = horizontal;
      renderer.setRenderTarget(across);
      quad.render(renderer);
      verticalSrc.value = across.texture;
      quad.material = vertical;
      renderer.setRenderTarget(down);
      quad.render(renderer);
      renderer.setRenderTarget(current);
      shown.value = down.texture;
    };
    return { reflector, across, down, acrossStep, downStep, horizontal, vertical, quad };
  }, [side, store]);

  useEffect(() => {
    const w = targetSize(size.width);
    const h = targetSize(size.height);
    floor.reflector.getRenderTarget().setSize(w, h);
    floor.across.setSize(w, h);
    floor.down.setSize(w, h);
    floor.acrossStep.set(1 / w, 0);
    floor.downStep.set(0, 1 / h);
  }, [floor, size]);

  useEffect(
    () => () => {
      floor.reflector.dispose();
      floor.reflector.geometry.dispose();
      floor.across.dispose();
      floor.down.dispose();
      floor.quad.dispose();
      floor.horizontal.dispose();
      floor.vertical.dispose();
    },
    [floor],
  );

  return <primitive object={floor.reflector} />;
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
