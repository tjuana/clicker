import { TILE, TURN } from '@clicker/game';
import { useFrame, useLoader } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { InstancedMesh, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { CarInfo } from '../race/model';
import { useRace } from '../race/store';
import { useClient } from '../store';
import { SLOT_COLOURS } from './look';
import { bakeCar, chasePlace, poseCars } from './race-cars';
import { ASSETS, CAR, CHASE } from './race-look';

const CAR_URL = `${ASSETS}/raceCarRed.glb`;

/** Scratch for the camera; nothing is made per frame. */
const stand = new Vector3();
const target = new Vector3();

/** The slot whose car is the player's, or -1. `info` changes only with a full, so this is cached by it. */
function slotOf(info: Map<number, CarInfo>, you: string | null): number {
  if (you === null) return -1;
  for (const [slot, car] of info) if (car.id === you) return slot;
  return -1;
}

/**
 * The cars, drawn every frame between the timeline's last two ticks (never at one: at 30 Hz on
 * a 120 Hz screen the leader stood still on 271 frames of 361), and the camera that chases the
 * player's own car, or the leader's when the player has none.
 */
export function Racers() {
  const gltf = useLoader(GLTFLoader, CAR_URL);
  const meshes = useMemo(() => {
    const out = bakeCar(gltf.scene).map(({ geometry, material }) => {
      const mesh = new InstancedMesh(geometry, material, CAR.capacity);
      mesh.castShadow = true;
      // Instances move every frame, so the bounds of the one geometry at the origin mean nothing.
      mesh.frustumCulled = false;
      if (material.name === CAR.bodyMaterial) {
        SLOT_COLOURS.forEach((colour, slot) => {
          if (slot < CAR.capacity) mesh.setColorAt(slot, colour);
        });
      }
      return mesh;
    });
    return out;
  }, [gltf]);

  // Geometry and materials are ours; the loaded model gives back its GPU memory too but stays in
  // useLoader's cache, for the reason given at the track's cleanup in ring.tsx.
  useEffect(
    () => () => {
      for (const mesh of meshes) {
        mesh.geometry.dispose();
        (mesh.material as { dispose(): void }).dispose();
        mesh.dispose();
      }
      gltf.scene.traverse((object) => {
        const mesh = object as { geometry?: { dispose(): void }; material?: { dispose(): void } };
        mesh.geometry?.dispose();
        mesh.material?.dispose();
      });
    },
    [meshes, gltf],
  );

  const look = useMemo(() => new Vector3(), []);
  const follow = useRef({
    info: null as Map<number, CarInfo> | null,
    you: null as string | null,
    slot: -1,
  });
  const engaged = useRef(false);

  useFrame((state, delta) => {
    const { model, timeline } = useRace.getState();
    const sample = timeline?.sample(performance.now()) ?? null;
    if (model === null || sample === null) return;
    poseCars(meshes, sample);
    if (sample.count === 0) return;

    const you = useClient.getState().you;
    const f = follow.current;
    if (f.info !== model.info || f.you !== you) {
      f.info = model.info;
      f.you = you;
      f.slot = slotOf(model.info, you);
    }
    // Race order puts the leader first; a player who is not in the sample has no car to follow.
    let car = sample.cars[0];
    for (let k = 0; k < sample.count; k++) {
      const candidate = sample.cars[k];
      if (candidate !== undefined && candidate.slot === f.slot) car = candidate;
    }
    if (car === undefined) return;

    const camera = state.camera;
    chasePlace(car.x / TILE, car.y / TILE, (car.heading / TURN) * 2 * Math.PI, stand, target);
    if (!engaged.current) {
      // The first sight of a car: start behind it rather than fly in from the overview.
      engaged.current = true;
      camera.position.copy(stand);
      look.copy(target);
    } else {
      const k = 1 - Math.exp(-CHASE.ease * Math.min(CHASE.maxDt, delta));
      camera.position.lerp(stand, k);
      look.lerp(target, k);
    }
    camera.lookAt(look);
  });

  return (
    <>
      {meshes.map((mesh) => (
        <primitive key={mesh.uuid} object={mesh} />
      ))}
    </>
  );
}
