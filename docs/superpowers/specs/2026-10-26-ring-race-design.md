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
claim a tile, that the first piece is a straight long enough for the start line, and that the
numbers are integers in range. A track that fails it never loads.

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
- **Bumps.** Cars are circles. Pairs are found through a grid of tiles (plan 5's A2): each car is
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

## 8. Not in this version

Client-side prediction; drift; items; a second track and an editor; a cup of several tracks; tilt
steering; binary snapshots.
