---
description: Run every check the project has and report the result honestly
---

Run the full verification for this repository and report what actually happened.

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm typecheck
pnpm test
pnpm --filter @clicker/app run build
```

Then report, in this order:

1. **Result per command** — lint, types, test counts per package, and whether both build outputs
   appeared (`dist/clicker/index.js` for the Worker and `dist/client/` for the assets).
2. **Anything that failed** — paste the actual error, do not summarise it away.
3. **Repository state** — current branch, whether the tree is clean, and how many commits are not
   pushed yet.

Rules:

- Never claim something passed without its output in front of you.
- A warning is not a failure, but say it out loud; wrangler's "install @types/node" notice is known
  and harmless.
- If nothing changed since the last run, say so instead of padding the report.
