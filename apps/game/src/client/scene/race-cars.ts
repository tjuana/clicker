import { TILE, TURN } from '@clicker/game';
import {
  Box3,
  type BufferGeometry,
  type InstancedMesh,
  type Material,
  Matrix4,
  type Mesh,
  type MeshStandardMaterial,
  type Object3D,
  Quaternion,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Sample } from '../race/timeline';
import { CAR, CHASE } from './race-look';

/** One material of the car with every mesh that wears it merged: one draw call per part. */
export interface CarPart {
  material: Material;
  geometry: BufferGeometry;
}

/**
 * The Kit's car baked per material: each mesh in its place, the whole car centred on its
 * footprint with the wheels on the ground and scaled to `CAR.length`. The geometry and the cloned
 * materials are the caller's to dispose; the loaded model is not touched.
 */
export function bakeCar(root: Object3D): CarPart[] {
  root.updateMatrixWorld(true);
  const box = new Box3().setFromObject(root, true);
  const scale = CAR.length / (box.max.z - box.min.z);
  // The Kit's root node carries an offset of its own: centre by the real bounds, never by luck.
  const fit = new Matrix4()
    .makeScale(scale, scale, scale)
    .multiply(
      new Matrix4().makeTranslation(
        -(box.min.x + box.max.x) / 2,
        -box.min.y,
        -(box.min.z + box.max.z) / 2,
      ),
    );

  const byMaterial = new Map<
    string,
    { material: MeshStandardMaterial; geometries: BufferGeometry[] }
  >();
  root.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    const material = mesh.material as MeshStandardMaterial;
    const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld).applyMatrix4(fit);
    const entry = byMaterial.get(material.name) ?? { material, geometries: [] };
    entry.geometries.push(geometry);
    byMaterial.set(material.name, entry);
  });

  return [...byMaterial.values()].map(({ material, geometries }) => {
    const merged = mergeGeometries(geometries);
    for (const geometry of geometries) geometry.dispose();
    const own = material.clone();
    if (material.name === CAR.bodyMaterial) own.color.set('#ffffff');
    return { material: own, geometry: merged };
  });
}

/**
 * Rotation about +y that makes the Kit's car, which faces +z, face a rules heading (0 east, a
 * turn of `TURN`, y south = +z). The tiles face -z, so this is the tiles' turn plus a half turn:
 * without it the owner saw the cars drive backwards.
 */
export const carYaw = (heading: number): number =>
  (3 * Math.PI) / 2 - (heading / TURN) * 2 * Math.PI + Math.PI;

const UP = new Vector3(0, 1, 0);
const ONE = new Vector3(1, 1, 1);
const place = new Matrix4();
const spot = new Vector3();
const turn = new Quaternion();
/** A car with no place this frame: scaled to nothing, so it draws no pixel. */
const HIDDEN = new Matrix4().makeScale(0, 0, 0);

/** Writes the sample into the instances, the slot being the instance, so colours are set once. */
export function poseCars(meshes: readonly InstancedMesh[], sample: Sample): void {
  for (const mesh of meshes) {
    for (let i = 0; i < CAR.capacity; i++) mesh.setMatrixAt(i, HIDDEN);
  }
  for (let k = 0; k < sample.count; k++) {
    const car = sample.cars[k];
    if (car === undefined || car.slot >= CAR.capacity) continue;
    turn.setFromAxisAngle(UP, carYaw(car.heading));
    place.compose(spot.set(car.x / TILE, 0, car.y / TILE), turn, ONE);
    for (const mesh of meshes) mesh.setMatrixAt(car.slot, place);
  }
  for (const mesh of meshes) mesh.instanceMatrix.needsUpdate = true;
}

/** Where the chase camera wants to stand and what it looks at, for a car at (x, z) heading `angle`. */
export function chasePlace(
  x: number,
  z: number,
  angle: number,
  stand: Vector3,
  look: Vector3,
): void {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  stand.set(x - c * CHASE.behind, CHASE.above, z - s * CHASE.behind);
  look.set(x + c * CHASE.ahead, CHASE.lookHeight, z + s * CHASE.ahead);
}
