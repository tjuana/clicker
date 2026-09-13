# Clicker — how we work on this project

A realtime multiplayer browser game on Cloudflare Workers. Personal project, free tier, no corporate
data of any kind.

The design is the source of truth: [spec](docs/superpowers/specs/2026-09-11-clicker-foundation-design.md).
Work in progress lives in [docs/superpowers/plans/](docs/superpowers/plans/). What the project is:
[README.md](README.md).

## Architecture

Four layers. Dependencies point downwards only — no layer knows anything about the ones above it.

```
apps/game/src/client   screens and the 3D scene    knows about the DOM and three.js
apps/game/src/worker   the room, a Durable Object  knows about Cloudflare and WebSockets
packages/protocol      wire format                 knows about neither server nor browser
packages/game          game rules                  knows about nothing at all
```

Hard rules:

- **`packages/game` is pure.** No I/O, no `Date.now()`, no `Math.random()`, no globals. Time and
  config arrive as parameters. State is never mutated: `apply` returns a new one.
- **The server is a thin adapter.** It turns messages into commands, hands them to the rules and
  broadcasts snapshots. No game logic belongs there.
- **The client knows no rules.** It sends intents and draws what the server sent. The server is the
  only authority on score and phase.
- **Secrets never cross the boundary.** `playerId` and `hostKey` stay server-side; clients only ever
  see public ids.

## Writing code

- **Less code.** The best version is the one with nothing left to remove. Do not add abstractions for
  an imagined future: the game-mode interface arrives with the second game mode, not before.
- **Data structures fit the job.** Lookup by key is an object or a `Map`, never a scan over an array.
  Membership is a `Set`. An array is for order. If a structure forces nested loops, it is the wrong
  structure.
- **Count the hot path.** A round is up to 15 clicks per second per player plus a snapshot broadcast
  ten times a second. On that path: no storage write per message, no snapshot built separately for
  each connection, no copying collections without reason.
- **Optimise from a measurement, not a feeling.** Clear code first, then measure, then change. Comment
  every such spot: say why it is not the obvious version.
- **Comments explain why.** What the code does is visible in the code.

## Tests

- Test first: red, green, clean up.
- Assert behaviour, not structure. A test that breaks when a field is renamed is a bad test.
- Rules get fast unit tests, the server gets integration tests in the real Workers runtime, the whole
  game gets an end-to-end test in two browsers.
- A flaky test is worse than no test: never reproduce a race with timers — remove the race instead.

## Before claiming anything is done

```bash
pnpm check      # linter and formatter
pnpm typecheck  # types
pnpm test       # every test
```

For anything visual that is not enough: take a screenshot from a real browser and look at it. The
first version of the 3D scene passed every check and still looked broken.

## Commits

Conventional Commits, English, one logical change per commit. **No Claude attribution:** no
`Co-Authored-By`, no "Generated with…", no robot emoji.

## The team

Work is done by specialised agents, defined in [.claude/agents/](.claude/agents/). What makes them
worth having is not the job titles — it is the boundaries: each one owns a zone and is forbidden
from the others. That is what keeps the layers above from eroding.

| Agent | Owns | Must not touch |
|---|---|---|
| `engine` | rules, wire format, the room server | anything in `src/client` |
| `ui` | screens, HUD, input, texts | `packages/**`, `src/worker` |
| `qa` | tests at every level | production code — it reports defects, it does not fix them |

Three more roles — graphics, game design, devops — get their own agents when there is steady work
for them: a real scene to build, a second mode to balance, a deploy that has become routine. An
agent with nothing to own is overhead.

Shared rituals live as skills in [.claude/skills/](.claude/skills/), so they travel with the
repository and every agent has them:

- **`verify-visually`** — a green suite says nothing about how something looks. Screenshot it and
  look at the picture before calling visual work done.
- **`prototype-before-planning`** — run the risky seam in a scratch project before writing a plan
  about it. Every command in a plan should have been executed once already.

A skill is written only after something has actually gone wrong that way; a procedure invented in
advance teaches the wrong lesson. Repeatable chores live as commands in
[.claude/commands/](.claude/commands/) — `/checks` runs the whole verification and reports it
honestly.

## Documentation

- Behaviour changed? Update the spec in the same pass.
- Layout or commands changed? Update the README.
- Plans are only edited against reality: when reality and the plan disagree, reality wins and the
  divergence is recorded in the plan as its own commit.
