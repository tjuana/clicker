import {
  BoxGeometry,
  Color,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
} from 'three';
import type { WallOp } from '../cycles/model';
import {
  FOOT,
  PULSE,
  PULSE_EXPONENT,
  PULSE_PERIOD_S,
  RIM,
  RIM_EXPONENT,
  SLOT_COLOURS,
  TOP,
  TOP_FROM,
  TOP_TO,
  WALL_LEVEL,
} from './look';

/** Twenty bikes with trails of at most 400 cells, and room for the cells a boost lays in passing. */
const MAX_WALLS = 20 * 400 + 64;

const THICK = 0.12;
/**
 * Lower than the bike, which stands about 0.9 tall: a wall as high as the bike swallowed it, since
 * the trail runs right up to the head. In the films the wall streams out below the rider too.
 */
const WALL_HEIGHT = 0.42;
const UP = new Vector3(0, 1, 0);

const WALL = SLOT_COLOURS.map((c) => c.clone().multiplyScalar(WALL_LEVEL));

/** Scratch objects, one set for the whole module: nothing in the frame loop allocates. */
const matrix = new Matrix4();
const position = new Vector3();
const scale = new Vector3();
const rotation = new Quaternion();
const colour = new Color();

export interface Walls {
  mesh: InstancedMesh;
  /** Lays one step's ops. A reset clears first and dates a trail's cells one tick apart, oldest first. */
  lay: (ops: WallOp[], tick: number, reset: boolean) => void;
  /** Uploads what changed since the last flush; once a frame. */
  flush: () => void;
  /** The pulse's clock, in the same seconds as the cells' dates. */
  setTime: (seconds: number) => void;
  dispose: () => void;
}

const glsl = (value: number): string => value.toFixed(3);

/**
 * The trails as one instanced mesh, one instance per cell. A cell finds its instance through a
 * `Map`, and lifting one moves the last instance into the hole, so a lift is O(1) and the
 * instances stay packed with no gaps to skip. The shade (gradient, bright top, rim, pulse) is
 * computed on the GPU from the cell's height and the second it was laid.
 */
