# Ring Race Rules Implementation Plan (plan 11)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The ring race as pure rules in `packages/game/src/modes/race`: a track built from tiles and validated, integer arcade cars that hit walls and bump each other, laps, standings, a finish, and bots that race — all deterministic, gated like the light cycles, and not yet wired into the room.

**Architecture:** A track is data — a start pose and a chain of pieces — built once into integer geometry. A car's place is its piece and `(along, lateral)` in it; it walks from piece to piece across shared tile edges (DooM_42's portal walk). Physics is integer at 30 Hz. The `race` mode object implements `Mode` and is tested on its own; registering it in the room, the protocol and the round's early end are plan 12.

**Tech Stack:** TypeScript, Vitest (node), the existing `complexity.ts` and purity gates.

Spec: [ring race design](../specs/2026-10-26-ring-race-design.md), §2–§5.

---

## What was verified before this plan

A scratch prototype (plain ES modules in the session scratchpad, not in the repository) built the
track from pieces, ran integer physics at 30 Hz with walls and bumps, and raced bots on it.

- **The Ring** — `start (6, 0.5) east`, pieces
  `R3, S2, R3, S2, L1, R1, S1, R3, S2, S1, R3, S2, S2` (S = straight of n tiles, R/L = corner of
  size n) — closes, claims no tile twice, fits in 10 × 9 tiles, and is 29.28 tiles round. The start
  line is at the end of the main straight, so the grid sits on the last two straights.
- **Numbers that raced well:** top speed 1.6 tiles/s (218 units a tick), grass 0.6; acceleration
  3 units a tick per tick, braking 7, drag 1, extra grass drag 5, reverse up to 0.4 tiles/s;
  steering up to 52 heading steps a tick, reached at 0.5 tiles/s, reduced by 35 % at top speed;
  car radius 0.1 tile; corner speeds for bots 0.95, 1.35 and 1.6 tiles/s for centreline radii 0.5,
  1.5, 2.5; bot lookahead 0.45 + 0.8 × v/vmax tiles; bot pace 88–97 %.
- **Results:** a lone bot ran three laps in 63.8 s (about 21 s a lap) without touching a wall;
  twenty bots all finished, between 60.0 and 63.9 s, nobody stalled for more than 3 ticks; the
  tile-binned bump test made about 135 pair checks a tick for twenty cars.

What the prototype found, each of which would have broken a plan written from the design alone:

1. **A corner's projection must continue past its ends.** The "diamond angle" that maps a point on
   the quarter ring to `along` (`b / (a + b)` of the components towards exit and entry) turns back
   once the point is beyond the exit, so `along` shrank instead of passing the piece's length and
   the car never stepped onto the next piece. Before the entry edge and past the exit edge, a corner
   continues as a straight line: `along = before` (negative) or `length + past`.
2. **A wall that only scales the speed traps a car.** Projecting the speed onto the tangent and
   keeping the heading stopped a car that hit head-on, with its nose still in the wall; steering is
   zero at zero speed, so it never got out (324 ticks and counting). The wall also turns the nose a
   quarter of the way to the tangent each tick: the car slides along and can drive off.
3. **The grid must stand on straights.** Placed on the last corner, cars faced the corner's entry
   direction, not its tangent. The track data puts the start line where the main straight ends.

Then the owner watched the visual prototype and said the cars drove backwards and that collisions
were bad. Both were real, and both changed this plan:

4. **One circle is the wrong shape for a car.** A 0.1-tile circle under a car 0.3 tile long and
   0.13 wide let cars drive into each other's noses and tails. A car is **two circles** of radius
   0.065 tile, 0.085 ahead of and behind its centre, for walls and for bumps alike.
5. **Pushing apart is not enough; the car behind must slow.** With pushes alone, a faster car
   re-entered the one in front every tick (overlaps of 0.11 tile). A car whose nose points at the
   other (the dot product above 0.3) can go no faster than that one, from the speeds before the
   tick. Capping it at 95 % of the leader's speed instead slowed whole trains to a crawl, because
   the factor compounds down the queue: the cap is the leader's speed itself.
6. **One pass of pushes leaves overlaps** where a car is pushed by several neighbours: two passes,
   the second from the positions the first left.
