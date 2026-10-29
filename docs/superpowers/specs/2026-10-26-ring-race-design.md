# Ring race — design

Date: 2026-10-26 · Status: **approved by delegation**. The owner answered "го" to "say 'take the
recommendations' and I will go by them", so every open question of the
[ring-race proposal](2026-10-23-ring-race-proposal.md) is answered here with its recommendation, or
with a reason where this design departs from it. Answers that are mine, not his, are marked
*(decided by me)* for him to overrule.

Builds on the platform the light cycles made: rooms, host settings, bots, the clock-driven tick,
the mode interface, full/delta, the client timeline, the purity and complexity gates.

## 1. What is decided

| Question | Answer |
|---|---|
| Netcode | **Everything on the server** (the owner's call, 2026-10-25). No client prediction in this version; the latency readout measures whether one is ever needed. |
| Look | **Option A**: Kenney Racing Kit 2.0 (CC0) tiles, the Car Kit 3.1 (CC0, already downloaded) `race` car tinted per slot, CC0 PBR textures for asphalt and grass, a CC0 HDRI for light and sky. *(The Racing Kit turned out to be untextured flat colours; the textures are ours to add.)* |
| Car contact | **Cars bump** *(decided by me)*. The owner said collisions were the solved part; on the server alone, bumping costs no netcode, and everyone sees the same bump. |
| Format | **3 laps, one race per round** *(decided by me)*. The race ends when every car has finished, 30 s after the first finisher, or at a 5-minute cap; unfinished cars are ranked by how far they got. |
| Tracks | **One track in this version**, as data, no editor *(decided by me)*. The format makes a second a data file. |
| Items | **None**: a pure race *(decided by me)*. |
| Phone | **On-screen buttons**: steer left, steer right, gas, brake *(decided by me; tilt later)*. |

## 2. The track: a corridor of tiles

Measured from the Racing Kit's GLB files (not assumed):

- A tile is **1 × 1**. A straight carries asphalt across 0.155–0.845 of its width, a kerb out to
  0.082–0.918, grass to the edge.
- Corners are quarter rings centred on the corner of their block: small (1 × 1), large (2 × 2) and
  larger (3 × 3), with the centreline at radius 0.5, 1.5 and 2.5. Their asphalt spans the same
  ±0.345 around the centreline.

So every piece is the same corridor: the centreline, asphalt to **±0.345**, kerb to ±0.418, grass to
±0.5, and a **wall at ±0.5**, the tile's edge. A track is a chain of pieces, each entered where the
previous one left; neighbouring tiles share an edge, and that edge is a portal.

```ts
type Piece = { kind: 'straight'; tiles: 1 | 2 } | { kind: 'corner'; size: 1 | 2 | 3; turn: 'left' | 'right' };
interface TrackData { id: string; name: string; start: { x: number; y: number; dir: 0 | 1 | 2 | 3 }; pieces: Piece[] }
```

A **validator** (plan 5's A16) checks that the chain closes on its start pose, that no two pieces
claim a tile, that the straights before the start line (at the end of the main straight) are long
enough for the grid of `maxCars` cars — rows of two, 0.4 tile apart, plus a car's length — and that
the numbers are integers in range. A track that fails it never loads. The Ring passes with four
units to spare: a longer grid row, a bigger car or a shorter final straight will need a longer
straight there.

A car's place on the track is its piece and its `(along, lateral)` in that piece: along the
centreline and across it. A straight projects linearly; a corner by its distance from the centre
(`lateral = r − rc`). When `along` leaves `[0, length]` the car steps to the next or previous
piece — DooM_42's portal walk, O(1) per car per tick, independent of the track's length. Walls,
grass and laps all fall out of those two numbers.

## 3. The car: arcade, integer, on the server

Everything is an integer, as in the light cycles; the purity gate extends to `modes/race` and bans
`Math.sin/cos/tan/atan2/exp/pow` there.

- **Units.** Position in 1/4096 of a tile. Heading in 4096 steps of a turn, with a sine table
  (plan 5's A8). Speed in position units per tick. `Math.sqrt` (exactly rounded in IEEE 754) is
  allowed, rounded to an integer at once.
- **Tick: 30 Hz** (33⅓ ms). Plan 5 measured 900 of 900 steps at 30 Hz on real Cloudflare, with
  33 ms intervals on the server.
- **Model.** The car moves along its heading (no drift in this version). Gas accelerates to a top
  speed; brake decelerates and then reverses slowly; with neither, drag slows it. Steering turns the
  heading by a rate that grows with speed from zero and then falls off, so a parked car does not
  spin and a fast one understeers.
- **Surfaces.** On asphalt and kerb, full grip and top speed. On grass, a lower top speed and more
  drag.
- **Walls.** A car past `±(0.5 − radius)` is put back on the line. Its speed is projected onto the
  wall's tangent — plan 5's A6, with the DooM_42 slide bug fixed: the dot product is taken once, and
  the result is never longer than the input. A glancing hit loses little speed, a head-on one stops
  the car.
- **Bumps.** A car is a capsule: its axis, a segment, swept by a radius (plan 18; before it, two
  circles, front and rear, whose middle was a gap another car's nose could enter). Pairs are found through a grid of tiles (plan 5's A2): each car is
  binned by its tile, and only the same and neighbouring bins are compared. Every overlap is
  resolved from the positions before any are moved, with each car pushed half the overlap apart and
  the summed pushes applied together. The result does not depend on the order of the cars, the same
  rule the light cycles' step follows.
- **Inputs** are the state of four keys — gas, brake, left, right — as a 4-bit mask (A7): sent when
  it changes, harmless when repeated.

## 4. The race

- **Grid.** Cars are placed two abreast behind the start line, back along the centreline (across
  pieces if the grid is long), in slot order for the first race.
- **Countdown.** Cars are frozen until the round's `goAt`, as every mode's countdown already is.
- **Progress** is `lap × trackLength + pieceStart + along`. Crossing the start line forward starts
  the next lap; crossing it backward takes one away, so reversing over the line gains nothing.
- **Standings** each tick: finished cars by finish tick, then the rest by progress. The built-in
  sort over twenty (A11).
- **Finish.** A car that completes lap 3 finishes, with its tick. The race ends when every car has
  finished, 30 s after the first finisher, or at the 5-minute cap. The room needs one thing it does
  not have: **a mode that says its round is over.** `Mode` gains `over(state): boolean`, checked
  where the room already ends a deserted round. It arrives with the mode that needs it.
- **Results**: position, name, laps done, best lap, total time (or the distance short).

## 5. Bots

- A bot steers towards a point on the centreline a little ahead of it — 1.2 tiles at speed, less
  when slow — offset by a lane of its own (±0.15), so twenty bots do not drive in single file.
- It brakes for a corner coming within its braking distance whose radius calls for less than its
  speed: the target speed comes from the radius, with no transcendental functions.
- Steering compares the heading with the direction to the target by a cross product's sign and a
  dot product, never an angle.
- Each bot has a pace of its own, 88–97 % of top speed, from the seeded PRNG, so they spread out.
- Gates: a lone bot finishes three laps inside a bound; twenty bots finish a race without one
  sticking to a wall for more than two seconds; the bot's decision costs the same however long the
  track.

## 6. Room, protocol, client

- **Mode `race`**, up to 20 participants with bots, host picks it in the lobby like the others. No
  race settings in this version.
- **Wire.** `full` carries the track id, `tickMs`, and every car, in the order of the race, with
  its best lap and the tick its current lap began on (lap times survive a resync). The snapshot's
  race data carries `tickMs` too, so the results, which are in ticks, can be shown as time.
  The delta's tuples are in the order of the race as well, so the standings cost no bytes. Each tick's `delta` is one string
  for the room: per car `slot, x, y, heading, speed, lap, flags` (integers), plus events (`lap`,
  `finished`, `bump`). That is 20 × 7 numbers a tick. **Measured** over a whole race (twenty cars,
  nineteen bots, 2762 ticks): 609 bytes as JSON on average and 804 at the most, about 18 KB/s per
  player at 30 Hz, not the 0.6 KB guessed: the coordinates are five digits. A `bump` event is sent
  once, on the tick two cars begin to touch; while they stay in contact the flags' bit 3 says so. Still no binary format; A14 says to move only if a number
  forces it. The delta carries every car on the field each tick (a car moves every tick, so
  there is nothing to leave out). The protocol version is 4. A car that joined mid-race is off
  the field until the next round and is in neither the `full` nor the deltas; one that joins
  while the cars still stand on the grid (the countdown, and the instant before the first tick)
  takes the next grid spot and races, and every client is sent a new `full`.
- **Client.** The timeline the light cycles use, generalised to car states, draws the world one
  tick plus jitter behind the server. The scene builds the track from the Kenney tiles, puts PBR
  asphalt and grass on their flat colours with world-space UVs, lights it with an HDRI and soft
  shadows, and draws the cars instanced, tinted per slot. A chase camera, a HUD (lap, position,
  time, standings), the latency readout, a results screen, and a procedural engine sound.
- **Budget**, measured, not guessed: first load of the race scene ≤ 5 MB, 60 fps with 20 cars on
  the M2.

## 7. Plans

| Plan | What | Zones |
|---|---|---|
| 11 | Track format, validator and geometry; car physics; laps and standings; bots; the `race` mode and `over` | `engine` |
| 12 | The room, protocol v4 and worker for the race; the lobby can pick it | `engine`, `ui` |
| 13 | The race on screen: assets, scene, HUD, input, results, sound | `graphics`, `ui`, `qa` |

Each is prototyped where it is risky (`prototype-before-planning`), planned, built by agents,
reviewed independently, and merged, as plans 9 and 10 were.

## 8. What the visual prototype found, for plan 13

A scratch scene (React Three Fiber, the Ring built from the Kit's tiles, Poly Haven textures and sky,
twenty cars driven by the rules' prototype) ran at the display's 120 fps on the M2 with soft
shadows, from about 3.3 MB of assets. What it found:

- **The Kit's models carry an offset on their root node** (−0.35, −0.01, −0.65); centre them by
  their measured bounds, never by the mesh data.
- **The Kit's car faces +z; its tiles −z.** The owner saw the cars drive backwards; a side view with
  a heading arrow confirmed it.
- **The Kit's "Wall" corners are kerb arcs that overhang their block**, not walls on the tile edge:
  the barriers are drawn ourselves, red and white blocks along ±0.52 tile, butt-jointed (blocks that
  overlap z-fight and flicker) and with room left on curves, where straight blocks meet at an angle.
- **Bake the track into one geometry per material** (three draw calls), with UVs from world
  position: the tiles' own UVs are palette coordinates. **Bake the car per material** into
  instanced meshes, four draw calls for twenty cars; the body material takes the slot colour.
- **Interpolate between ticks.** The owner saw everything jerk. Measured: drawing cars at their last
  30 Hz tick on a 120 Hz screen left the leader standing still on 271 frames of 361; between the
  last two ticks, on none. The chase camera eases towards its place instead of sitting on the car.
- **Anisotropic filtering** on every texture: the owner saw everything blur; the road ahead is
  always seen at a grazing angle.
- Assets: asphalt `asphalt_track` and grass `leafy_grass` (colour and normal, 1K JPEG at quality
  70: 1.65 MB), sky `kloofendal_48d_partly_cloudy_puresky` (1K HDR: 1.44 MB), tiles and car
  0.24 MB. All CC0.

## 9. Not in this version

Client-side prediction; drift; items; a second track and an editor; a cup of several tracks; tilt
steering; binary snapshots.

## Decisions made while building plan 11 (2026-10-27)

- **The start is a tile-edge midpoint**, checked by the validator: the coordinate along travel a
  whole number of tiles, the other half a tile. Otherwise tile claims would floor in silence.
- **A corner continues as a straight line past its ends** for `along` *and* `lateral`, so a car
  crossing a corner's edge walks to the next piece without a jump (the radius-based lateral was four
  units off a straight line just outside the corner).
- **A car is two circles**, 0.065 tile in radius, 0.085 ahead of and behind its centre; the car
  behind in a contact goes no faster than the one in front; pushes are resolved in two passes. A
  car whose path would cross another's in an X can be left closer than two radii, because the
  circles' pushes cancel; it does not happen in races (worst overlap measured: 0.0147 tile), and
  capsules (proposal P3 of the [Real-Time Rendering study](2026-10-26-real-time-rendering-study.md))
  would remove it.
- **Gas never pulls a car's speed down.** Driving onto grass at speed, the grass drag slows it; the
  prototype's `min(top, speed + acceleration)` snapped it to the grass limit in one tick.
- **Finished and abandoned cars drive on** under the bots' autopilot at a cruising pace instead of
  stopping: twenty cars stopped across a one-tile road were a wall for the cars still racing.
- **Slots follow the public id at the start of a race**, not the order of joining, so the grid, the
  bots' pace and every tie-break are the same whatever order the room seated the players in.
- **`Mode` gained a third type parameter**, the shape of a tick's changes, because the race's laps,
  finishes and bumps are not the light cycles' cells and heads. Its constraints on the state and the
  input were loosened for the race; plan 12 tightens them again when the race joins the mode unions
  and makes the room carry either kind of changes.
- Measured: a lone bot runs three laps of the Ring in 62.0 s without touching a wall; twenty bots
  finish between 62.0 and 70.1 s, nobody is slower than 10 units for more than 3 ticks.

What plan 11's review changed:

- **A car that joins mid-race sits out** (`out`) until the next race; it was placed at the origin,
  walked back over the line and blocked the "everyone finished" end.
- **A rider who comes back finds no keys held**, and a car whose rider was absent at the start
  cruises (`abandoned`) instead of racing at a bot's pace and taking a bot's draw from the seed.
- **A bump that pushes a car back over the line counts once**: every car is walked again after the
  bumps and that crossing joins the tick's.
- **The grid follows the room's numeric order of public ids**; slots stay fixed between races, so
  the results keep their colours; **a race that is over does not step**.
- Recorded for plan 12: the `Mode` typing let the race be registered with no type error while the
  worker would have sent empty deltas.

## Decisions made while building plan 12 (2026-10-27)

- **A mistyped mode is a type error.** `Mode<S, I, C>` has its constraints back and no default for
  the changes of a tick; `ModeChanges` is the union, and the room's `stepped` event is a variant on
  `mode`, so the worker and `toDelta` must narrow before they read the changes. Plan 11's review
  had registered the race with no error while the worker would have sent empty deltas.
- **A mode can end its round** (`over`), checked where a deserted round ends.
- **Version 4**: `full` and `delta` are variants on a required `mode`. The race's `delta` takes its
  cars from the state and its events from the tick (`toDelta(state, stepped)`); its flags (finished,
  on grass, at a wall, touching a car) come from the rules (`carFlags`). Measured over a whole
  twenty-car race: 609 bytes on average, 804 at the most (an earlier figure of 856 was one tick, 20 s
  in). A contact is kept per car as a bitmask over slots, so a `bump` event comes when it begins
  and not on every tick of it.
- **What plan 13 needs on the wire** (added after plan 12's review): the cars of `full` and `delta`
  in race order; `tickMs` in the snapshot's race data; `best` and `lapStart` per car in `full`;
  `TILE`, `TURN`, `TRACKS` and the `TrackData`/`Piece` types exported from `@clicker/game`, since
  the client builds the scene from the piece list; `carFlags(state, car)` reads the state's own
  track; `onField(car)` is the one test of whether a car takes part.
- **A car that joined mid-race is in neither `full` nor `delta`** until the next race. One that
  joins before the first tick takes the next spot on the grid (`RaceState.onGrid`) and races.
- **No race on screen yet.** The host cannot pick it; a room put into race mode shows a placeholder
  while it runs and the results as a table. A whole three-lap race through the room was not tested
  in workerd — it takes a minute of real time — and its "everyone finished" end is tested on the
  rules; plan 13's end-to-end test races in a browser.

What plan 12's review changed:

- **One table of mode types** (`ModeTypes`) is the source of `ModeId`, the unions, `MODES`, the
  `stepped` event and the protocol's `setMode` list; the protocol's per-mode functions are
  exhaustive `switch`es. Registering a mode twice, swapping two, or adding one without its wire
  format is a compile error — checked by doing each once.
- **A bump is the moment contact begins**; contact itself is bit 3 of a car's flags. Before, a
  "bump" fired on nearly every tick for the cars in a pack and made up a third of each delta.
- **Names are fixed into the results at the finish**; an absent rider's car is never sent as a bot;
  a car that joins in the countdown takes the next grid spot and races.
- **For the race client**: cars on the wire are in race order (key them by slot: the order changes
  from tick to tick), the snapshot's race data carries `tickMs`, and the `full` carries each car's
  best lap and lap start. The track's piece list, `TILE` and `TURN` are exported as data.
- Measured again over a whole twenty-car race: a delta of 609 bytes on average and 804 at most,
  about 18 KB/s per player.

## Decisions made while building plan 13 (2026-10-27)

- **The client builds the track from the piece list**, exported by the rules as data with `TILE`
  and `TURN`; it never calls the rules' geometry. The barriers' centreline is computed in the scene,
  a straight or a quarter circle per piece.
- **Tone mapping is Khronos PBR Neutral**: ACES washed the sky, the barriers and the grass out
  (screenshots of both were taken); one constant in `scene/race-look.ts` switches it.
- **At the Ring's S-bend** the left one-tile corner's inner wall shrinks to a point, and the blocks
  of the neighbouring walls meet there at a right angle; they stand back by a gap of their own. The
  test that keeps barrier blocks apart found it on its first run.
- **The clock estimate is shared** between the light cycles' timeline and the race's; the race keeps
  the last sixteen ticks in a ring and draws every car between two of them.
- **The client takes the keys' bits and the lap times from the rules**: the bits are exported, and the
  wire's `lap` event carries the lap's time (null for the first crossing and a lap cut short)
  and the car's best lap after it (`best`, null while it has none), and the car flags are exported as
  `FINISHED`, `ON_GRASS`, `AT_WALL` and `TOUCHING` — an earlier version of the HUD had recomputed
  the best lap and redefined the bits, copies of rules the client must not hold.
- **The race clock rebases after a stall.** A server stall longer than the ticker's catch-up (ten
  steps) leaves the tick numbers behind the wall clock, and the estimate's old minimum then kept the
  clock early for four seconds: the render time sat clamped at the newest tick and the cars stood
  still between messages. After five arrivals in a row at which the clock was ahead of the data
  the estimate rebases on those arrivals; the render time still never goes backwards. The light
  cycles' timeline is unchanged.
- **The latency readout is left for later.** Sections 1 and 6 make "no client prediction" depend on
  a readout of how long the server takes to answer, and the race does not have one yet. The light
  cycles time a turn's echo; the race's equivalent is a key change to the speed or heading response
  that follows it, which has to be told from the car's own dynamics (acceleration, a bump, grass)
  and is a task of its own. Until it exists nobody has measured whether prediction is needed.
- **The camera follows the player's car**, or the leader when the player has none on the field.
- **Sound**: one detuned engine voice re-pitched by the player's speed, a blip a lap, a chord at the
  finish, a thud on a bump; checked to run without errors, not yet listened to by the owner.
- Measured in a real window at 1280 × 760: 120 fps (the display's cap) with twenty cars and 15 draw
  calls; the race arena renders four times in a whole race.

What plan 13's review changed:

- **Held keys survive a reconnect**: the client re-sends its mask on `welcome`, since the server
  forgets a returning rider's keys and the mask is otherwise sent only when it changes.
- **Phone buttons work in the countdown**, as the keyboard did; **a failed asset load no longer
  blanks the app** (an error boundary round the scene); **the race clock recovers from a server
  stall** longer than the ticker's catch-up (before, the cars stood still on 281 of 478 frames for
  about four seconds).
- **The client holds no copy of a rule**: the best lap arrives on the `lap` event, the flag bits
  are exported by the rules.
- **The scene's track is tested against the rules' track** — the same poses, the same tiles, road
  where the rules have road; before, the scene's tests agreed only with themselves.
- **The drawn car is no wider than it collides** (0.138 tile against 0.130; it was 0.162).
- **The end-to-end race checks that the car moves** under gas, not only that keys were sent.
- Recorded: one app test failed once while two agents ran suites at the same time, and was not
  identified; three runs alone and five by the agent were green.

## Decisions made in plan 18 (2026-10-29)

- **A car is a capsule**, the segment 0.085 tile ahead of and behind its centre swept by 0.065
  tile (RTR 22.2): two cars touch when their axes come within 0.13 tile. The two circles it replaces
  did not touch each other, and a nose entered the middle of a car undetected up to about 0.03 tile
  deep. One segment test a pair (`modes/race/capsule.ts`, Ericson 5.1.9).
- **Crossing axes push along the line between the centres** (west if they coincide), far enough
  that the axes' shadows on that line are two radii apart: an X has no closest-point direction.
- **Pushes round away from zero**, so a pair is never left short of two radii by rounding.
- **No car moves further in a tick than its radius** (top speed 218 units against 266), a tested
  invariant: no car can pass through another between ticks without a swept test.
