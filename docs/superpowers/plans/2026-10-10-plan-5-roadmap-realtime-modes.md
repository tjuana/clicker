# Roadmap: live modes — the arena, then the ring race (plan 5)

> This is a **roadmap**, not a step-by-step plan. Before work starts, each stage below is expanded
> into its own plan in the format of plans 1–4 (TDD, tasks, commands). Risky seams are run first as
> a prototype — the `prototype-before-planning` skill.

**Goal:** turn the clicker into a platform for games where the world lives on its own: a grid arena
as mode no. 2, then a ring race driven from the keyboard.

**Why this order:** the race needs a server tick, a mode interface, client-side prediction,
collisions and lap counting. The arena needs the same, except the physics, and its logic is
two-dimensional and integer. So the netcode and the ticks are proven on the simple mode, and the
race lands on a tested foundation instead of being the first experiment with everything at once.

---

## 1. The stack: we keep three.js

### What we choose by

1. **One TypeScript for server and client.** The rules live in `packages/game`, and the client has
   to run the same ones to predict its own car. An engine in another language breaks this: the
   rules would have to be written twice and kept bit-for-bit identical.
2. **Open a link — play.** The first load matters more than a rich engine.
3. **The physics is ours, not the engine's.** The authoritative simulation runs on the server, in
   pure functions. We do not need the engine's built-in physics on the client: it is not
   authoritative.
4. **The React shell** for screens, the lobby and the HUD already exists and works.

### Options

| Option | Pros | Why not this one |
|---|---|---|
| **three.js + R3F** (now) | TS; the largest ecosystem; it is a rendering library, with no foreign physics or game loop; `WebGPURenderer` with a fallback to WebGL | — |
| Babylon.js | A full engine in TS: inspector, Havok, mature WebGPU | A bigger bundle; its client-side physics is not authoritative, so it would go unused; a weaker fit with React |
| PlayCanvas | A compact runtime, good on mobile, has a cloud editor | A smaller ecosystem; its strong side is the editor, and we do not need one yet |
| Godot / Unity (WASM) | Real editors and a content pipeline | The client simulation is not in TS — the rules are not shared with the server; a load of tens of MB against "open a link" |
| Bevy + workers-rs | Rust on both sides, shared code is possible | Rewrite everything, the server included; a heavy build for a benefit we do not have yet |

### Verdict

**The stack was chosen correctly.** The problems visible now are in how it is used, not in the
library:

- 20 clones of the model instead of an `InstancedMesh` — that is 20 sets of draw calls instead of
  one;
- `drei` is pulled in for a single `useGLTF`;
- the scene chunk weighs 969 KB (258 KB gzip) and is not split.

**When to revisit:** we need a level editor (look at our own first — DooM_42 already had one), we
hit a performance limit on mobile that a measurement confirms, or there is so much content that we
need an asset pipeline.

---

## 2. What we take from the old projects

