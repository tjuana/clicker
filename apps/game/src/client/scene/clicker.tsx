import { DEFAULT_CONFIG } from '@clicker/game';
import { useGLTF } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  Box3,
  Color,
  InstancedMesh,
  MathUtils,
  Matrix4,
  type Mesh,
  type PerspectiveCamera,
  Quaternion,
  Vector3,
} from 'three';
import { theme } from '../theme';
import { bakeRally, type CarPart } from './clicker-cars';
import { FrameMeter } from './frame-meter';
import { distanceToFit, type Grid, gridFor, type Slot, slotFor } from './layout';

/**
 * A rally hatchback from Kenney's Car Kit — CC0, so no attribution is owed.
 * Its texture is *not* embedded: the file references `Textures/colormap.png` next to itself,
 * and without that second file the car arrives in flat grey.
 */
const CAR = '/models/rally.glb';
useGLTF.preload(CAR);

/** The model is ~2.85 long and points down +Z; the track runs along +X at a tenth the size. */
const CAR_SCALE = 0.33;
const CAR_TURN = Math.PI / 2;

export interface Racer {
  id: string;
  clicks: number;
}

/**
 * One click is always this far. A fixed scale, not one relative to the leader:
 * with a relative scale a player alone in a room sits pinned at the front and never
 * sees themselves move.
 */
const UNIT = 0.14;
/* Lane spacing, row stagger and camera distance all live in ./layout — they are arithmetic,
   not rendering, and they are derived from the car's measured size rather than typed in. */

/**
 * A colour per racer, assigned by position in the list so it is stable for a whole round.
 * In a pack of twenty a figure is small, and colour tells people apart long before shape does.
 */
const LIVERY = [
  '#e5443d',
  '#f07a2e',
  '#efd034',
  '#b6d334',
  '#5cc23f',
  '#2fb36a',
  '#26bfa5',
  '#2bb8d6',
  '#5ad0f0',
  '#3d95e5',
  '#4f6ee0',
  '#6f5be0',
  '#9a5be0',
  '#c455d9',
  '#e055a8',
  '#e85f79',
  '#8fd6c2',
  '#d6d6d6',
  '#7f8fb5',
  '#b5b02f',
];
/** Marks every metre; without them a racer over a flat floor looks motionless. */
const MARKS = 48;
const MARK_SPACING = 1;

/** Smoothing: snapshots land ten times a second, the eye wants sixty. */
const damp = (current: number, target: number, delta: number, rate = 7): number =>
  MathUtils.damp(current, target, rate, delta);

/** The room's player cap: the most cars one round can ever draw, so the meshes never grow. */
const CAPACITY = DEFAULT_CONFIG.maxPlayers;

const LIVERY_COLOURS = LIVERY.map((hex) => new Color(hex));
const UP = new Vector3(0, 1, 0);
const ONE = new Vector3(CAR_SCALE, CAR_SCALE, CAR_SCALE);
const place = new Matrix4();
const spot = new Vector3();
const turn = new Quaternion().setFromAxisAngle(UP, CAR_TURN);

/**
 * Every car in two instanced meshes (the livery part and the rest), so a frame costs the same
 * draw calls for one racer as for fifty. Each racer was a clone of the model with five meshes of
 * its own: six draws per player. Positions are damped here, in a map by racer id, instead of in
 * a component per car.
 */
