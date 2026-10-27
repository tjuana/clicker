import { TRACKS } from '@clicker/game';
import { Environment } from '@react-three/drei';
import { Canvas, useLoader, useThree } from '@react-three/fiber';
import { Suspense, useEffect, useMemo } from 'react';
import {
  BoxGeometry,
  Color,
  type DirectionalLight,
  InstancedMesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
  TextureLoader,
  Vector3,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FrameMeter } from './frame-meter';
import { Racers } from './race';
import {
  ASSETS,
  BARRIER,
  ENVIRONMENT_INTENSITY,
  GRASS_TINT,
  GROUND_REPEAT,
  GROUND_SIZE,
  GROUND_Y,
  KERB_COLOUR,
  KERB_ROUGHNESS,
  OVERVIEW,
  PIXEL_RATIO,
  ROAD_ROUGHNESS,
  SKY,
  SUN,
  TONE_MAPPING,
} from './race-look';
import {
  bake,
  blocks,
  bounds,
  LAYERS,
  type ModelName,
  placements,
  type Walked,
  walk,
} from './ring-track';

const MODELS: Record<ModelName, string> = {
  straight: 'roadStraight',
  corner1: 'roadCornerSmall',
  corner2: 'roadCornerLarge',
  corner3: 'roadCornerLarger',
};
const MODEL_URLS = [MODELS.straight, MODELS.corner1, MODELS.corner2, MODELS.corner3].map(
  (name) => `${ASSETS}/${name}.glb`,
);
const TEXTURE_URLS = [
  `${ASSETS}/asphalt_track_diff_1k.jpg`,
  `${ASSETS}/asphalt_track_nor_gl_1k.jpg`,
  `${ASSETS}/leafy_grass_diff_1k.jpg`,
  `${ASSETS}/leafy_grass_nor_gl_1k.jpg`,
];

/** Scratch for building the barrier matrices once; nothing here runs per frame. */
const spot = new Object3D();
const paint = new Color();

/** The tiles baked into three meshes, the barriers around them and the grass under it all. */
function Track({ pieces }: { pieces: readonly Walked[] }) {
  const gl = useThree((state) => state.gl);
  const gltfs = useLoader(GLTFLoader, MODEL_URLS);
  const textures = useLoader(TextureLoader, TEXTURE_URLS);

  const built = useMemo(() => {
    const [asphalt, asphaltNormal, grass, grassNormal] = textures as [
      Texture,
      Texture,
      Texture,
      Texture,
    ];
    // Without anisotropy a texture seen at a grazing angle, as the road ahead always is, smears.
    for (const texture of textures) {
      texture.wrapS = texture.wrapT = RepeatWrapping;
      texture.anisotropy = gl.capabilities.getMaxAnisotropy();
    }
    asphalt.colorSpace = SRGBColorSpace;
    grass.colorSpace = SRGBColorSpace;

    const sceneAt = (i: number): Object3D => {
      const gltf = gltfs[i];
      if (gltf === undefined) throw new Error(`model ${i} did not load`);
      return gltf.scene;
    };
    const models = {
      straight: sceneAt(0),
      corner1: sceneAt(1),
      corner2: sceneAt(2),
      corner3: sceneAt(3),
    };
    const geometry = bake(models, placements(pieces));
    const materials = {
      road: new MeshStandardMaterial({
        map: asphalt,
        normalMap: asphaltNormal,
        roughness: ROAD_ROUGHNESS,
        metalness: 0,
      }),
      grass: new MeshStandardMaterial({
        map: grass,
        normalMap: grassNormal,
        color: GRASS_TINT,
        roughness: 1,
        metalness: 0,
      }),
      kerb: new MeshStandardMaterial({ color: KERB_COLOUR, roughness: KERB_ROUGHNESS }),
    };

    // The ground reuses the grass image with its own repeat, so it needs its own texture object.
    const groundMap = grass.clone();
    groundMap.repeat.set(GROUND_SIZE * GROUND_REPEAT, GROUND_SIZE * GROUND_REPEAT);
    groundMap.needsUpdate = true;
    const ground = new MeshStandardMaterial({
      map: groundMap,
      roughness: 1,
      color: GRASS_TINT,
    });
    const groundGeometry = new PlaneGeometry(GROUND_SIZE, GROUND_SIZE);

    const list = blocks(pieces);
    const barrierGeometry = new BoxGeometry(1, BARRIER.height, BARRIER.thickness);
    const barrierMaterial = new MeshStandardMaterial({ roughness: BARRIER.roughness });
    const barriers = new InstancedMesh(barrierGeometry, barrierMaterial, list.length);
    list.forEach((block, i) => {
      spot.position.set(block.x, BARRIER.height / 2, block.z);
      spot.rotation.set(0, block.yaw, 0);
      spot.scale.set(block.length, 1, 1);
      spot.updateMatrix();
      barriers.setMatrixAt(i, spot.matrix);
      barriers.setColorAt(i, paint.set(block.red ? BARRIER.red : BARRIER.white));
    });
    barriers.castShadow = true;
    barriers.receiveShadow = true;

    const centre = bounds(pieces).getCenter(new Vector3());
    return { geometry, materials, ground, groundMap, groundGeometry, barriers, centre };
  }, [gltfs, textures, pieces, gl]);

  // Everything above is ours and goes with the component; the loaded textures and models give back
  // their GPU memory too. They stay in useLoader's cache: the lobby fills it before every race, and
  // React runs this cleanup once right after mounting in development — clearing the cache here made
  // the next render fetch every model again and left the race blank for two seconds at the start.
  useEffect(
    () => () => {
      for (const layer of LAYERS) {
        built.geometry[layer].dispose();
        built.materials[layer].dispose();
      }
      built.ground.dispose();
      built.groundMap.dispose();
      built.groundGeometry.dispose();
      built.barriers.geometry.dispose();
      (built.barriers.material as MeshStandardMaterial).dispose();
      built.barriers.dispose();
      for (const texture of textures) texture.dispose();
      for (const gltf of gltfs) {
        gltf.scene.traverse((object) => {
          const mesh = object as { geometry?: { dispose(): void } };
          mesh.geometry?.dispose();
        });
      }
    },
    [built, textures, gltfs],
  );

  return (
    <>
      {LAYERS.map((layer) => (
        <mesh
          key={layer}
          geometry={built.geometry[layer]}
          material={built.materials[layer]}
          receiveShadow
        />
      ))}
      <mesh
        rotation-x={-Math.PI / 2}
        position={[built.centre.x, GROUND_Y, built.centre.z]}
        geometry={built.groundGeometry}
        material={built.ground}
        receiveShadow
      />
      <primitive object={built.barriers} />
      <Lights pieces={pieces} />
      <Overview centre={built.centre} />
    </>
  );
}