export function createWalls(side: number, tickMs: number): Walls {
  const geometry = new BoxGeometry(1, 1, 1);
  const laid = new InstancedBufferAttribute(new Float32Array(MAX_WALLS), 1);
  geometry.setAttribute('laid', laid);

  // Made before the first compile and shared with the shader, so `setTime` works at any moment.
  const time = { value: 0 };
  const material = new MeshBasicMaterial({ toneMapped: false });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.time = time;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float laid;
varying float vHeight;
varying float vLaid;
varying vec3 vViewNormal;
varying vec3 vViewPos;`,
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
vHeight = position.y + 0.5;
vLaid = laid;
vViewNormal = normalize(normalMatrix * mat3(instanceMatrix) * normal);
vViewPos = mvPosition.xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float time;
varying float vHeight;
varying float vLaid;
varying vec3 vViewNormal;
varying vec3 vViewPos;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
float top = smoothstep(${glsl(TOP_FROM)}, ${glsl(TOP_TO)}, vHeight);
float body = mix(${glsl(FOOT)}, 1.0, vHeight * vHeight);
float rim = pow(max(1.0 - abs(dot(normalize(vViewNormal), normalize(-vViewPos))), 0.0), ${glsl(RIM_EXPONENT)});
float pulse = pow(max(0.5 + 0.5 * cos(6.2831853 * (time + vLaid) / ${glsl(PULSE_PERIOD_S)}), 0.0), ${glsl(PULSE_EXPONENT)});
diffuseColor.rgb *= body * (1.0 + ${glsl(RIM)} * rim + ${glsl(PULSE)} * pulse) + top * ${glsl(TOP)};`,
      );
  };

  const mesh = new InstancedMesh(geometry, material, MAX_WALLS);
  mesh.frustumCulled = false;
  mesh.count = 0;
  // The colour attribute must exist before the first flush, which adds ranges to it.
  mesh.setColorAt(0, colour.set(0));
  const colours = mesh.instanceColor as InstancedBufferAttribute;

  const instanceOf = new Map<number, number>();
  const cellAt = new Int32Array(MAX_WALLS);
  const slotAt = new Int32Array(MAX_WALLS);
  let count = 0;

  // Every index written since the last flush, so the flush can upload those instances alone. The
  // list itself allocates nothing: a fixed buffer, and a write beyond its end falls back to a full upload.
  const touched = new Int32Array(MAX_WALLS * 2);
  let touchedCount = 0;
  let overflow = false;
  const touch = (i: number): void => {
    if (touchedCount === touched.length) overflow = true;
    else touched[touchedCount++] = i;
  };

  const put = (cell: number, slot: number, from: number, date: number): void => {
    let i = instanceOf.get(cell);
    if (i === undefined) {
      if (count === MAX_WALLS) return;
      i = count;
      count += 1;
      instanceOf.set(cell, i);
      cellAt[i] = cell;
    }
    slotAt[i] = slot;
    const x = (cell % side) + 0.5;
    const z = Math.floor(cell / side) + 0.5;
    const fx = from < 0 ? x : (from % side) + 0.5;
    const fz = from < 0 ? z : Math.floor(from / side) + 0.5;
    const along = Math.abs(fx - x) + Math.abs(fz - z);
    rotation.setFromAxisAngle(UP, fz !== z ? Math.PI / 2 : 0);
    // A cell's wall runs from the centre of the cell laid before it to its own centre, a wall's
    // thickness longer, so consecutive walls overlap at the centres and a corner closes. A wall
    // centred on its own cell instead stops at the cell's edge and leaves a gap at every turn.
    matrix.compose(
      position.set((x + fx) / 2, WALL_HEIGHT / 2, (z + fz) / 2),
      rotation,
      scale.set(along + THICK, WALL_HEIGHT, THICK),
    );
    mesh.setMatrixAt(i, matrix);
    mesh.setColorAt(i, WALL[(slot - 1) % WALL.length] as Color);
    laid.setX(i, date);
    touch(i);
  };

  const lifted = (cell: number): void => {
    const i = instanceOf.get(cell);
    if (i === undefined) return;
    const last = count - 1;
    if (i !== last) {
      mesh.getMatrixAt(last, matrix);
      mesh.setMatrixAt(i, matrix);
      mesh.getColorAt(last, colour);
      mesh.setColorAt(i, colour);
      laid.setX(i, laid.getX(last));
      const moved = cellAt[last] as number;
      cellAt[i] = moved;
      slotAt[i] = slotAt[last] as number;
      instanceOf.set(moved, i);
      touch(i);
    }
    instanceOf.delete(cell);
    count = last;
  };

  // Scratch for a reset: how many cells each slot lays, then how many are dated so far.
  const trailLength = new Map<number, number>();
  const dated = new Map<number, number>();
  // What a reset finds already laid, by cell: its date and its owner. A reset is rare (a join, a
  // resync), so these maps growing once per reset is fine; the per-tick path never touches them.
  const heldDate = new Map<number, number>();
  const heldSlot = new Map<number, number>();

  return {
    mesh,
    lay: (ops, tick, reset) => {
      if (reset) {
        heldDate.clear();
        heldSlot.clear();
        for (const [cell, i] of instanceOf) {
          heldDate.set(cell, laid.getX(i));
          heldSlot.set(cell, slotAt[i] as number);
        }
        instanceOf.clear();
        count = 0;
        // fromFull emits each trail consecutively, oldest first: the k-th of n cells of a slot was
        // laid n - 1 - k ticks ago. Dating them all alike would make a late joiner's whole field
        // pulse in unison for good. Counting back is wrong for a cell this client already holds, though:
        // a boost lays two cells in a tick and a stall none, so it would re-date everything behind
        // a boost a second early. A cell kept by the same bike keeps the date it was laid with.
        trailLength.clear();
        dated.clear();
        for (const op of ops) {
          if (op.kind === 'put') trailLength.set(op.slot, (trailLength.get(op.slot) ?? 0) + 1);
        }
        for (const op of ops) {
          if (op.kind === 'lift') {
            lifted(op.cell);
            continue;
          }
          const k = dated.get(op.slot) ?? 0;
          dated.set(op.slot, k + 1);
          const n = trailLength.get(op.slot) as number;
          const kept = heldSlot.get(op.cell) === op.slot ? heldDate.get(op.cell) : undefined;
          put(op.cell, op.slot, op.from, kept ?? ((tick - (n - 1 - k)) * tickMs) / 1000);
        }
        return;
      }
      const date = (tick * tickMs) / 1000;
      for (const op of ops) {
        if (op.kind === 'put') put(op.cell, op.slot, op.from, date);
        else lifted(op.cell);
      }
    },
    /**
     * Not the obvious `needsUpdate` alone: that re-uploads whole buffers (about 1.2 MB a tick at
     * full size, plan 8's review) for the few instances a tick changes. Ranges tell three to send
     * just those. Not free either: `addUpdateRange` makes a `{start, count}` object per call, so a
     * tick costs a few dozen small objects and a reset a few thousand, against the ~1.2 MB upload
     * it replaces. Cheaper than that upload by orders of magnitude, but not allocation-free.
     * They are never cleared here: three clears them after it uploads, and clearing
     * ourselves could drop the ranges of a flush no frame has rendered yet.
     */
    flush: () => {
      mesh.count = count;
      if (overflow) {
        // More writes than the buffer holds: one range over everything is cheaper than the list.
        mesh.instanceMatrix.addUpdateRange(0, MAX_WALLS * 16);
        colours.addUpdateRange(0, MAX_WALLS * 3);
        laid.addUpdateRange(0, MAX_WALLS);
      } else {
        for (let k = 0; k < touchedCount; k += 1) {
          const i = touched[k] as number;
          mesh.instanceMatrix.addUpdateRange(i * 16, 16);
          colours.addUpdateRange(i * 3, 3);
          laid.addUpdateRange(i, 1);
        }
      }
      touchedCount = 0;
      overflow = false;
      mesh.instanceMatrix.needsUpdate = true;
      colours.needsUpdate = true;
      laid.needsUpdate = true;
    },
    setTime: (seconds) => {
      time.value = seconds;
    },
    dispose: () => {
      geometry.dispose();
      material.dispose();
      mesh.dispose();
    },
  };
}
