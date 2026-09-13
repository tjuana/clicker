---
name: verify-visually
description: Use when a change affects something a person will look at — a screen, a scene, a layout, a chart — and the automated checks are green. Also use when someone says the result "looks strange" but the tests pass.
---

# Verify Visually

## Overview

Tests, types and linters prove that code runs. They prove nothing about whether a human can look at
the result without wincing. For anything visual, the only evidence is a picture you actually looked
at.

**Core principle:** green checks are not evidence for anything visual. Take a screenshot, open it,
describe what you see — then decide whether it is done.

## When to Use

- A UI screen, layout, HUD or 3D scene changed.
- A chart, diagram or generated image changed.
- Someone reports that something "looks weird" or "off" while the suite is green.
- Before claiming any visual work is finished.

Not needed for pure logic, protocols, build config or anything with no rendered output.

## The Failure This Prevents

Real case from this project: a 3D scene passed 106 tests, `tsc` and the linter. It was still broken
in four ways at once — the camera had no target so the subject drifted out of frame, the canvas was
8:1 so everything was squashed into a strip, bar heights were computed relative to the leader so a
solo player was pinned at maximum and saw no growth, and there was no floor, so the shapes floated
in a void. Every one of those is invisible to a test suite and obvious in a screenshot.

## Core Pattern

```js
// A throwaway script beats a permanent test for this: you are looking, not asserting.
import { chromium } from '@playwright/test';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 760 } });

await page.goto('http://localhost:5173/');
await page.waitForSelector('[data-testid="players"] li');   // wait for state, never a sleep
await page.click('[data-testid="start"]');                  // drive it into the interesting state
await page.screenshot({ path: 'shot.png' });

console.log(await page.locator('h1').innerText());          // print what the UI thinks it shows
await browser.close();
```

Then **open the image and read it**. Describe it in words: what is in frame, what is cut off, what
is unreadable, what is empty space. If you cannot describe it, you did not look.

## Quick Reference

| Question | What to check in the picture |
|---|---|
| Framing | Is the subject fully in frame, or cut off at an edge? |
| Proportions | Does the container have a sane aspect ratio, or is everything squashed? |
| Reference | Is there a ground, baseline or grid to judge size against? |
| Range | With one item, and with many — does the display still make sense? |
| Emptiness | Is most of the frame doing nothing? |
| Small screen | Repeat at ~390px wide before calling it done. |

## Common Mistakes

- **Trusting the test suite.** It cannot see. That is the whole point of this skill.
- **Screenshotting the wrong state.** An empty lobby proves nothing about a running round.
- **Looking once.** Check the extremes: one player and twelve, zero score and maximum, narrow and wide.
- **Sleeping instead of waiting.** `waitForTimeout` makes the shot flaky; wait for an element or a state.
- **Polishing a throwaway.** A prototype only has to prove the pipeline works — say it is a draft and
  move the polish to the real implementation.