/** One sun whose shadow camera just covers the track. */
function Lights({ pieces }: { pieces: readonly Walked[] }) {
  const scene = useThree((state) => state.scene);
  const box = useMemo(() => bounds(pieces), [pieces]);
  const light = useMemo(() => {
    const centre = box.getCenter(new Vector3());
    const size = box.getSize(new Vector3());
    const radius = Math.hypot(size.x, size.z) / 2 + SUN.margin;
    return { centre, radius, position: centre.clone().add(new Vector3(...SUN.from)) };
  }, [box]);

  const ref = (sun: DirectionalLight | null) => {
    if (sun === null) return;
    sun.target.position.copy(light.centre);
    sun.target.updateMatrixWorld();
    const camera = sun.shadow.camera;
    camera.left = camera.bottom = -light.radius;
    camera.right = camera.top = light.radius;
    camera.near = 1;
    camera.far = light.position.distanceTo(light.centre) + light.radius * 2;
    camera.updateProjectionMatrix();
  };
  useEffect(() => {
    scene.environmentIntensity = ENVIRONMENT_INTENSITY;
  }, [scene]);

  return (
    <directionalLight
      ref={ref}
      position={light.position}
      intensity={SUN.intensity}
      castShadow
      shadow-mapSize={[SUN.mapSize, SUN.mapSize]}
      shadow-bias={SUN.bias}
    />
  );
}

/** The camera stands above the track until the cars arrive and give it something to follow. */
function Overview({ centre }: { centre: Vector3 }) {
  const camera = useThree((state) => state.camera);
  useEffect(() => {
    camera.position.copy(centre).add(new Vector3(...OVERVIEW.offset));
    camera.lookAt(centre);
  }, [camera, centre]);
  return null;
}

export default function Ring({ track = 'ring' }: { track?: string }) {
  const pieces = useMemo(() => {
    const data = TRACKS[track];
    return data === undefined ? null : walk(data);
  }, [track]);
  if (pieces === null) return null;
  return (
    <Canvas
      shadows="percentage"
      dpr={PIXEL_RATIO}
      gl={{ toneMapping: TONE_MAPPING }}
      camera={{ fov: OVERVIEW.fov, near: OVERVIEW.near, far: OVERVIEW.far }}
      style={{ width: '100%', height: '100%' }}
    >
      <FrameMeter />
      <Suspense fallback={null}>
        <Environment
          files={SKY}
          background
          backgroundBlurriness={0}
          environmentIntensity={ENVIRONMENT_INTENSITY}
        />
        <Track pieces={pieces} />
        <Racers />
      </Suspense>
    </Canvas>
  );
}
