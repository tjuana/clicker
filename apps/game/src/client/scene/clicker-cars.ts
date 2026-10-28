import type { BufferGeometry, Material, Mesh, MeshStandardMaterial, Object3D } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** One material with every mesh that wears it merged into a single geometry. */
export interface CarPart {
  material: Material;
  geometry: BufferGeometry;
}

export interface RallyCar {
  /** Livery part: a white clone of the body's material, so an instance colour is the livery. */
  body: CarPart;
  /** Everything else, grouped by the Kit's own materials (kept shared, with their atlas). */
  rest: CarPart[];
}

/**
 * The Kit's rally car baked into the parts the clicker draws as instances. Each mesh keeps its
 * place relative to the model root (baked from its world matrix), so an instance matrix of
 * translate · rotateY · scale puts the car exactly where a posed clone of the model would stand.
 *
 * The caller disposes `body` (geometry and cloned material) and the `rest` geometries. The
 * `rest` materials are the loaded model's own and are shared with the `useGLTF` cache: disposing
 * them would break the next scene that mounts.
 */
export function bakeRally(root: Object3D): RallyCar {
  root.updateMatrixWorld(true);

  const bodies: BufferGeometry[] = [];
  let bodyMaterial: MeshStandardMaterial | null = null;
  const byMaterial = new Map<string, { material: Material; geometries: BufferGeometry[] }>();

  root.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    if (mesh.name === 'body') {
      bodyMaterial = mesh.material as MeshStandardMaterial;
      bodies.push(geometry);
      return;
    }
    const material = mesh.material as Material;
    const entry = byMaterial.get(material.uuid) ?? { material, geometries: [] };
    entry.geometries.push(geometry);
    byMaterial.set(material.uuid, entry);
  });

  const material = bodyMaterial as MeshStandardMaterial | null;
  if (material === null) throw new Error('the car has no mesh named "body"');

  const merge = (geometries: BufferGeometry[]): BufferGeometry => {
    const merged = mergeGeometries(geometries, false);
    for (const geometry of geometries) geometry.dispose();
    return merged;
  };

  // The atlas paints the body green and `color` multiplies it, so the map goes: the instance
  // colour then is the colour. The rest of the car keeps its baked detail.
  const own = material.clone();
  own.map = null;
  own.color.set('#ffffff');

  return {
    body: { material: own, geometry: merge(bodies) },
    rest: [...byMaterial.values()].map((entry) => ({
      material: entry.material,
      geometry: merge(entry.geometries),
    })),
  };
}
