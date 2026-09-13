# Clicker

A multiplayer click race in the browser. The host opens a room and shares the link, everyone hammers
one button for ten seconds, and whoever lands the most clicks wins. The server does the counting, so
every player sees the same score and the same winner.

It runs on Cloudflare's free tier: a Worker serves the client, and each room lives in a Durable
Object that talks to players over WebSockets.

## How to play

1. Open the game and create a room.
2. Send the link to everyone else — the link is the invitation, and it cannot be guessed.
3. The host presses Start: three seconds of countdown, then a ten second round.
4. Most clicks wins. On a tie, whoever reached that score first.

## Architecture

Four layers, dependencies pointing downwards only.

```
apps/game/src/client   screens, 3D scene, connection   React, react-three-fiber, zustand, partysocket
apps/game/src/worker   the room                        partyserver, Durable Objects
packages/protocol      wire format and snapshots       valibot
packages/game          game rules                      plain TypeScript, no dependencies
```

- **`packages/game`** — room state and every rule: round phases, click counting with a rate limit,
  tie-breaks, the winner. Pure functions: time and config arrive as parameters and state is never
  mutated, so the rules are covered by ordinary unit tests that run in milliseconds.
- **`packages/protocol`** — what travels over the wire. Schemas validate everything incoming and the
  types are inferred from those same schemas. Snapshots are built here too: the secret `playerId` and
  `hostKey` never make it in.
- **`apps/game/src/worker`** — a thin adapter. It accepts messages, hands them to the rules,
  broadcasts snapshots ten times a second, drives phase changes with a Durable Object alarm and
  persists state so a restart cannot lose the room.
- **`apps/game/src/client`** — screens and the scene. It knows no rules: it sends intents and draws
  whatever the server sent.

The client and the Worker are built into one application by `@cloudflare/vite-plugin` and ship as a
single deploy.

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
| Game rules (`packages/game`) | done, 60 tests |
| Wire format (`packages/protocol`) | done, 31 tests |
| Room server (`apps/game/src/worker`) | done, 15 integration tests in the Workers runtime |
| Client, 3D scene, end-to-end tests, deploy | in progress |

The full design is in the [spec](docs/superpowers/specs/2026-09-11-clicker-foundation-design.md),
the work itself in the [plans](docs/superpowers/plans/), and the rules for working on the code in
[CLAUDE.md](CLAUDE.md).
