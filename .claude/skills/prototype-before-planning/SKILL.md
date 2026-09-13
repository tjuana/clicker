---
name: prototype-before-planning
description: Use before writing an implementation plan, pinning versions, or committing to a library, framework or build tool that has not been run in this repository yet. Also use when documentation and reality might disagree.
---

# Prototype Before Planning

## Overview

A plan full of code that was never executed is a guess with good formatting. Build the smallest real
thing in a scratch directory, run it, and write the plan from what actually happened.

**Core principle:** every command and every snippet in a plan should have been executed once before
it was written down.

## When to Use

- About to write an implementation plan containing code.
- Choosing or pinning versions of a library, framework or build tool.
- Wiring together tools that have not met in this repository before.
- The documentation is thin, or the ecosystem moves fast.

Skip it when the work is a small change inside code that already runs and is covered by tests.

## The Failures This Prevents

Three from a single day, each of which would have shipped a broken plan:

1. **The setting had moved.** The plan said to allow build scripts via `onlyBuiltDependencies` in
   `package.json`. The installed package manager ignores that key entirely — it warns that the field
   is no longer read — and the real setting lives under a different name in the workspace file.
   Without it the runtime binary is never unpacked and every server test fails with a confusing
   error. Found in ten seconds by running an install; invisible from the documentation.
2. **Two tools collided.** A test runner and a build plugin coexist happily in one package — until
   the runner picks up the browser end-to-end specs and tries to execute them inside the server
   runtime, where they explode. One line of configuration fixes it. Nothing in either tool's
   documentation mentions the other.
3. **A peer range capped a version.** The latest React was 19.3; the 3D renderer required
   `>=19 <19.3`. Pinning "latest everything" in a plan would have produced an install that refuses
   to resolve on the first task.

## Core Pattern

```bash
# 1. A scratch project outside the repository — never pollute the real one.
mkdir -p "$SCRATCH/proto" && cd "$SCRATCH/proto"

# 2. Real versions, resolved now, not remembered.
npm view <pkg> dist-tags --json
npm view <pkg>@<version> peerDependencies --json    # this is where the surprises live

# 3. The smallest thing that exercises the risky seam, then run it for real.
pnpm install && pnpm exec <the tool> && pnpm test

# 4. Only now write the plan, pasting what ran.
```

When the prototype needs the repository's own packages, link them rather than copying:
`pnpm add "@scope/pkg@link:/absolute/path"`.

## Quick Reference

| Risk | Cheapest way to falsify it |
|---|---|
| Version compatibility | `npm view <pkg> peerDependencies` before pinning anything |
| Tool A + tool B | Put both in one scratch package and run both |
| Runtime behaviour | Run it in the real runtime, not a mock |
| Config keys | Run the tool and read its warnings — they name renamed settings |
| API shape | Read the installed `.d.ts` in `node_modules`, not a blog post |

## Common Mistakes

- **Writing the plan first and verifying later.** Then the plan is what gets defended instead of the
  truth.
- **Prototyping in the real repository.** A scratch directory keeps the branch clean and lets you
  throw the whole thing away.
- **Stopping at "it compiles".** Run the tests, run the build, run the deploy in dry-run mode.
- **Copying documentation snippets verbatim into the plan.** Copy what you ran, output included.
- **Forgetting to record the surprises.** The two lines about what the documentation got wrong are
  the most valuable part of the plan.
