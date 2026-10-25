# Clicker

Multiplayer games in the browser, for a team on a call. The host opens a room, shares the link and
picks a game; the server runs it, so every player sees the same world and the same winner. Live at
<https://clicker.vladislavrogoza.workers.dev>.

It runs on Cloudflare's free tier: a Worker serves the client, and each room lives in a Durable
Object that talks to players over WebSockets.

## How to play

1. Open the game and create a room.
2. Send the link to everyone else — the link is the invitation, and it cannot be guessed.
3. The host picks a game, and for the light cycles a speed, the walls and any bots; then presses
   Start.

**Clicker** — three seconds of countdown, ten seconds of clicking. Most clicks wins; on a tie,
whoever reached that score first.

**Light cycles** — a neon arena in the spirit of *Tron*. Each bike leaves a wall of light; ride
others into yours and stay clear of everything yourself. A / D or the arrows turn, Space boosts; a
crash puts you back in two seconds. Three-minute rounds, up to twenty riders with bots, ranked by
kills. The host can put the walls on a key: then a bike lays its wall only while W or ↑ is held,
from four seconds of energy that refill in eight, and every kill adds a second.

## Architecture

Four layers, dependencies pointing downwards only.

```
apps/game/src/client   screens, 3D scene, connection   React, react-three-fiber, zustand, partysocket
apps/game/src/worker   the room                        partyserver, Durable Objects
packages/protocol      wire format and snapshots       valibot
packages/game          game rules                      plain TypeScript, no dependencies
```

- **`packages/game`** — the rules, in two halves. `room/` owns what every game shares: players and
  bots, the host and the settings, round phases, deadlines, reconnects. `modes/clicker/` and
  `modes/cycles/` own one game each, behind one `Mode` interface. Pure throughout: time and config
  arrive as parameters and state is never mutated, so the same rules run on the server and replay
  exactly anywhere. Gates check that: a purity test bans ambient time, randomness and
  non-deterministic maths, and growth tests count the operations on the hot path.
- **`packages/protocol`** — what travels over the wire. Schemas validate everything incoming and the
  types are inferred from those same schemas. Snapshots are built here too: the secret `playerId` and
  `hostKey` never make it in.
- **`apps/game/src/worker`** — a thin adapter. It accepts messages, hands them to the rules,
  broadcasts snapshots, drives phase changes with a Durable Object alarm and persists state so a
  restart cannot lose the room. A living mode is stepped by a clock-driven tick: the timer only wakes
  the room, the elapsed time decides how many steps are owed, and each step goes to everyone as one
  `delta`; a joiner gets the whole round as `full`.
- **`apps/game/src/client`** — screens and the scenes. It knows no rules: it sends intents and draws
  whatever the server sent. For the light cycles it keeps the round from `full` and `delta` and draws
  it a tick behind, between two server steps, so motion is smooth.

The client and the Worker are built into one application by `@cloudflare/vite-plugin` and ship as a
single deploy.

### One base, many games

A game is a directory under `packages/game/src/modes/` behind the `Mode` interface — derived from
the clicker and the light cycles once both existed — plus its schemas in `packages/protocol` and its
screens on the client. It does not touch the room, the message envelope or the lobby. Input travels
as a generic `input` command only the mode interprets, and a protocol version (now 3) tells an old
tab to reload instead of letting it misread a message in silence.

What comes next is in [docs/superpowers/specs](docs/superpowers/specs/): proposals for a textured
ring race and for the light cycles' visual upgrade.

### Rooms and access

There are no shared secrets. A room link carries a random 128-bit id and is itself the invitation.
Host rights come from a separate key that lives in the creator's browser and never appears in the
address bar — on a standup the screen is shared with everyone.

## Commands

```bash
pnpm install                              # setup (needs Node 22 and corepack)
pnpm --filter @clicker/app dev            # develop: client and Worker in one server
pnpm test                                 # every test
pnpm typecheck                            # types
pnpm check                                # linter and formatter
pnpm format                               # apply formatting
pnpm --filter @clicker/app run build      # build
pnpm --filter @clicker/app run e2e        # end-to-end tests in a browser
pnpm --filter @clicker/app run deploy     # build and publish to Cloudflare
```

## Status

| Part | State |
|---|---|
| Game rules (`packages/game`) | clicker and light cycles, 261 tests |
| Wire format (`packages/protocol`) | version 3, 87 tests |
| Room server and client (`apps/game`) | 219 tests, including integration tests in the Workers runtime |
| End to end | a clicker round, a light-cycle round against bots, and walls on a key, desktop and phone |
| Deploy | every push to `main`, through Cloudflare Workers Builds |

The designs are the [specs](docs/superpowers/specs/),
the work itself in the [plans](docs/superpowers/plans/), and the rules for working on the code in
[CLAUDE.md](CLAUDE.md).