function Cars({ racers, you, grid }: { racers: Racer[]; you: string | null; grid: Grid }) {
  const { scene } = useGLTF(CAR);
  const ring = useRef<Mesh>(null);
  const xs = useMemo(() => new Map<string, number>(), []);

  // `slotFor` hands back an object; asked per racer per frame that is garbage sixty times a second.
  const slots = useMemo(
    () => Array.from({ length: Math.min(racers.length, CAPACITY) }, (_, i) => slotFor(i, grid)),
    [racers.length, grid],
  );

  const meshes = useMemo(() => {
    const baked = bakeRally(scene);
    const make = (part: CarPart, shadow: boolean): InstancedMesh => {
      const mesh = new InstancedMesh(part.geometry, part.material, CAPACITY);
      // The instances stand away from the geometry's own origin, where its bounding sphere is.
      mesh.frustumCulled = false;
      mesh.castShadow = shadow;
      mesh.count = 0;
      return mesh;
    };
    return {
      baked,
      body: make(baked.body, true),
      rest: baked.rest.map((part) => make(part, false)),
    };
  }, [scene]);

  useEffect(
    () => () => {
      // The cloned body material and the baked geometries are ours. The rest's materials belong
      // to the loaded model, which useGLTF caches: disposing them would break the next mount.
      meshes.baked.body.material.dispose();
      meshes.baked.body.geometry.dispose();
      for (const part of meshes.baked.rest) part.geometry.dispose();
      meshes.body.dispose();
      for (const mesh of meshes.rest) mesh.dispose();
    },
    [meshes],
  );

  // A colour per place in the list, set when the list changes rather than every frame.
  useLayoutEffect(() => {
    for (let i = 0; i < racers.length && i < CAPACITY; i++) {
      meshes.body.setColorAt(i, LIVERY_COLOURS[i % LIVERY_COLOURS.length] as Color);
    }
    if (meshes.body.instanceColor !== null) meshes.body.instanceColor.needsUpdate = true;
    const present = new Set(racers.map((racer) => racer.id));
    for (const id of xs.keys()) if (!present.has(id)) xs.delete(id);
  }, [racers, meshes, xs]);

  useFrame((_state, delta) => {
    const count = Math.min(racers.length, CAPACITY);
    let ownX = 0;
    let ownZ = 0;
    for (let i = 0; i < count; i++) {
      const racer = racers[i] as Racer;
      const slot = slots[i] as Slot;
      // A racer new to the track starts at x 0 and slides to its place, as it always has.
      const x = damp(xs.get(racer.id) ?? 0, racer.clicks * UNIT - slot.back, delta);
      xs.set(racer.id, x);
      place.compose(spot.set(x, 0, slot.z), turn, ONE);
      meshes.body.setMatrixAt(i, place);
      for (const mesh of meshes.rest) mesh.setMatrixAt(i, place);
      if (racer.id === you) {
        ownX = x;
        ownZ = slot.z;
      }
    }
    meshes.body.count = count;
    meshes.body.instanceMatrix.needsUpdate = true;
    for (const mesh of meshes.rest) {
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
    }
    ring.current?.position.set(ownX, 0.02, ownZ);
  });

  return (
    <>
      <primitive object={meshes.body} />
      {meshes.rest.map((mesh) => (
        <primitive key={mesh.uuid} object={mesh} />
      ))}
      {/* Your own racer wears a ring on the ground: colour alone is not enough to find
          yourself in a pack of twenty when the figure is a few pixels wide. */}
      {racers.some((racer) => racer.id === you) ? (
        <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.52, 0.66, 24]} />
          <meshBasicMaterial color={theme.goldBright} transparent opacity={0.9} />
        </mesh>
      ) : null}
    </>
  );
}

/**
 * The camera frames the whole field, not the leader: following the leader alone pushes
 * everyone behind them out of the left edge, and the gap between players is the one thing
 * a race has to show.
 */
function Rig({
  firstX,
  lastX,
  field,
}: {
  firstX: number;
  lastX: number;
  field: { width: number; length: number };
}) {
  const { camera, size } = useThree();
  const focusRef = useRef<number | null>(null);

  useFrame((_state, delta) => {
    // Damped at the runners' own rate. The camera used to aim straight at the raw snapshot
    // position — which arrives in steps ten times a second — while the cars lagged behind
    // their own damping. Smooth position, jumping aim: that mismatch is what shook.
    const wanted = (firstX + lastX) / 2;
    focusRef.current = focusRef.current === null ? wanted : damp(focusRef.current, wanted, delta);
    const focus = focusRef.current;

    // Asked of the frustum rather than guessed at: the lens is right there on the camera.
    const lens = camera as PerspectiveCamera;
    const distance = distanceToFit(field, {
      fovDeg: lens.fov,
      aspect: size.width / Math.max(1, size.height),
    });

    // Mostly behind the field and only a little to the side: from side-on the track
    // crosses the frame as a diagonal band instead of receding down the lane.
    camera.position.x = damp(camera.position.x, focus - distance * 0.85, delta, 4);
    camera.position.y = damp(camera.position.y, 1.8 + distance * 0.1, delta, 4);
    camera.position.z = damp(camera.position.z, distance * 0.55, delta, 4);
    camera.lookAt(focus + 1.2, 0.4, 0);
  });

  return null;
}