7. **Bots need to overtake, or they queue.** A bot with a car within half a tile ahead in its lane
   moves 0.2 tile to the freer side, up to ±0.22, but only into a lane nobody is driving in
   alongside. Their base lanes are ±0.17 apart, not 0.12: at 0.12 two cars in neighbouring lanes
   overlap by design.

With these, twenty bots finished between 61.5 and 82.7 s, the worst overlap of any two cars'
circles in a whole race was 0.029 tile (none above 0.03), and nobody was slower than 10 units for
more than 68 ticks.

---

## How to execute

- Branch `plan-11-race-rules` (exists; the design is its first commit).
- One task, one commit; Conventional Commits; English; **no attribution of any kind**.
- Before every commit: `pnpm format && pnpm check && pnpm typecheck && pnpm test`.
- Every task belongs to the `engine` agent. No room, protocol or client changes in this plan.
- Every new test is first seen failing for the right reason.
- No load or stress experiments on the owner's machine.

---

### Task 1: Integer trigonometry and the purity gate

**Files:** `packages/game/src/modes/race/fixed.ts`, `packages/game/test/race-fixed.test.ts`, `packages/game/test/purity.test.ts`.

```ts
export const TILE = 4096;        // position units per tile
export const TURN = 4096;        // heading steps per turn
export const ONE = 16384;        // scale of sine and cosine
export function sin(heading: number): number;  // integer, ONE = 1.0
export function cos(heading: number): number;
```

- [ ] The table is built once at module load **without `Math.sin`**: a Taylor series on
  `[0, π/2]` in doubles to x¹⁵ (only `+ − × ÷`, exactly rounded in IEEE 754), mirrored to the four
  quadrants, rounded to integers. Test (here `Math.sin` is allowed): every entry equals
  `Math.round(Math.sin(…) × ONE)`; `sin² + cos²` within 2 units of `ONE²`/`ONE`; symmetry.
- [ ] The purity scan extends to `modes/race` with the same ban as `modes/cycles`
  (`Math.sin|cos|tan|atan2|exp|pow`, `Date`, `Math.random`). See it fail on a planted `Math.sin`.
- [ ] Commit: `feat(game): give the race integer trigonometry`.

### Task 2: Tracks — data, validator, geometry, the portal walk

**Files:** `packages/game/src/modes/race/{track.ts,tracks.ts}`, `packages/game/test/race-track.test.ts`.

```ts
export type Piece =
  | { kind: 'straight'; tiles: 1 | 2 }
  | { kind: 'corner'; size: 1 | 2 | 3; turn: 'left' | 'right' };
export interface TrackData { id: string; name: string; start: { x: number; y: number; dir: 0 | 1 | 2 | 3 }; pieces: Piece[] }
export interface Track { id: string; pieces: Built[]; length: number /* units */; tiles: Map<number, number> /* tile key → piece */; grid: … }
export function buildTrack(data: TrackData): Track;           // throws TrackError naming the fault
export function project(track: Track, piece: number, x: number, y: number): { along: number; lateral: number };
export function point(track: Track, piece: number, along: number, lateral: number): { x: number; y: number; heading: number };
export function walk(track: Track, piece: number, x: number, y: number): { piece: number; along: number; lateral: number; crossed: -1 | 0 | 1 };
```

- Directions 0 east, 1 south, 2 west, 3 north (y down), as the light cycles. The start pose is the
  midpoint of the first piece's entry edge; coordinates are in units (`TILE` a tile), integers.
- A straight of n tiles runs n tiles along its direction. A corner of size s turning right or left
  has its centre `rc = s − 0.5` tiles to that side of the entry point; it exits at
  `centre + dir × rc`, facing `dir ± 1`; it claims the s × s block between the centre, the entry
  side and the direction of travel. Length: a straight `n × TILE`; a corner `round(π/2 × rc)`.
- `project`: straights are linear; corners use the diamond angle inside the quarter and continue as
  straight lines before the entry and past the exit (finding 1). `lateral` is positive to the right
  of travel. `point` is its inverse (the diamond angle's inverse direction, normalised with
  `Math.sqrt`, rounded); its `heading` is the tangent: the piece's direction on a straight, the
  entry direction plus or minus `t × TURN/4` on a corner.
- `walk` steps forward while `along > length` and back while `along < 0`, at most a few steps,
  and reports a crossing of the start line (forward `+1`, backward `−1`).
