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
- **Bumps.** A car is two circles, front and rear (one circle let cars drive into each other's noses
  and tails; see plan 11). Pairs are found through a grid of tiles (plan 5's A2): each car is
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
- **Wire.** `full` carries the track id, `tickMs`, and every car. Each tick's `delta` is one string
  for the room: per car `slot, x, y, heading, speed, lap, flags` (integers), plus events (`lap`,
  `finished`, `bump`). That is about 20 × 7 small numbers a tick, roughly 0.6 KB, 18 KB/s per
  player at 30 Hz, measured before any binary format is considered (A14). The protocol version
  goes to 4.
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
