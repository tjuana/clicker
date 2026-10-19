---
name: review-and-merge
description: Use when a plan's branch is complete and its checks pass, before it goes into main. Also use when about to merge, push or open a PR for finished work.
---

# Review and Merge

## Overview

The implementer — a subagent working from a plan — checks the code against the plan. Nobody checks
the plan against reality, and nobody reads the result with fresh eyes. An independent review is that
second reader; the merge commit is the record of what changed and why.

**Core principle:** nothing reaches `main` unreviewed, and no review finding is acted on unverified.

## The Failure This Prevents

Plan 6 (the light-cycle rules) was merged straight into `main` the moment its tests were green. The
tests had been mutation-checked and the code matched the plan byte for byte — and it still went in
without anyone reading it as a whole, looking for the bugs the plan itself contained. Green checks
and faithful execution are not a review.

## When to Use

- A plan's tasks are all committed on their branch.
- Any time you are about to merge a branch, push, or open a PR.

Not needed for a one-line documentation fix committed directly with the owner's go-ahead.

## Procedure

### 1. Checks first

```bash
pnpm format && pnpm check && pnpm typecheck && pnpm test
```

A red branch is not reviewed — it is fixed.

### 2. Independent review

Dispatch a **read-only** reviewer subagent with `model: opus`; never the agent that wrote the code.
Give it:

- the diff range (`git diff main...HEAD`) and the paths it covers;
- the spec and the plan, and which sections matter;
- `CLAUDE.md`, and the rules most at risk in this change;
- what to hunt for, in priority order: correctness with concrete counterexamples, determinism,
  immutability, complexity on the hot path, test quality, problems the next plan will trip over;
- what to skip: style, naming, anything Biome catches, issues the plan already lists as known;
- the report format: findings most severe first, each with file and line, the defect in one
  sentence, a concrete failure scenario, whether it was confirmed by running code, a suggested fix;
- a hard rule: leave `git status` clean — any throwaway test it writes is deleted.

### 3. Verify every finding

A reviewer's finding is a claim, not a fact. For each one:

- **Reproduce it** — a failing test that encodes the failure scenario. If no test can be made to
  fail, the finding is rejected; say why.
- Classify: **confirmed** (a test fails), **plausible** (real risk, not reproducible — record it),
  **rejected** (wrong, with the reason).

### 4. Fix on the branch

One commit per confirmed finding, each with the failing test from step 3 and the fix. Implementation
can go to a `model: sonnet` subagent with the failing test as its target; verify its result yourself.
Re-run step 1.

A finding that needs a design change, not a fix, goes to the owner instead of into the branch.

### 5. Merge with a description

```bash
git checkout main
git merge --no-ff <branch> -m "<type>(<scope>): <what the branch delivers>" -m "<body>"
pnpm test                      # on the merged result
git branch -d <branch>
```

The body says, in English:

- what the branch delivers and why, in two or three sentences;
- what the review found, and what happened to each finding — fixed, recorded, rejected and why;
- what is known and left for later;
- how it was verified: test counts per package, mutations caught.

Conventional Commits, no attribution lines of any kind.

### 6. Do not push on your own

A push to `main` deploys to production. Merging into local `main` is part of this skill; pushing is
the owner's call — report that the branch is merged and waiting.

If `gh` is installed and authenticated, open a PR instead of merging locally, with the step 5 body
as its description, and merge after CI is green.

## Common Mistakes

| Mistake | Instead |
|---|---|
| The implementer reviews its own work | A fresh reviewer that never saw the plan's code being written |
| Applying every finding | Reproduce first; a reviewer is wrong often enough to matter |
| A fix without a test | The failing test from step 3 is part of the fix commit |
| Fast-forward merge | `--no-ff`: the merge commit is where the description lives |
| "Merged" in chat, nothing in git | The description goes into the merge commit, not only the conversation |