- **Validator** (`TrackError` with a message naming the piece): the chain closes on its start pose;
  no tile is claimed twice; the last two pieces are straights (the grid, finding 3); at least 8
  pieces; coordinates inside ±4096 tiles; sizes and tiles in range.
- `tracks.ts` holds the Ring (above) and `TRACKS: Record<string, TrackData>`.

Tests: the Ring builds with length 29.28 tiles ± 1 unit per corner; a chain that does not close, a
piece that overlaps another, a corner as last piece each throw a `TrackError` naming it;
`point` then `project` returns the same `(along, lateral)` within 2 units across every piece, for
lateral −0.5…0.5 (property over a fixed grid of samples, no randomness needed); `along` grows
monotonically along a line driven straight through a corner's exit (finding 1); `walk` steps onto
the next piece at the exit edge and back at the entry edge, and reports the start-line crossing.
- [ ] Commit: `feat(game): build race tracks from tiles and walk cars across them`.

### Task 3: The car — gas, brake, steering, surfaces, walls

**Files:** `packages/game/src/modes/race/car.ts`, `packages/game/src/modes/race/config.ts`, `packages/game/test/race-car.test.ts`.

```ts
export const GAS = 1, BRAKE = 2, LEFT = 4, RIGHT = 8;  // the input mask
export interface Car { slot: number; publicId: string; bot: boolean; x: number; y: number; heading: number; speed: number; piece: number; lap: number; keys: number; finish: number | null; best: number | null; lapStart: number; pace: number; wall: number }
export function drive(car: Car, track: Track, config: RaceConfig): void; // mutates the step's own copy
```

- `RaceConfig` holds the prototype's numbers (above), in units a tick, with a why each.
- Order per tick: speed from keys and surface (asphalt and kerb `|lateral| ≤ 0.418` tile, else
  grass), heading from steering (rate grows to its maximum at 0.5 tiles/s, falls by 35 % towards top
  speed, reversed when moving backwards), move along the heading, walk to the right piece, then the
  wall.
- **Wall**: each of the car's two circles (finding 4) is checked; the deeper one past
  `0.5 tile − radius` pushes the whole car back towards the centreline by its overlap; speed × |cos| of the angle
  between heading and tangent (A6: the dot product taken once; the result never longer than the
  input); and the heading turned a quarter of the way to the tangent, or to its reverse when moving
  backwards (finding 2).
Tests: from rest with gas the car reaches top speed in about 75 ticks and no further; on grass the
top speed is the grass one; without keys it coasts to a stop; braking past zero reverses up to the
reverse limit; steering at rest does not turn; **A6 property** over a set of angles: the speed
after a wall hit is never larger, and a glancing hit keeps more than a head-on one; **a head-on hit
does not trap**: gas plus steering gets the car off the wall within 30 ticks (see it fail with the
nose-turn removed).
- [ ] Commit: `feat(game): drive race cars on asphalt and grass, and slide them along walls`.

### Task 4: Bumps

**Files:** `packages/game/src/modes/race/bump.ts`, `packages/game/test/race-bump.test.ts`, `packages/game/test/race-complexity.test.ts`.