/** The metre marks as one instanced mesh: forty-eight meshes were forty-eight draws. */
function Marks({ width }: { width: number }) {
  const marks = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = marks.current;
    if (mesh === null) return;
    const flat = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);
    const one = new Vector3(1, 1, 1);
    const at = new Vector3();
    const matrix = new Matrix4();
    for (let i = 0; i < MARKS; i++) {
      mesh.setMatrixAt(i, matrix.compose(at.set((i + 1) * MARK_SPACING, 0.03, 0), flat, one));
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, []);

  return (
    // Culling off: the bounding sphere of the plane alone would drop marks far from its origin.
    <instancedMesh ref={marks} args={[undefined, undefined, MARKS]} frustumCulled={false}>
      <planeGeometry args={[0.06, width]} />
      <meshBasicMaterial color="#6d7a99" />
    </instancedMesh>
  );
}

function Track({ laneWidth }: { laneWidth: number }) {
  const width = laneWidth + 3;

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[400, width]} />
        <meshStandardMaterial color="#343c56" roughness={0.9} />
      </mesh>

      {/* Kerbs down both sides: the track had no edges at all, so it read as a floor
          rather than a road, and nothing marked where the racing surface ended. */}
      {[-1, 1].map((side) => (
        <mesh
          key={side}
          position={[100, 0.02, (side * width) / 2 - side * 0.25]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <planeGeometry args={[400, 0.5]} />
          {/* Terracotta, not the red it started as: a player's own car is red too, and at the
              edge of the track the two merged into one shape. */}
          <meshStandardMaterial color="#96634f" roughness={0.8} />
        </mesh>
      ))}

      {/* The start line, and then a mark every metre to make speed legible. */}
      <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.16, width]} />
        <meshBasicMaterial color="#efe6d8" />
      </mesh>
      <Marks width={width} />
    </group>
  );
}

export default function Race({ racers, you }: { racers: Racer[]; you: string | null }) {
  const { scene } = useGLTF(CAR);

  /**
   * Taken from the model itself, once. Every distance in the layout follows from these two
   * numbers, so swapping the `.glb` re-spaces the field automatically. Hand-typed sizes are
   * what broke it before: the hatchback became a formula car and the cars started overlapping
   * again, because the constants still described a car that was no longer there.
   */
  const car = useMemo(() => {
    const size = new Box3().setFromObject(scene).getSize(new Vector3());
    return { length: size.z * CAR_SCALE, width: size.x * CAR_SCALE };
  }, [scene]);

  const grid = useMemo(() => gridFor(racers.length, car), [racers.length, car]);
  const rows = Math.ceil(Math.max(1, racers.length) / grid.lanes);

  const clicks = racers.map((racer) => racer.clicks);
  const firstX = (clicks.length === 0 ? 0 : Math.max(...clicks)) * UNIT;
  const lastX = (clicks.length === 0 ? 0 : Math.min(...clicks)) * UNIT;

  return (
    <Canvas
      dpr={[1, 2]}
      shadows
      camera={{ position: [-4.2, 2.1, 6.4], fov: 42 }}
      style={{ width: '100%', height: '100%' }}
    >
      <FrameMeter />
      {/* Dusk rather than noon. A daylight sky inside this near-black page read as a bright
          patch cut into it; an evening one keeps the arcade colours but belongs to the same
          room as the dark panels around it. The key light stays warm so the cars still look
          like painted toys instead of grey blocks. */}
      <color attach="background" args={['#2b2540']} />
      <fog attach="fog" args={['#2b2540', 22, 46]} />

      {/* Dusk, not night: dropped to 0.5 the road turned into an indistinct dark mass and the
          liveries went muddy — the one thing the warm key light was supposed to prevent. */}
      <ambientLight intensity={0.72} />
      {/* The ground term does the work the key light cannot: the near half of the road faces
          away from it and was lit by nothing else. */}
      <hemisphereLight args={['#8778ab', '#3d4460', 0.85]} />
      {/* Moved closer to overhead: from off to one side it lit the far half of the track and
          left the near half in its own shadow. Still warm, still angled enough to cast. */}
      <directionalLight position={[5, 16, 4]} intensity={2} color="#ffd9a8" castShadow />

      <Track laneWidth={grid.width} />
      <Cars racers={racers} you={you} grid={grid} />

      <Rig
        firstX={firstX}
        lastX={lastX}
        field={{ width: grid.width, length: firstX - lastX + rows * grid.rowGap }}
      />
    </Canvas>
  );
}
