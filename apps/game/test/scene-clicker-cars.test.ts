import { Box3, BoxGeometry, Group, Mesh, MeshStandardMaterial, Texture, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { bakeRally } from '../src/client/scene/clicker-cars';

/**
 * A stand-in for the Kit's car: `rally.glb` points at an external texture file, which the test
 * runner cannot fetch. Three meshes, a body and two parts sharing one material with a map,
 * placed under a moved node as the Kit does.
 */
function model(): { root: Group; shared: MeshStandardMaterial } {
  const atlas = new MeshStandardMaterial({ map: new Texture(), color: '#4a9' });
  const root = new Group();
  const node = new Group();
  node.position.set(0, 0.5, 1);
  node.scale.setScalar(2);
  root.add(node);

  const body = new Mesh(new BoxGeometry(1, 1, 3), atlas);
  body.name = 'body';
  const wheel = new Mesh(new BoxGeometry(0.4, 0.4, 0.4), atlas);
  wheel.name = 'wheel-a';
  wheel.position.set(0.7, -0.3, 1);
  const glass = new Mesh(new BoxGeometry(0.8, 0.3, 1), atlas);
  glass.name = 'glass';
  glass.position.set(0, 0.6, 0);
  node.add(body, wheel, glass);
  return { root, shared: atlas };
}

const vertices = (box: BoxGeometry): number => box.getAttribute('position').count;

describe('the baked rally car', () => {
  it('puts every vertex in exactly one part and only the body in the tinted one', () => {
    const { root } = model();
    const car = bakeRally(root);
    const each = vertices(new BoxGeometry(1, 1, 1));
    expect(car.body.geometry.getAttribute('position').count).toBe(each);
    const rest = car.rest.reduce(
      (sum, part) => sum + part.geometry.getAttribute('position').count,
      0,
    );
    expect(rest).toBe(2 * each);
  });

  it('keeps the model where it stands, bounds and all', () => {
    const { root } = model();
    const car = bakeRally(root);
    const baked = new Box3();
    for (const part of [car.body, ...car.rest]) {
      part.geometry.computeBoundingBox();
      baked.union(part.geometry.boundingBox as Box3);
    }
    const posed = new Box3().setFromObject(root);
    expect(baked.min.distanceTo(posed.min)).toBeLessThan(1e-5);
    expect(baked.max.distanceTo(posed.max)).toBeLessThan(1e-5);
    expect(baked.getSize(new Vector3()).z).toBeGreaterThan(0);
  });

  it('tints a clone of the body material without touching the shared one', () => {
    const { root, shared } = model();
    const car = bakeRally(root);
    const tinted = car.body.material as MeshStandardMaterial;
    expect(tinted).not.toBe(shared);
    expect(tinted.map).toBeNull();
    expect(tinted.color.getHexString()).toBe('ffffff');
    expect(shared.map).not.toBeNull();
    expect(car.rest).toHaveLength(1);
    expect(car.rest[0]?.material).toBe(shared);
  });

  it('refuses a model without a body', () => {
    const root = new Group();
    root.add(new Mesh(new BoxGeometry(), new MeshStandardMaterial()));
    expect(() => bakeRally(root)).toThrow(/body/);
  });
});
