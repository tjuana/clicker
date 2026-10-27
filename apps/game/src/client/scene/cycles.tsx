import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import {
  type Camera,
  type Color,
  type Fog,
  HalfFloatType,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  Vector2,
  Vector3,
  WebGLRenderTarget,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { seenOnScreen } from '../cycles/latency-store';
import { useCycles } from '../cycles/store';
import type { Sample, Step, Timeline } from '../cycles/timeline';
import { createCycleGeometry } from './cycle-model';
import { Floor, Grid } from './floor';
import { FrameMeter } from './frame-meter';
import { BIKE_LEVEL, BLOOM, BORDER_COLOUR, DIM_LEVEL, SLOT_COLOURS } from './look';
import { createWalls, type Walls } from './walls';

const MAX_BIKES = 64;

const BIKE = SLOT_COLOURS.map((colour) => colour.clone().multiplyScalar(BIKE_LEVEL));
const DIM = SLOT_COLOURS.map((colour) => colour.clone().multiplyScalar(DIM_LEVEL));
/**
 * The player's own bike is bigger, not brighter: a yellow bike at 1.25 is already past white,
 * and a harder glow only turned it into a blown-out blob.
 */
const OWN_SIZE = 1.2;

/** East, south, west, north in the field's (x, z): the protocol's directions 0 to 3. */
const DIR_X = [1, 0, -1, 0];
const DIR_Z = [0, 1, 0, -1];

const UP = new Vector3(0, 1, 0);

/** Scratch objects, one set for the whole module: nothing in the frame loop allocates. */
const matrix = new Matrix4();
const position = new Vector3();
const scale = new Vector3();
const rotation = new Quaternion();

/** What the camera remembers from frame to frame, kept out of React: it changes sixty times a second. */
interface Rig {
  /** The round being drawn: another timeline is another round, with nothing in common. */
  timeline: Timeline | null;
  /** The camera's heading, eased on its own; null until the first frame. */
  yaw: number | null;
  /** Whom the camera is on: a slot, or -1 for the overview. */
  subject: number;
  /** The slot that killed the player, `null` for a crash or before any death. */
  killedBy: number | null;
  ids: Map<number, string> | null;
  ownSlot: number;
  /** 0 in a chase, 1 in the overview: the fog opens up to show the whole field. */
  openFog: number;
  /** Where the camera was when the subject changed, fading out: no cut between two bikes. */
  cameraOffset: Vector3;
  lookOffset: Vector3;
  look: Vector3;
  wantPosition: Vector3;
  wantLook: Vector3;
  /** The bike the camera follows this frame, filled while the bikes are drawn; slot -1 for none. */
  chase: { slot: number; x: number; z: number; dir: number };
}

function createRig(): Rig {
  return {
    timeline: null,
    yaw: null,
    subject: -2,
    killedBy: null,
    ids: null,
    ownSlot: -1,
    openFog: 0,
    cameraOffset: new Vector3(),
    lookOffset: new Vector3(),
    look: new Vector3(),
    wantPosition: new Vector3(),
    wantLook: new Vector3(),
    chase: { slot: -1, x: 0, z: 0, dir: 0 },
  };
}

/** The slot a public id rides in this round, or -1. Looked up again only when the round changes. */
function ownSlotOf(rig: Rig, ids: Map<number, string>, you: string | null): number {
  if (rig.ids === ids) return rig.ownSlot;
  rig.ids = ids;
  rig.ownSlot = -1;
  for (const [slot, id] of ids) if (id === you) rig.ownSlot = slot;
  return rig.ownSlot;
}

function applyStep(walls: Walls, rig: Rig, step: Step): void {
  // A full of the same round (a bike joined, or a gap was closed) says nothing new about who
  // killed the player, so `killedBy` stays; a new round gets a new timeline, which clears it.
  walls.lay(step.walls, step.tick, step.reset);
  for (const event of step.events) {
    if (event.slot !== rig.ownSlot) continue;
    if (event.type === 'died') rig.killedBy = event.by;
    if (event.type === 'respawned') rig.killedBy = null;
  }
}

/**
 * Draws one bike between its heads either side of the render tick, as instance `index`; false
 * when the slot has no head in this sample. Kept clear of closures and result objects: it runs
 * for every bike on every frame.
 */
function drawBike(
  mesh: InstancedMesh,
  index: number,
  sample: Sample,
  slot: number,
  side: number,
  rig: Rig,
): boolean {
  const to = sample.to.get(slot);
  // A bike that died in the next tick stays where it was until that tick comes.
  const from = sample.from.get(slot) ?? to;
  if (from === undefined) return false;
  const end = to ?? from;
  const fx = (from.cell % side) + 0.5;
  const fz = Math.floor(from.cell / side) + 0.5;
  const tx = (end.cell % side) + 0.5;
  const tz = Math.floor(end.cell / side) + 0.5;
  // The model stands on the floor itself, so the bike is placed at y = 0.
  position.set(fx + (tx - fx) * sample.alpha, 0, fz + (tz - fz) * sample.alpha);
  matrix.compose(
    position,
    rotation.setFromAxisAngle(UP, (-end.dir * Math.PI) / 2),
    scale.setScalar(slot === rig.ownSlot ? OWN_SIZE : 1),
  );
  mesh.setMatrixAt(index, matrix);
  // Dim while the head it rides towards is not laying a wall: lit mode is told apart by eye.
  const colours = end.lit ? BIKE : DIM;
  mesh.setColorAt(index, colours[(slot - 1) % colours.length] as Color);
  // The player's own bike wins over the one that killed it, which is followed only while the
  // player has none.
  const { chase } = rig;
  if (slot === rig.ownSlot || (slot === rig.killedBy && chase.slot !== rig.ownSlot)) {
    chase.slot = slot;
    chase.x = position.x;
    chase.z = position.z;
    chase.dir = end.dir;
  }
  return true;
}

const wrapAngle = (angle: number): number => Math.atan2(Math.sin(angle), Math.cos(angle));

function Field({ side, tickMs, you }: { side: number; tickMs: number; you: string | null }) {
  const { gl, scene, camera, size } = useThree();
  const walls = useMemo(() => createWalls(side, tickMs), [side, tickMs]);
  const rig = useMemo(createRig, []);

  // The grid lives on layer 1 so the floor's mirror, which sees layer 0 only, leaves it out.
  useEffect(() => {
    camera.layers.enable(1);
  }, [camera]);

  const bikes = useMemo(() => {
    const geometry = createCycleGeometry();
    // Vertex colours carry each part's brightness; the instance colour, the slot's.
    const material = new MeshBasicMaterial({ toneMapped: false, vertexColors: true });
    const mesh = new InstancedMesh(geometry, material, MAX_BIKES);
    mesh.frustumCulled = false;
    return { mesh, geometry, material };
  }, []);

  // Bloom keys on brightness: see BIKE_LEVEL. Its figures are in look.ts.
  // The size here is a placeholder: the effect below sets the real one, and again on every resize.
  // The composer renders into its own target, which the canvas's antialias flag does not reach:
  // without samples here every edge stair-steps. Half float keeps the bloom's brightness past 1.
  const { composer, bloom } = useMemo(() => {
    const target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: 4 });
    const chain = new EffectComposer(gl, target);
    chain.addPass(new RenderPass(scene, camera));
    const pass = new UnrealBloomPass(
      new Vector2(256, 256),
      BLOOM.strength,
      BLOOM.radius,
      BLOOM.threshold,
    );
    chain.addPass(pass);
    return { composer: chain, bloom: pass };
  }, [gl, scene, camera]);

  useEffect(() => {
    composer.setSize(size.width, size.height);
  }, [composer, size]);

  // The composer disposes its two targets and copy pass, not the passes added to it.
  useEffect(
    () => () => {
      bloom.dispose();
      composer.dispose();
    },
    [composer, bloom],
  );
  useEffect(() => () => walls.dispose(), [walls]);
  useEffect(
    () => () => {
      bikes.geometry.dispose();
      bikes.material.dispose();
      bikes.mesh.dispose();
    },
    [bikes],
  );

  // R3F runs frame callbacks in ascending priority, and drei's reflector renders the floor's
  // mirror at priority 0. The scene is therefore brought up to date at -1, before the mirror
  // looks at it, and only drawn at 1 (a positive priority is also what stops R3F rendering by
  // itself). Done in one callback at 1, the reflection showed the previous frame's arena.
  useFrame((_, delta) => {
    const { model, timeline } = useCycles.getState();
    const now = performance.now();
    const fog = scene.fog as Fog | null;

    if (model !== null && timeline !== null) {
      if (rig.timeline !== timeline) {
        rig.timeline = timeline;
        rig.killedBy = null;
        // This field has laid nothing yet, whatever an earlier one took from the same timeline:
        // a new round starts at its first step anyway, a field built again in the middle of one
        // has to be given the round from its latest full.
        timeline.rewind();
      }
      ownSlotOf(rig, model.ids, you);
      // One tick ahead of the render clock: a bike is drawn riding towards the head of the next
      // tick, and its wall has to reach it there, as in the prototype the owner played.
      const steps = timeline.release(now, 1);
      for (const step of steps) applyStep(walls, rig, step);
      if (steps.length > 0) walls.flush();
      const tick = timeline.renderTick(now);
      if (Number.isFinite(tick)) walls.setTime((tick * tickMs) / 1000);

      const sample = timeline.sample(now);
      let shown = 0;
      rig.chase.slot = -1;
      if (sample !== null) {
        for (const slot of sample.from.keys()) {
          if (drawBike(bikes.mesh, shown, sample, slot, side, rig)) shown += 1;
        }
        for (const slot of sample.to.keys()) {
          if (!sample.from.has(slot) && drawBike(bikes.mesh, shown, sample, slot, side, rig)) {
            shown += 1;
          }
        }
      }
      // The player's own bike, as drawn this frame: where the player sees it, and when the turn
      // latency ends. The chase holds it while the bike is among those drawn, so nothing is looked
      // up or allocated here.
      const { chase } = rig;
      const own = rig.ownSlot !== -1 && chase.slot === rig.ownSlot;
      seenOnScreen(own ? chase.dir : null, now, chase.x, chase.z);
      bikes.mesh.count = shown;
      bikes.mesh.instanceMatrix.needsUpdate = true;
      if (bikes.mesh.instanceColor) bikes.mesh.instanceColor.needsUpdate = true;

      pointCamera(rig, camera, side, delta, fog);
    }
    // The reflector reads the camera's world matrix, which is otherwise refreshed only inside the
    // render that comes after it.
    camera.updateMatrixWorld();
  }, -1);

  useFrame((_, delta) => composer.render(delta), 1);

  return (
    <>
      <Grid side={side} />
      <Border side={side} />
      <primitive object={walls.mesh} />
      <primitive object={bikes.mesh} />
    </>
  );
}

