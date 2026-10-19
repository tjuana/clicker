import type { DeltaMessage, FullMessage } from '@clicker/protocol';

/** What the scene needs to lay or lift one wall. `from` is the cell laid before, or -1. */
export type WallOp =
  | { kind: 'put'; cell: number; slot: number; from: number }
  | { kind: 'lift'; cell: number };

export interface Head {
  slot: number;
  cell: number;
  dir: number;
  rubber: number;
  cooldown: number;
}

export interface CyclesModel {
  side: number;
  tickMs: number;
  /** Tick of the last message applied. */
  tick: number;
  /** slot → publicId, from the last full. */
  ids: Map<number, string>;
  /** The latest heads, keyed by slot. */
  heads: Map<number, Head>;
  kills: Map<number, number>;
  deaths: Map<number, number>;
}

/** Starts over from a full message; returns the walls to draw from scratch. */
export function fromFull(full: FullMessage): { model: CyclesModel; walls: WallOp[] } {
  const ids = new Map<number, string>();
  const heads = new Map<number, Head>();
  const kills = new Map<number, number>();
  const deaths = new Map<number, number>();
  const walls: WallOp[] = [];
  for (const bike of full.bikes) {
    ids.set(bike.slot, bike.id);
    kills.set(bike.slot, bike.kills);
    deaths.set(bike.slot, bike.deaths);
    let from = -1;
    for (const cell of bike.trail) {
      walls.push({ kind: 'put', cell, slot: bike.slot, from });
      from = cell;
    }
    // A dead bike has no trail, hence no head; the head of a living one is its newest cell.
    if (bike.alive && from >= 0) {
      heads.set(bike.slot, {
        slot: bike.slot,
        cell: from,
        dir: bike.dir,
        rubber: bike.rubber,
        cooldown: bike.cooldown,
      });
    }
  }
  return {
    model: { side: full.side, tickMs: full.tickMs, tick: full.tick, ids, heads, kills, deaths },
    walls,
  };
}

/**
 * Applies one delta. Returns null when `t` is not `model.tick + 1` — the caller then asks for
 * resync — and ignores (returns the same model and no ops for) deltas with `t <= model.tick`,
 * which a connection can receive before its own full.
 */
export function applyDelta(
  model: CyclesModel,
  delta: DeltaMessage,
): { model: CyclesModel; walls: WallOp[]; events: DeltaMessage['events'] } | null {
  if (delta.t <= model.tick) return { model, walls: [], events: [] };
  if (delta.t !== model.tick + 1) return null;

  const { side } = model;
  const walls: WallOp[] = [];
  // Lifts first: a cell freed and taken again in one tick arrives as its final value, a slot.
  for (let i = 0; i < delta.cells.length; i += 2) {
    if (delta.cells[i + 1] === 0) walls.push({ kind: 'lift', cell: delta.cells[i] as number });
  }

  const respawned = new Set<number>();
  let kills = model.kills;
  let deaths = model.deaths;
  for (const event of delta.events) {
    if (event.type === 'respawned') respawned.add(event.slot);
    if (event.type !== 'died') continue;
    if (deaths === model.deaths) deaths = new Map(deaths);
    deaths.set(event.slot, (deaths.get(event.slot) ?? 0) + 1);
    if (event.by === null) continue;
    if (kills === model.kills) kills = new Map(kills);
    kills.set(event.by, (kills.get(event.by) ?? 0) + 1);
  }

  const heads = new Map<number, Head>();
  for (let i = 0; i < delta.heads.length; i += 5) {
    const slot = delta.heads[i] as number;
    heads.set(slot, {
      slot,
      cell: delta.heads[i + 1] as number,
      dir: delta.heads[i + 2] as number,
      rubber: delta.heads[i + 3] as number,
      cooldown: delta.heads[i + 4] as number,
    });
  }

  // A bike is placed and then rides its first step in the same tick, so the delta names only
  // where it ended: its spawn cell is the other cell of its slot among the tick's changes.
  const spawns = new Map<number, number>();
  if (respawned.size > 0) {
    for (let i = 0; i < delta.cells.length; i += 2) {
      const slot = delta.cells[i + 1] as number;
      if (respawned.has(slot) && heads.get(slot)?.cell !== delta.cells[i]) {
        spawns.set(slot, delta.cells[i] as number);
      }
    }
  }

  for (const { slot, cell } of heads.values()) {
    let before = model.heads.get(slot)?.cell ?? -1;
    if (respawned.has(slot)) {
      // A fresh life joins nothing before it; its own spawn cell comes first when it rode on.
      before = -1;
      const spawn = spawns.get(slot);
      if (spawn !== undefined) {
        walls.push({ kind: 'put', cell: spawn, slot, from: -1 });
        before = spawn;
      }
    }
    if (before === cell) continue; // stalled against an obstacle: nothing new laid
    if (before < 0) {
      walls.push({ kind: 'put', cell, slot, from: -1 });
      continue;
    }
    // Within one tick a bike only rides straight, so a two-cell step has its middle between.
    const apart =
      Math.abs((cell % side) - (before % side)) +
      Math.abs(Math.floor(cell / side) - Math.floor(before / side));
    if (apart === 2) {
      const middle = (cell + before) / 2;
      walls.push({ kind: 'put', cell: middle, slot, from: before });
      walls.push({ kind: 'put', cell, slot, from: middle });
    } else {
      walls.push({ kind: 'put', cell, slot, from: before });
    }
  }

  return { model: { ...model, tick: delta.t, heads, kills, deaths }, walls, events: delta.events };
}
