import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useRef } from 'react';
import { type Group, MathUtils } from 'three';
import { theme } from '../theme';

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
/**
 * The pack rides a few shared lanes, never one lane per player. Twenty lanes are a stadium:
 * either it does not fit the frame, or it fits from so far away that nobody can be told apart
 * and a detailed model would be a couple of pixels wide.
 */
const LANES = 4;
/** Distance between lanes across the track. */
const LANE = 1.15;
/** A slight stagger inside a lane, so players on the same score do not sit inside each other. */
const STAGGER = 0.24;

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

/** Named apart from the `Racer` data type on purpose: one is a shape on the track, the other a row of numbers. */
function Runner({ x, z, colour, gold }: { x: number; z: number; colour: string; gold: boolean }) {
  const group = useRef<Group>(null);

  useFrame((_state, delta) => {
    if (group.current === null) return;
    group.current.position.x = damp(group.current.position.x, x, delta);
  });

  return (
    <group ref={group} position={[0, 0, z]}>
      {/* Built from primitives rather than a bought model: at twenty players a racer is the
          size of a fingernail, and what makes it read as a car at that size is the silhouette —
          low chassis, cabin set back, wheels — not the detail on its panels. */}
      <mesh position={[0, 0.2, 0]} castShadow>
        <boxGeometry args={[0.86, 0.2, 0.46]} />
        <meshStandardMaterial color={colour} metalness={0.05} roughness={0.35} />
      </mesh>
      <mesh position={[-0.08, 0.37, 0]} castShadow>
        <boxGeometry args={[0.38, 0.19, 0.4]} />
        <meshStandardMaterial color={colour} metalness={0.05} roughness={0.4} />
      </mesh>
      {/* A wedge of a nose, so which way it faces is never in doubt. */}
      <mesh position={[0.45, 0.17, 0]} castShadow>
        <boxGeometry args={[0.18, 0.13, 0.4]} />
        <meshStandardMaterial color={colour} metalness={0.05} roughness={0.45} />
      </mesh>
      {[
        [0.27, 0.25],
        [0.27, -0.25],
        [-0.27, 0.25],
        [-0.27, -0.25],
      ].map(([wx, wz]) => (
        <mesh
          key={`${wx}:${wz}`}
          position={[wx ?? 0, 0.11, wz ?? 0]}
          rotation={[Math.PI / 2, 0, 0]}
        >
          <cylinderGeometry args={[0.11, 0.11, 0.08, 10]} />
          <meshStandardMaterial color="#1c2030" roughness={0.75} />
        </mesh>
      ))}
      {/* Your own racer wears a ring on the ground: colour alone is not enough to find
          yourself in a pack of twenty when the figure is a few pixels wide. */}
      {gold ? (
        <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.52, 0.66, 24]} />
          <meshBasicMaterial color={theme.goldBright} transparent opacity={0.9} />
        </mesh>
      ) : null}
    </group>
  );
}

/**
 * The camera frames the whole field, not the leader: following the leader alone pushes
 * everyone behind them out of the left edge, and the gap between players is the one thing
 * a race has to show.
 */
function Rig({ firstX, lastX }: { firstX: number; lastX: number }) {
  const { camera } = useThree();
  const focusRef = useRef<number | null>(null);

  useFrame((_state, delta) => {
    // Damped at the runners' own rate. The camera used to aim straight at the raw snapshot
    // position — which arrives in steps ten times a second — while the cars lagged behind
    // their own damping. Smooth position, jumping aim: that mismatch is what shook.
    const wanted = (firstX + lastX) / 2;
    focusRef.current = focusRef.current === null ? wanted : damp(focusRef.current, wanted, delta);
    const focus = focusRef.current;

    const spread = firstX - lastX;
    // Pull back as the field stretches, but never closer than a readable minimum.
    const distance = MathUtils.clamp(6 + spread * 0.45, 6, 16);

    // Mostly behind the field and only a little to the side: from side-on the track
    // crosses the frame as a diagonal band instead of receding down the lane.
    camera.position.x = damp(camera.position.x, focus - distance * 0.85, delta, 4);
    camera.position.y = damp(camera.position.y, 1.8 + distance * 0.1, delta, 4);
    camera.position.z = damp(camera.position.z, distance * 0.55, delta, 4);
    camera.lookAt(focus + 1.2, 0.4, 0);
  });

  return null;
}

function Track() {
  // Fixed: the track no longer widens with the number of players.
  const width = LANES * LANE + 3;

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
      {/* Keyed by the distance each mark stands for, which is what actually identifies it. */}
      {Array.from({ length: MARKS }, (_, index) => (index + 1) * MARK_SPACING).map((distance) => (
        <mesh key={distance} position={[distance, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.06, width]} />
          <meshBasicMaterial color="#6d7a99" />
        </mesh>
      ))}
    </group>
  );
}

export default function Race({ racers, you }: { racers: Racer[]; you: string | null }) {
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

      <Track />
      {racers.map((racer, index) => {
        const lane = index % LANES;
        const row = Math.floor(index / LANES);
        return (
          <Runner
            key={racer.id}
            x={racer.clicks * UNIT}
            // Lane from the index, then a small stagger by row: the pack keeps the same width
            // whether four people are racing or forty.
            z={(lane - (LANES - 1) / 2) * LANE + ((row % 3) - 1) * STAGGER}
            colour={LIVERY[index % LIVERY.length] ?? '#4d5a85'}
            gold={racer.id === you}
          />
        );
      })}

      <Rig firstX={firstX} lastX={lastX} />
    </Canvas>
  );
}
