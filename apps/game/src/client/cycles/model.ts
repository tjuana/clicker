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
  energy: number;
  cap: number;
  lit: boolean;
  /** Whether its cell carries a wall instance: a bike without its wall leaves nothing under it. */
  drawn: boolean;
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

/** Manhattan distance between two cells of a square field. */
function apart(a: number, b: number, side: number): number {
  return Math.abs((a % side) - (b % side)) + Math.abs(Math.floor(a / side) - Math.floor(b / side));
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
    // A button-mode trail has gaps: only neighbours are joined, so a bar never spans a hole.
    let from = -1;
    let drawn = false;
    const last = bike.trail.length - 1;
    bike.trail.forEach((cell, index) => {
      const joined = from >= 0 && apart(cell, from, full.side) === 1;
      // The head of a bike that is not laying a wall is a bare cell, unless it continues a wall.
      const isDrawn = index < last || bike.lit || joined;
      if (isDrawn) walls.push({ kind: 'put', cell, slot: bike.slot, from: joined ? from : -1 });
      if (index === last) drawn = isDrawn;
      from = cell;
    });
    // A dead bike has no trail, hence no head; the head of a living one is its newest cell.
    if (bike.alive && from >= 0) {
      heads.set(bike.slot, {
        slot: bike.slot,
        cell: from,
        dir: bike.dir,
        rubber: bike.rubber,
        cooldown: bike.cooldown,
        energy: bike.energy,
        cap: bike.cap,
        lit: bike.lit,
        drawn,
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
  for (let i = 0; i < delta.heads.length; i += 8) {
    const slot = delta.heads[i] as number;
    heads.set(slot, {
      slot,
      cell: delta.heads[i + 1] as number,
      dir: delta.heads[i + 2] as number,
      rubber: delta.heads[i + 3] as number,
      cooldown: delta.heads[i + 4] as number,
      energy: delta.heads[i + 5] as number,
      cap: delta.heads[i + 6] as number,
      lit: delta.heads[i + 7] === 1,
      drawn: false, // settled below, once the walls are laid
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

  // What each cell ends the tick holding: a wall is laid only where the rules still have one.
  const finals = new Map<number, number>();
  for (let i = 0; i < delta.cells.length; i += 2) {
    finals.set(delta.cells[i] as number, delta.cells[i + 1] as number);
  }

  for (const head of heads.values()) {
    const { slot, cell } = head;
    const prev = model.heads.get(slot);
    let before = prev?.cell ?? -1;
    let prevDrawn = prev?.drawn ?? false;
    if (respawned.has(slot)) {
      // A fresh life joins nothing before it; its own spawn cell comes first when it rode on.
      before = -1;
      prevDrawn = false;
      const spawn = spawns.get(slot);
      if (spawn !== undefined) {
        walls.push({ kind: 'put', cell: spawn, slot, from: -1 });
        before = spawn;
        prevDrawn = true;
      } else {
        // It could not ride on: it is drawn only if it is laying a wall already.
        head.drawn = head.lit;
        if (head.lit) walls.push({ kind: 'put', cell, slot, from: -1 });
        continue;
      }
    }
    if (before === cell) {
      head.drawn = prevDrawn; // stalled against an obstacle: nothing new laid
      continue;
    }
    if (before < 0) {
      // Seen for the first time (a bike that joined between fulls): as a respawn that did not move.
      head.drawn = head.lit;
      if (head.lit) walls.push({ kind: 'put', cell, slot, from: -1 });
      continue;
    }
    // A cell the bike left is a wall only if the rules still hold it for this slot; absent from
    // the delta means untouched, and so unchanged.
    const keptBefore = (finals.get(before) ?? slot) === slot;
    // The bike lit up where it stood: that cell was bare and becomes the first of a wall.
    if (keptBefore && !prevDrawn) walls.push({ kind: 'put', cell: before, slot, from: -1 });
    // Within one tick a bike only rides straight, so a two-cell step has its middle between.
    if (apart(cell, before, side) === 2) {
      const middle = (cell + before) / 2;
      if (finals.get(middle) === slot) {
        walls.push({ kind: 'put', cell: middle, slot, from: keptBefore ? before : -1 });
        walls.push({ kind: 'put', cell, slot, from: middle });
        head.drawn = true;
      }
    } else if (keptBefore) {
      walls.push({ kind: 'put', cell, slot, from: before });
      head.drawn = true;
    }
  }

  return { model: { ...model, tick: delta.t, heads, kills, deaths }, walls, events: delta.events };
}
