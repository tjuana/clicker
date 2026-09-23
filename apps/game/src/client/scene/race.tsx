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
/** Marks every metre; without them a racer over a flat floor looks motionless. */
const MARKS = 48;
const MARK_SPACING = 1;

/** Smoothing: snapshots land ten times a second, the eye wants sixty. */
const damp = (current: number, target: number, delta: number, rate = 7): number =>
  MathUtils.damp(current, target, rate, delta);

/** Named apart from the `Racer` data type on purpose: one is a shape on the track, the other a row of numbers. */
function Runner({ x, z, gold }: { x: number; z: number; gold: boolean }) {
  const group = useRef<Group>(null);

  useFrame((_state, delta) => {
    if (group.current === null) return;
    group.current.position.x = damp(group.current.position.x, x, delta);
  });

  return (
    <group ref={group} position={[0, 0, z]}>
      {/* A body and a nose: enough of a shape to tell which way it is facing. */}
      <mesh position={[0, 0.3, 0]} castShadow>
        <boxGeometry args={[0.72, 0.42, 0.56]} />
        <meshStandardMaterial
          color={gold ? theme.goldBright : '#4d5a85'}
          metalness={0.1}
          roughness={0.55}
        />
      </mesh>
      <mesh position={[0.46, 0.24, 0]} rotation={[0, 0, Math.PI / 4]}>
        <boxGeometry args={[0.26, 0.26, 0.5]} />
        <meshStandardMaterial
          color={gold ? theme.gold : '#3f4a6d'}
          metalness={0.1}
          roughness={0.6}
        />
      </mesh>
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

  useFrame((_state, delta) => {
    const focus = (firstX + lastX) / 2;
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
        <meshStandardMaterial color="#1b2136" roughness={0.95} />
      </mesh>

      {/* The start line, and then a mark every metre to make speed legible. */}
      <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.12, width]} />
        <meshBasicMaterial color={theme.gold} />
      </mesh>
      {/* Keyed by the distance each mark stands for, which is what actually identifies it. */}
      {Array.from({ length: MARKS }, (_, index) => (index + 1) * MARK_SPACING).map((distance) => (
        <mesh key={distance} position={[distance, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.04, width]} />
          <meshBasicMaterial color="#2c3450" />
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
      <color attach="background" args={[theme.surface]} />
      <fog attach="fog" args={[theme.surface, 16, 34]} />

      <ambientLight intensity={0.55} />
      <directionalLight position={[6, 9, 6]} intensity={1.5} castShadow />

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
            gold={racer.id === you}
          />
        );
      })}

      <Rig firstX={firstX} lastX={lastX} />
    </Canvas>
  );
}