All three projects were read in full: [DooM_42](https://github.com/tjuana/DooM_42) — a portal
engine over sectors with a map editor, about 9,700 lines of C; [wolf3d](https://github.com/tjuana/wolf3d) —
a raycaster on a grid, about 1,850 lines of C; [RTv1](https://github.com/tjuana/RTv1) — a ray
tracer with a scene loaded from a file, about 3,650 lines of C.

### What we carry over

| Technique | Where in the old code | Where it goes here |
|---|---|---|
| Sectors and portals: the map is a graph of convex sectors, shared edges are portals | DooM `neighbors[i]`, BFS traversal | The race track is a ring of sectors |
| Collisions only with the walls of the current sector; crossing a portal changes the sector | DooM `game_motion_*.c` | The race server: O(walls of the sector) instead of O(the whole track) |
| The sign of the cross product: which side of a line a point is on | DooM `ft_math_pointside` | Checkpoints, the finish, convexity |
| The movement segment per tick against a line | DooM `intersectbox` + `pointside` | Lap counting: do not skip over a line between ticks |
| Projecting velocity onto a wall | DooM `ft_game_motion_slide` | Barriers: sliding instead of stopping (**with a fix**, see below) |
| A sentinel in the vertex array: the first vertex is duplicated at the end | DooM `vertex[i + 1]` | Sector polygons — no `%` in the loop |
| A flat grid `map[x + y * width]` | wolf3d `map.map` | The arena is a `Uint8Array`, row by row, cache-friendly |
| DDA — walking the cells along a ray | wolf3d `ray_casting.c` | The arena: a move of several cells per tick without teleporting through a wall; visibility rays |
| Checking each axis separately — sliding along the grid comes free | wolf3d `move.c` | Movement in the arena |
| Sorting by squared distance, no `sqrt`; an array of indices is sorted | wolf3d `ft_sort` (comb sort) | Draw order, nearest opponent |
| A fixed-size ring buffer | DooM `cycle.queue` | The input buffer and the snapshot history on the client |
| Packing into bits, flags, XOR to toggle | DooM `func_color.c`, `gui_elem_set_status.c` | The input mask, state flags |
| Ray–sphere intersection (a quadratic equation) and ray–plane | RTv1 `render_redraw.c` | Picking up bonuses, hits, visibility — on the server |
| The inverse of a rotation matrix is its transpose: cheap and exact | RTv1 `ft_oppositive_matrix` | Moving into the car's coordinate system without a general matrix inversion |
| The scene is described by data in a file, not by code | RTv1 `scenes/`, the parser | Tracks and arenas are data files **with a validator** (see A16) |

### What we do not carry over, on purpose

- **`x >> 1` instead of `/ 2`** and Bresenham-style pixel interpolators (DooM `scr_nxt`) — the
  compiler and the GPU do this. In JS, `>>` also truncates the number to int32.
- **pthreads over screen columns** (wolf3d) — our axis of parallelism is different: each room is
  its own Durable Object, its own thread. We scale by rooms, not by threads inside a room.
- **One structure for everything** (`t_new_player` in DooM holds the rendering, the physics and the
  map) — which is exactly why the physics cannot be moved to a server or tested there without a
  window. Here the physics is pure functions in `packages/game`, and the renderer only draws.

### Bugs found while reading

Recorded because each one is a ready-made test.

1. **Wall sliding is computed wrongly** (DooM `ft_game_motion_slide`). `velo.x` is overwritten and
   then used to compute `velo.y`, so the dot product for `y` already takes the new `x`. As a
   result the vector is not parallel to the wall, and a player moving at an angle is slowed or
   pushed off course. The same bug is in the Bisqwit source this scheme was taken from.
   **Fix:** compute `dot` once. **Property test:** the result is parallel to the wall and no longer
   than the original vector.
2. **`malloc` and a zeroing loop on every frame** (DooM `ft_game_engine_preset`, `rend_sec`). The
   right way is to allocate once when the map loads and do a `memset` in the frame. The JS
   analogue is `new Vector3()` inside `useFrame`: garbage every frame and garbage-collector
   pauses.
3. **A bit leaks between colour channels** (wolf3d `floor.c`: `(color >> 2) & 0x7F7F7F`). After the
   shift by 2, the low bits of red land in the high bits of green, and the `0x7F` mask keeps one of
   them. Dividing each channel by 4 needs `0x3F3F3F`. The lesson: derive the mask from the shift,
   do not pick it by eye.
4. **The first hit instead of the nearest** (RTv1 `render_get_pixel_color`). The loop returns the
   colour of the first object in the list with `t > 0`, not of the object with the smallest `t`.
   What ends up in front is decided by the order of lines in the scene file, not by the geometry.
   **The lesson:** "nearest" is a minimum over all candidates (A15). **Test:** reorder the objects
   in the list — the result does not change.
5. **The normal and the light are not computed from the hit point** (RTv1). The normal is
   `hit + (0, 0, −1)`, but it should be `(hit − center) / r`; the vector to the light is taken from
   the camera, not from the surface point. The lighting is correct only for a sphere in one
   particular position. Besides, the plane and the sphere are traced from different ray origins
   (`(0, 0, −10)` against `(0, 0, 0)`). **The lesson:** every formula gets a test on an object that
   is not at the origin.
6. **Leaks and non-invariant work in the pixel loop** (RTv1). Every redraw allocates `orig` and
   never frees it; the arrays from `ft_strsplit` are not freed (the code says so itself —
   `need to delete array`). The camera constants through `pow` and `sqrt` are recomputed for every
   pixel, although they do not depend on the pixel. The scene objects are stored in a linked list,
   and the hot loop walks pointers. **The lesson:** hoist invariants out of the loop; in a hot
   loop, use an array.
7. **A parser with no checks** (RTv1 `render_set.c`). Coordinates are read through `ft_atoi` —
   integers only; the string `"1,2"` gives `array[2] == NULL` and a crash; the colour is divided
   by 256 instead of 255, so white is never 1.0. **The lesson:** any map file is outside input and
   is validated (A16).

---

## 3. Algorithms and data structures

Each item has a place, an estimate and a **gate** — a test that fails on a violation (see the
memory note "rules are enforced by gates, not paragraphs").

| # | What | Where | Complexity | Gate |
|---|---|---|---|---|
| A1 | `Map`/`Set` for lookup and membership; `Record` only for serializable state | everywhere | O(1) | `complexity.ts` for every new hot-path function |
| A2 | **Spatial hash grid** for the broadphase: the cell key is packed into one number `(cx & 0xFFFF) \| (cy << 16)` — unique while both coordinates are in int16 (±32,767 cells); for a **bounded** field no hash is needed at all, the index is `y * width + x` (like the wolf3d map); the grid is rebuilt every tick by counting (`cellStart`/`cellCount` in an `Int32Array`), with no allocations | car collisions | O(n) on average instead of O(n²) | growth of ×10 on a tenfold input |
| A3 | DDA over cells | arena, rays | O(cells traversed) | property: the path is continuous, no cell is skipped |
| A4 | Sectors and portals, finding the sector by a step from the previous one | track | amortized O(1) | growth does not depend on the track length |
| A5 | Segment intersection, the sign of the cross product | laps, checkpoints | O(1) | properties: symmetry, touching at an endpoint, degenerate segments |
| A6 | Projection onto a wall (fixed) | barriers | O(1) | property: parallel to the wall, `\|v'\| ≤ \|v\|` |
| A7 | **Input is an intent, not a position.** Race: a throttle/brake/left/right/nitro mask — 5 bits in a byte, we send the *state of the held keys*, a repeat is harmless. Tron: a turn is an **event**, so it carries the tick number it was meant for (see section 5, "backdating") | protocol | O(1) | protocol version; test: unknown bits are rejected |
| A8 | **Integer angles**: 1024 directions, wrap-around with `& 1023`, sines from a table. `+ − × ÷` and `sqrt` are deterministic in IEEE, but `Math.sin`/`cos`/`atan2` are not required to match bit for bit across engines | simulation | O(1) | the purity scan forbids `Math.sin\|cos\|tan\|atan2\|exp\|pow` in the simulation module |
| A9 | **Seeded PRNG** (mulberry32/xorshift — on bit operations) inside `modeState` | spawn points, bonuses | O(1) | already in place: `Math.random` is forbidden in `packages/game` |
| A10 | Ring buffer, the size a power of two, index `seq & (N - 1)` | client: inputs, snapshots | O(1), zero allocations | a wrap-around test on overflow |
| A11 | **The standings table every tick — the built-in `sort`.** In V8 this is TimSort: stable (ES2019 requires it), adaptive — close to O(n) on nearly sorted input, and it sorts short runs with binary insertion. A hand-written insertion sort would give the same, with more code. What is valuable in wolf3d `ft_sort` is not the comb sort but **sorting indices** instead of objects. For "top 10 out of many" — a heap of k elements, O(n log k) | race, leaderboard | O(n log n), ≈ O(n) on nearly sorted input | growth on nearly sorted input |
| A12 | Structure of Arrays on `Float32Array`; `fill` is our `memset`; no `new` in `useFrame` | particles, trails | — | review; a frame measurement |
| A13 | `InstancedMesh` — one model for all cars | scene | 1 draw call instead of n | fps measured before/after on 20 cars |
| A14 | Binary snapshots (`DataView`, positions in `Int16`), a delta from the last acknowledged one | protocol | — | **only after measuring traffic**: for 20 cars JSON is not the bottleneck yet |
| A15 | **Nearest hit** — the minimum `t` over the candidates; the candidates come from the hash grid (A2) or DDA (A3), not from all objects | rays, hits | O(candidates) | property: reordering the objects does not change the result; growth in the number of objects |
| A16 | **Map validator**: the contours are closed, the sectors are convex (the cross-product signs are equal), the portals are symmetric (`a` refers to `b` ⇔ `b` to `a`), the numbers are finite | loading tracks and arenas | O(vertices) | a test for each violation; broken maps in the fixtures |

**The hot loop:** invariants hoisted out, `x * x` instead of `pow(x, 2)`, data in an array rather
than a linked list (the RTv1 lessons).

**Bit quirks in JS:** bit operations coerce a number to int32. So there are at most 32 flags in one
number, an unsigned result needs `>>> 0`, and for more flags use `BigInt` or several words.

---

## 4. Stages

### Stage 0. Put what exists in order
- ~~Push the local commits and make sure CI is green~~ — done: the run on `ad64213` passed, the
  `corepack` order fix is confirmed on GitHub.
- A layer-boundary gate: imports only point down — `packages/game` → nothing, `packages/protocol`
  → nothing, `worker` → not `client`, `client` → not `worker`.
- A bundle budget in CI: the current size plus headroom; growth only by a deliberate commit.

### Stage 1. `packages/game/src/geometry` — pure 2D maths
Vectors, the cross product, segment intersection, the side of a line, the fixed projection, a
point in a convex polygon, a ray against a sphere and a plane with the nearest hit (A15), integer
angles with a sine table (A5, A6, A8), the PRNG (A9), the map validator (A16). Property tests —
this needs a property-based testing library (`fast-check`); that decision is taken in the stage's
plan. Extend the purity scan to transcendental functions.

### Stage 2. The server tick — prototype run (2026-10-10)

The prototype: a Durable Object on partyserver 0.5.10 in a local workerd (wrangler 4.131.1), 20
bikes on a 128×128 field, an immutable step with a copy of the field, deltas in JSON, 20 sockets,
20 seconds per rate.

| Rate | Steps / expected | Timer wake-ups | Gap at the clients p50 / p99 / max, ms | Delta, B/step | Traffic per player | Out of the room |
|---|---|---|---|---|---|---|
| 15 Hz | 300 / 300 | 295 | 68 / 73 / 76 | 215 | 3.2 KB/s | 63 KB/s |
| 20 Hz | 400 / 400 | 379 | 52 / 80 / **190** | 234 | 4.6 KB/s | 91 KB/s |
| 30 Hz | 600 / 600 | 573 | 35 / 40 / 46 | 252 | 7.4 KB/s | 147 KB/s |

The cost of a step (Node, after warm-up): 4 bikes — 3.9 µs, 20 — 12.4 µs, 50 — 30.9 µs; it grows
linearly. Copying a 128×128 `Uint16Array` field takes **2.3 µs**: immutability is almost free
here, and a rollback during prediction turns into keeping an old reference. 20 bikes at 30 Hz cost
0.37 ms of CPU per second.

What was found:
1. **`setInterval` in a DO is systematically late by 1–2 ms per period.** If you do one step per
   wake-up, 2–5% of the ticks are lost (295 wake-ups instead of 300, 573 instead of 600), and the
   game slowly slows down. An accumulator `while (now >= next) step()` gave **exactly the expected
   number of steps** at every rate. So the accumulator is mandatory, and the timer only wakes it.
2. **There are pauses of up to ~190 ms** (one in 20 s at 20 Hz). The accumulator catches them up,
   but the client receives deltas in bursts. Hence: the client draws other players with an
   interpolation buffer, not "as it arrives".
3. **Time in Workers is frozen during computation**, so the CPU cannot be measured from the
   inside — only from the outside, as done above.
4. There are no gaps: a WebSocket is ordered and reliable, and the tick number in the delta runs
   consecutively for all 20 clients.

**Checked on real Cloudflare** (a temporary preview account, `wrangler deploy --temporary` —
no sign-in and no traces in the working account, it expires on its own; 20 sockets over `wss://`,
30 seconds):

| Rate | Steps / expected | Wake-ups | Server interval p50 / max | Gap at the clients p99 / max | Traffic per player |
|---|---|---|---|---|---|
| 20 Hz | 600 / 600 | 600 | 50 / 50 ms | 57 / 180 ms | 4.9 KB/s |
| 30 Hz | 900 / 900 | 910 | 33 / 33 ms | 54 / 100 ms | 7.7 KB/s |

5. **The timer lateness is a quirk of the local workerd.** In production the timer is accurate to
   the millisecond. The accumulator is still mandatory: at 30 Hz the timer sometimes wakes up
   **early** (910 wake-ups for 900 steps), and such a wake-up must not make a step. The
   accumulator covers both directions.
6. **Pauses of up to 180 ms at the client in production are the network, not the server**: on the
   server the intervals are even. A 100 ms interpolation buffer covers p99, and the client catches
   up the rare tails smoothly.

### Stage 3. The mode interface and the arena (mode no. 2)
The mode interface is derived from two implementations, the clicker and the arena, as CLAUDE.md
prescribes. The "Light cycles" arena (section 6): a `Uint8Array` grid (A3), turns as events with a
tick number (A7), rubber and bounded backdating (section 5), trails broadcast as deltas, a
deterministic tick-based simulation, elimination. A neon look, a procedural soundtrack. A replay
test: the same inputs → the same state, bit for bit.

### Stage 4. The client netcode — **prototype first**
Prediction of the player's own entity with the same functions from `packages/game`, an input
buffer (A10), reconciliation with the server and rollback, interpolation of the others from the
snapshot history. The goal is no jerking at a 100 ms ping. It is checked by eye on a screen
recording, not only by tests.

### Stage 5. The ring race
The track is a ring of sectors (A4), an arcade car model on integer angles (A8), barriers (A6),
laps through segment intersection (A5), car collisions through a hash grid (A2), the standings
table by the built-in sort (A11), the scene on an `InstancedMesh` (A13). A track editor — on the
experience of the DooM_42 editor, but as a separate stage and only if editing tracks by hand
becomes the bottleneck.

---

## 5. Other people's projects: what we take and what we avoid

| Project | The strong decision | The bug or limitation | The conclusion for us |
|---|---|---|---|
| [Armagetron Advanced](https://wiki.armagetronad.org/index.php/Rubber) — an open-source Tron bike game, with a [browser port](https://github.com/escapedcat/armagetronad-web) | **"Rubber"**: next to a wall the bike slows its approach and spends a reserve of rubber, zero is death; the reserve refills away from walls (`CYCLE_RUBBER`, `CYCLE_RUBBER_TIME`). Network latency is turned into a game mechanic. **Backdating**: the server applies a late command at the moment it was issued, while the client has a "latency credit" | [Bug #321694](https://bugs.launchpad.net/armagetronad/+bug/321694): one server hiccup inflated the client's time correction far beyond the real latency; fixed by capping the correction | Rubber and backdating of turns go into Tron from day one. The latency credit and the correction are **capped from above** |
| [Rune / Dusk](https://github.com/rune/rune) — an SDK for browser multiplayer games in JS | The same deterministic logic on the clients and the server, predict-rollback, the server is authoritative. [Send the intent, not the position](https://developers.rune.ai/blog/top-down-synchronization): on a conflict the outcome changes, the picture does not jump. Logic at 30 Hz, no more than 10 actions per second from a client. Non-deterministic functions are forbidden by a linter | The hosting and the server side are closed: the SDK is open, the network core is not | Our purity scan is the same approach as their linter. A 30 Hz tick and a cap on the input rate are a reference point for stage 2 |
| [Colyseus](https://docs.colyseus.io/) — a room framework on Node.js | A new player gets the full state, then only deltas. A queue of changes per property, "last value wins". Binary patches every 50 ms | The state is mutable classes with serialization decorators: the rules are coupled to the wire format. No client-side prediction out of the box | **A bike's trail grows every tick** — broadcasting it whole 10 times a second is not possible: that is O(players × trail length) for every snapshot. A full snapshot on joining, then only the new cells |
| boardgame.io | Moves are pure functions over the state, phases, secrets through `playerView` | Turn-based games only | Confirms our scheme: pure rules, phases, private messages |
| Croquet / Multisynq | Replicated deterministic computation: the server only orders the events | No authoritative server — no protection against cheating | Not for us: a player with the console open must not decide the outcome |
| Glenn Fiedler, *Fix Your Timestep!*; Valve, the Source netcode | The simulation step is fixed, the timer only catches up the accumulator: `while (now >= next) step()`. Other entities are drawn with an interpolation delay (~100 ms) | — | The DO tick does not trust the accuracy of `setInterval`: time is taken from `now`, as `advance` already does |

## 6. The "Light cycles" mode (Tron)

Decided: the next mode is bikes that leave a trail; crash and you are out. The style is a neon grid
in the spirit of *Tron: Legacy*: menu, HUD, leaderboard, music.

- **Music and name.** The Daft Punk soundtrack and the name Tron belong to Disney: a public game
  cannot use them even on the free tier. A style is not protected. The music is our own synthwave:
  either CC0/CC-BY tracks or a **procedural soundtrack on WebAudio** (a sawtooth arpeggio through
  a filter, 120 BPM), which weighs kilobytes and can speed up towards the end of a round. The
  name of the mode is our own.
- **A grid or continuous space?** Armagetron stores trails as segments in continuous space with
  90° turns. We use a grid (`Uint8Array`, A3): simpler, deterministic with integers, and the
  collision check is an O(1) cell read. Smoothness comes from interpolation when drawing. To be
  settled in the mode's spec.

## 7. Bots

Needed from day one: without them the mode cannot be tested alone, and a small company has nobody
to play with.

- **Bots are part of the rules**, not a separate client: a pure function
  `decide(state, botId) → turn` inside `packages/game`, with randomness from the state's seeded
  PRNG. Then a bot is deterministic, reproducible in tests and free over the network.
- **The classic Tron AI is a flood fill**: for "straight", "left", "right" count how many cells
  are reachable (BFS) and pick the option with the most space. A full BFS is O(cells) per option,
  that is 20 bots × 3 × 16,384 cells on every tick. So the fill is **limited by a cell budget** and
  runs only when an obstacle is closer than a threshold. Gate: the cost of a bot's decision does
  not grow with the size of the field.
- Difficulty levels are the fill budget and the share of random mistakes.
- The host adds and removes bots with a button in the lobby. Bots take seats like players.

## 8. Open questions

1. ~~The arena: Tron or snakes~~ — decided: Tron, section 6.
2. ~~The tick rate~~ — measured in stage 2: all three rates fit with room to spare; the choice is
   made in the mode's spec.
3. **`fast-check`** as a new dependency for property tests — yes, or our own generators.