/** The field's edge is a wall too: a bike dies against it, so it has to be seen. */
function Border({ side }: { side: number }) {
  const length = side + 0.3;
  return (
    <group position={[side / 2, 0.25, side / 2]}>
      {[
        [0, -side / 2, length, 0.3],
        [0, side / 2, length, 0.3],
        [-side / 2, 0, 0.3, length],
        [side / 2, 0, 0.3, length],
      ].map(([x, z, w, d]) => (
        <mesh key={`${x},${z}`} position={[x as number, 0, z as number]}>
          <boxGeometry args={[w as number, 0.5, d as number]} />
          <meshBasicMaterial color={BORDER_COLOUR} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * Ease the heading, not the position. Chasing a point behind the bike made the camera cut across
 * the corner on every turn, a jolt sideways; turning the angle swings it round the bike on an
 * arc instead, the way a chase camera in a racing game moves.
 */
function pointCamera(rig: Rig, camera: Camera, side: number, delta: number, fog: Fog | null): void {
  const { chase } = rig;
  const subject = chase.slot;
  if (subject !== -1) {
    const target = Math.atan2(DIR_Z[chase.dir] as number, DIR_X[chase.dir] as number);
    if (rig.yaw === null) rig.yaw = target;
    rig.yaw += wrapAngle(target - rig.yaw) * (1 - Math.exp(-5 * delta));
    const fx = Math.cos(rig.yaw);
    const fz = Math.sin(rig.yaw);
    rig.wantPosition.set(chase.x - fx * 11, 7, chase.z - fz * 11);
    rig.wantLook.set(chase.x + fx * 8, 0, chase.z + fz * 8);
  } else {
    // Nobody to follow: the whole field from above and a little to the south.
    rig.wantPosition.set(side / 2, side * 0.85, side / 2 + side * 0.55);
    rig.wantLook.set(side / 2, 0, side / 2);
  }

  // A new subject would cut the picture; the old view is kept as an offset that fades away.
  if (subject !== rig.subject) {
    if (rig.subject !== -2) {
      rig.cameraOffset.copy(camera.position).sub(rig.wantPosition);
      rig.lookOffset.copy(rig.look).sub(rig.wantLook);
    }
    rig.subject = subject;
  }
  const fade = Math.exp(-3 * delta);
  rig.cameraOffset.multiplyScalar(fade);
  rig.lookOffset.multiplyScalar(fade);
  camera.position.copy(rig.wantPosition).add(rig.cameraOffset);
  rig.look.copy(rig.wantLook).add(rig.lookOffset);
  camera.lookAt(rig.look);

  // The fog hides the far end of the field in a chase and would hide all of it from above.
  const open = subject === -1 ? 1 : 0;
  rig.openFog += (open - rig.openFog) * (1 - Math.exp(-3 * delta));
  if (fog !== null) {
    fog.near = 30 + rig.openFog * 300;
    fog.far = 110 + rig.openFog * 500;
  }
}

/** The arena: a neon field seen from behind the player's own bike. */
export default function Cycles({ you }: { you: string | null }) {
  const side = useCycles((state) => state.model?.side ?? 0);
  const tickMs = useCycles((state) => state.model?.tickMs ?? 0);
  if (side === 0) return null;
  return (
    <Canvas
      dpr={[1, 2]}
      // Only the bloom pass's full-screen quad reaches the default framebuffer now; the scene is
      // drawn into the composer's own multisampled target. Canvas MSAA would cost a multisampled
      // colour and depth buffer and a resolve every frame for edges nobody sees. Depth stays.
      gl={{ antialias: false }}
      camera={{ fov: 60, near: 0.1, far: 400, position: [side / 2, 20, side / 2] }}
      style={{ width: '100%', height: '100%' }}
    >
      <FrameMeter />
      <color attach="background" args={['#000']} />
      <fog attach="fog" args={['#000', 30, 110]} />
      <Floor side={side} />
      <Field key={`${side}:${tickMs}`} side={side} tickMs={tickMs} you={you} />
    </Canvas>
  );
}
