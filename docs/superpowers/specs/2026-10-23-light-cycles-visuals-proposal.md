# Light cycles: visual upgrade — proposal

Date: 2026-10-23 · Status: **proposal**. Options for the owner to choose from; the plan follows the
choice. The current look and why it is what it is: [light-cycles spec](2026-10-10-light-cycles-design.md)
section 8 and [plan 8](../plans/2026-10-11-plan-8-cycles-client.md) ("What was verified").

## 1. Where it stands

Dark ground with a thin grid, opaque dark walls with a bright edge strip, a soft bloom
(`UnrealBloomPass(0.55, 0.35, 0.6)` — the owner found the first version "too bright"), light cycles
built from primitives (two glowing rims, dark body, canopy, lit stripe), a chase camera that eases
its heading. 120 fps with 20 bikes on the owner's M2.

Known gaps in the current scene, found in plan 8's review and recorded, not yet fixed:
- every tick uploads the whole wall instance buffers to the GPU (~1.2 MB a tick), not only the
  changed range;
- the bloom pass and its render targets are not disposed on unmount;
- the arena's React tree re-renders every tick;
- the soundtrack thins out in a background tab;
- an end-to-end key-listener race.

Also visible: the EffectComposer renders without multisampling, so edges alias — the canvas's own
antialiasing does not apply through the composer.

## 2. Options

| # | Upgrade | What changes on screen | Cost and risk |
|---|---|---|---|
| V1 | **Reflective floor + shader grid** | The floor mirrors bikes and walls with a blurred, distance-faded reflection (drei's [`MeshReflectorMaterial`](https://drei.docs.pmnd.rs/shaders/mesh-reflector-material), drei is already a dependency); grid lines drawn in a fragment shader — anti-aliased, glowing, fading with distance instead of `GridHelper` lines | The biggest single jump in "film look". A second render of the scene for the reflection: must be measured; resolution is the knob |
| V2 | **Walls with depth** | A vertical gradient (bright at the edge, dark at the foot), faint scanlines, a fresnel rim so walls glow at grazing angles, a slow energy pulse along the trail | One small custom shader on the existing instanced mesh; no extra draw calls |
| V3 | **Better bikes** | A more detailed procedural light cycle (fairing, rider, headlight), fresnel rim; or a CC0 model if one exists (licence checked) | Procedural keeps zero downloads; a model file needs a licence and a budget |
| V4 | **Effects** | Crash: the bike breaks into tinted debris — the owner's Kenney Car Kit has `debris-*` pieces (CC0) — with a flash and a ring of light; boost: a streak and a camera kick; respawn: the bike "derezzes" in | Instanced, time-boxed particles; must not allocate per frame |
| V5 | **Environment** | A dark gradient sky, a horizon glow, distant mountain silhouettes, an arena rim; optionally a CC0 HDRI (Poly Haven) for reflections on bikes | Cheap except an HDRI download |
| V6 | **Post-processing** | Multisampled or SMAA anti-aliasing (fixes the aliasing above), a light vignette, subtle chromatic aberration, bloom retuned for the new materials | Small; anti-aliasing is overdue regardless |

## 3. Recommendation

Three packages, each a plan with its own branch and review:

1. **Polish** — V1, V2, V6, plus the five recorded gaps from §1. The largest visible improvement for
   the least risk, and it pays off debt.
2. **Effects** — V4 (crash debris from the Kenney kit, boost streak, derez respawn).
3. **World** — V5 and V3.

Whatever is chosen is held to: 60 fps with 20 bikes on the M2 and on one mid-range phone, measured
in a real window; a screenshot of every change, looked at (`verify-visually`); the owner's eye as
the final judge of brightness — the first version was too bright.

## 4. Open questions for the owner

1. Which packages, in which order? (Recommended: Polish → Effects → World.)
2. Reflections: strong mirror, or a subtle blurred sheen?
3. Bikes: refine the procedural one, or look for a licensed model?
4. Should the neon look spread to the lobby and results screens (still open since plan 5)?
5. The wall-on-a-button mechanic (walls only while held, with energy, as in *Tron: Legacy*) was
   requested at the retro — part of this work, or its own gameplay plan?