- A car is two circles (finding 4). Bin each car by its tile (`y × width + x` of the track's
  bounding box — bounded, so no hash, plan 5's A2), compare each car with the same and the eight
  neighbouring bins, each pair once (lower slot first), each of its circles against each of the
  other's, and accumulate pushes of half the overlap each along the line of centres, computed from
  the positions **before** any car moves; apply them together. Then a second pass from the new
  positions (finding 6).
- The car behind — whose nose points at the other, dot product above 0.3 — is capped at the other's
  speed, from the speeds before the tick (finding 5).
Tests: two overlapping cars end at least `2 × radius` apart between their nearest circles
(within a unit); a car driving into the back of a slower one ends no faster than it; the
result is the same whatever order the cars are listed in (permute twenty cars, compare); cars in
different, non-neighbouring tiles are never compared. **Growth:** with cars spread one per tile,
pair checks grow ×10 for ×10 cars (linear), not ×100 — counted, not timed (`complexity.ts`). See it
fail against an all-pairs loop.
- [ ] Commit: `feat(game): let race cars bump, the same whatever their order`.

### Task 5: The race — grid, laps, standings, finish

**Files:** `packages/game/src/modes/race/{state.ts,race.ts}`, `packages/game/test/race-race.test.ts`.

```ts
export interface RaceState { track: string; cars: Car[]; index: Record<string, number>; tick: number; seed: number; firstFinish: number | null; results: RaceResultRow[] | null }
export function startRace(state: RaceState, track: Track, config: RaceConfig): RaceState; // grid
export function stepRace(state: RaceState, track: Track, config: RaceConfig): { state: RaceState; changes: RaceChanges };
export function over(state: RaceState, config: RaceConfig): boolean;
export function standings(state: RaceState, track: Track): number[]; // slots in race order
```

- **Grid**: two abreast at lateral ±0.15 tile, rows 0.4 tile apart, back from the start line along
  the last pieces (straights by the validator), facing the track, slot order. Lap 0 until the line
  is first crossed forward.
- **Step**: copy the cars (the state is never mutated), drive each (bots decide first, Task 6),
  bump, then laps: a forward crossing of the line ends a lap (recording `best` from `lapStart`), a
  backward one takes it away; the third completed lap sets `finish` to the tick and freezes the car
  (brakes on, keys ignored). `changes` lists the events of the tick: `lap`, `finished`, `bump`.
- **Progress** = `lap × length + piece start + along`; **standings**: finished by finish tick, then
  by progress, then slot — the built-in sort (A11).
- **Over**: every car finished; or `tick ≥ firstFinish + 30 s`; or `tick ≥ 5 min`.
- **Results**: rank, laps completed, best lap, finish tick or the distance short.
Tests: the grid puts twenty cars on the road, facing forward, none overlapping; driving straight
back over the line and forward again does not count a lap; a car crossing the line three times
finishes and stops; standings order by finish, then progress; `over` at each of its three
conditions; the step leaves its input state untouched (deep-equal before and after).
- [ ] Commit: `feat(game): race three laps and rank the field`.

### Task 6: Bots

**Files:** `packages/game/src/modes/race/bot.ts`, `packages/game/test/race-bot.test.ts`, `race-complexity.test.ts`.

- A bot aims at the centreline point `0.45 + 0.8 × v/vmax` tiles ahead on its lane (slot-based,
  −0.17, 0, +0.17; it overtakes into a free lane as finding 7 says, looking only at the cars in its
  own and neighbouring tile bins, so the cost does not grow with the field), steers by the sign of the cross product with a small dead zone, and keeps
  under the speed of the slowest corner within its braking distance plus 0.6 tile (radius → speed
  from the config table). Its pace (88–97 % of top speed) comes from the seeded PRNG at the grid.
- No transcendental functions; the PRNG (mulberry32, as the light cycles) lives in the state.
Gates: a lone bot finishes three laps of the Ring in at most 70 s of ticks and touches a wall on at
most 10 ticks; twenty bots all finish within 90 s, none is slower than 10 units for more than 75
ticks, and **the deepest overlap of any two cars' circles in the whole race is under 0.03 tile** —
what the owner saw as cars inside each other; **cost**: one decision visits a number of pieces that does not grow with the track
(a Ring versus a track of four Rings' worth of straights — counted).
- [ ] Commit: `feat(game): race bots that follow the line and brake for corners`.

### Task 7: The `race` mode object and determinism

**Files:** `packages/game/src/modes/race/{index.ts,mode.ts}`, `packages/game/test/race-mode.test.ts`.

- `raceMode: Mode<RaceState, RaceInput>` with `RaceInput = { type: 'keys'; mask: number }` (4 bits;
  other bits are refused by the protocol in plan 12, and ignored here), `create`, `addPlayer`,
  `removePlayers`, `startRound` (the grid), `applyInput` (sets `keys`), `step` (one tick),
  `rejoin`, `abandon` (a car whose player left is kept, braking, to the end), `finish` (results),
  `clear`, `bots: true`. **Not registered** in `MODES` yet (plan 12), so the room and the protocol
  are untouched.
- Determinism: a seeded race with twenty cars (two human slots fed random key masks from a seeded
  PRNG, eighteen bots), run twice, is bit-identical tick by tick; and the same with the cars'
  insertion order permuted gives the same standings.
- [ ] Commit: `feat(game): wrap the race rules as a mode`.

### Task 8: Document (main session)

- [ ] The design gains "Decisions made while building plan 11" (anything that changed against §2–§5).
- [ ] README's status table: the race rules exist (not playable yet).
- [ ] Then `review-and-merge`.
