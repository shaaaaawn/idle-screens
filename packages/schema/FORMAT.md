# SaverSpec — Format Specification (version 1)

The declarative, agent-authorable screensaver format compiled by
`@idle-screens/schema`. A spec describes a saver as **data** — a background plus
layers of moving sprites — which `compileSaver()` turns into a seeded,
deterministic, flash-safe `SaverPlugin`. There is no code in a spec: no
scripting, no network access, no DOM access.

- **Machine-readable schema:** [`saver-spec.schema.json`](./saver-spec.schema.json)
  (JSON Schema draft-07), importable as
  `@idle-screens/schema/saver-spec.schema.json`.
- **Runtime validator:** `validateSpec(spec)` / `assertValidSpec(spec)` — used by
  `compileSaver()`, which refuses to run an invalid spec.

## Versioning

The **format version** (`schemaVersion`, currently `1`) is independent of the
npm package version. The package may ship breaking API changes without bumping
the format; the format only bumps when existing specs would parse or render
differently. New *optional* fields may be added within a format version —
older runtimes ignore unknown fields (see Validation semantics).

Additions to version 1 so far, all optional and backward compatible:
`alpha`, `blend`, `pulse`, `region` (layer appearance/placement);
`static` motion, `position`, `key` (dashboard/HUD support);
`align`, `baseline`, `maxWidth` (text sprites);
`spin`, `grow`, `cycle`, `orbit`, `links`, `units`, `referenceViewport`;
`trail`, `background.drift` (2026-07-19);
`ghosting`, `wander` / `warp` / `path` motions, `ring` / `streak` / `rect`
sprites, `colorWeights`, `pulse.wave`, `layout` (grid), `life`,
`links.mode/falloff/closed`, `blend: screen|multiply`, orbit layer-parents
(2026-07-21 — "the v1 ceiling").

## Safety invariants

These hold **by construction** — no spec can violate them:

1. **No flash primitive.** The background is static (drift is floored at 10 s)
   and entities are bounded sprites, so a compiled spec cannot strobe the full
   field. Provable by sampling any compiled spec through
   `@idle-screens/validator`.
2. **Pulse/grow/cycle are bounded.** Breathing amplitude is capped and periods
   floored at 500 ms (2 Hz — under the WCAG 3 Hz flash threshold). Every entity
   gets its own seeded phase — and with `pulse.wave`, a position-derived phase —
   so a layer will generally not pulse in unison (edge case: if spawn positions
   alias the wavelength, phases may coincide). `ghosting` only *smooths* luminance
   changes (it composites frames over a faded copy of the last), never sharpens
   them.
3. **Motion is bounded.** Speeds are capped (4000 px/sec; warp at 1.5
   depth-units/sec; orbit at 180 deg/sec; path laps at ≥ 2 s).
4. **Work is bounded.** ≤ 36 layers, ≤ 400 entities per layer, ≤ 800 total,
   links layers ≤ 200 entities, trails ≤ 24 samples.
5. **Determinism.** All randomness comes from a seeded PRNG. Same spec + same
   seed ⇒ identical entity streams and identical frames at any time `t`
   (compiled savers expose `renderFrame(t, seed)`). With `ghosting`, seeks
   replay a bounded fixed-step warm-up so even the accumulated smear is
   reproducible.

## Validation semantics

Two validators exist with deliberately different strictness:

| | unknown fields | everything else |
|---|---|---|
| `saver-spec.schema.json` | **rejected** (catches authoring typos) | identical |
| `validateSpec()` (runtime) | **ignored** (forward compatibility) | identical |

Author against the JSON Schema; ship through the runtime validator.

Rules the JSON Schema cannot fully express (the runtime enforces them):
total entities across all layers ≤ 800; every `[min, max]` range must satisfy
`min ≤ max`; `colorWeights` length must match `colors`; orbit layer-parents
must exist, have `count: 1`, and not themselves orbit a layer.

## Structure

```jsonc
{
  "schemaVersion": 1,
  "id": "snowfall",              // unique kebab-case id
  "label": "Snowfall",
  "seed": 42,                    // optional; falls back to the host's seed
  "motionIntensity": "calm",     // optional: calm | moderate | energetic
  "units": "viewport",           // optional: viewport (default) | px
  "referenceViewport": 1080,     // optional; design resolution for density scaling
  "ghosting": 0.9,               // optional 0..0.95; frame-persistence smear
  "background": { ... },         // optional; defaults to black
  "layers": [ { ... }, ... ]     // 1..36, rendered back-to-front
}
```

With `units: "viewport"` (the default) every dimensional value — sizes, radii,
speeds, distances, wavelengths, stroke widths — is a fraction of
`min(width, height)`, so specs scale to any display. Exception: text sprites
with an explicit `px` size in their `font` string (e.g. `"bold 14px monospace"`)
use that CSS font verbatim and do not scale with the viewport.

`ghosting` paints each frame over a faded copy of the previous one instead of
clearing: moving entities leave decaying after-images (Mystify smears, Matrix
trails, long-exposure light). 0.85–0.95 is the useful range; 0 (default) is off.

### `background`

- `{ "type": "solid", "color": "#06060c" }`
- `{ "type": "gradient", "stops": [{ "at": 0, "color": "#06121e" }, { "at": 1, "color": "#0d2436" }], "band": { "color": "#3a2d18", "height": 0.08 }, "drift": { "period": 30000, "amount": 0.12 } }`
  — vertical gradient (`at` 0 = top → 1 = bottom); optional solid `band` at the
  bottom (e.g. an aquarium seafloor); optional `drift` slowly oscillates the
  stop positions (period ≥ 10 s) so the background breathes. All colours are
  hex (`#rgb` / `#rrggbb`).

### `layers[]`

| Field | Type | Default | Meaning |
|---|---|---|---|
| `count` | int 1..400 | — | entities in this layer |
| `sprite` | SpriteSpec | — | what each entity looks like |
| `motion` | MotionSpec | — | how entities move |
| `size` | `[min,max]` > 0 | sprite-dependent | font size for emoji/text; ignored for shaped sprites |
| `wrap` | boolean | `true` | wrap to the opposite edge when leaving the viewport |
| `flip` | boolean | `false` | mirror the sprite to face its heading |
| `alpha` | `[min,max]` 0..1 | `[1,1]` | per-entity opacity range |
| `blend` | `lighter` \| `screen` \| `multiply` | source-over | additive glow / gentle additive / darkening |
| `region` | `{x?, y?}` ranges 0..1 | full viewport | fractional spawn window (placement only, not travel) |
| `pulse` | `{amp ≤ 0.5, period ≥ 500, wave?}` | none | opacity breathing; `wave: {wavelength, angle?}` turns it into a traveling wave across the field |
| `spin` | number ±360 deg/sec | none | per-entity rotation (seeded start angle) |
| `grow` | `{amp ≤ 0.8, period ≥ 500}` | none | size breathing (seeded phase) |
| `trail` | `{length ≤ 5000, fade?}` | none | analytic afterglow trail (ms of history) |
| `links` | see below | none | inter-entity lines |
| `layout` | `{type: "grid", columns?, jitter?}` | scatter | grid placement; `jitter` scalar or `{x?, y?}` 0..1 per axis |
| `life` | `{enter?, exit?, fade?}` ms | always on | act structure: fade the layer in at `enter`, out at `exit` |
| `key` | string | none | addressable name → `setParam("key.field", …)` |
| `position` | `{x, y}` 0..1 | none | exact placement; **requires `count: 1`**; overrides `region`/`layout` |

`links`: `{ k: 1..8, maxDist, color?, alpha?, width?, mode?, falloff?, closed? }`.
`mode: "nearest"` (default) wires each entity to its k nearest neighbors within
`maxDist`; `"chain"` wires entities in order (Mystify polygons — ignores
`k`/`maxDist`, `closed: true` closes the loop); `"random"` uses a fixed
deterministic wiring filtered by `maxDist`. `falloff: true` fades link alpha
with distance, removing pop-in at the cutoff.

### `sprite` (one of)

- `{ "kind": "emoji", "glyphs": ["🐟", "🐠"], "cycle": { "period": 800 } }` —
  glyph picked per entity (seeded); optional `cycle` rotates variants over time
- `{ "kind": "text", "strings": ["HELLO"], "color": "#e6e8ef", "font": "bold monospace", "align": "center", "baseline": "middle", "maxWidth": 300, "cycle": ... }`
  — a `font` **with** a px size is used verbatim; a family/weight only
  (`"bold monospace"`) composes with the seeded per-entity `size`
- `{ "kind": "circle", "radius": [0.001, 0.003], "color": "#ffffff", "soft": true }` —
  `soft` renders a radial-falloff glow orb instead of a hard disc
- `{ "kind": "ring", "radius": [0.002, 0.005], "color": "#d8f6ff", "width": 0.001 }` —
  unfilled circle (bubbles, portals, sonar)
- `{ "kind": "streak", "length": [0.01, 0.03], "color": "#cfd8ff", "width": 0.002 }` —
  a line oriented along the entity's analytic heading with a faded tail
  (rain that reads as rain, shooting stars, warp stars)
- `{ "kind": "rect", "width": [0.012, 0.02], "aspect": [1.3, 1.7], "color": "#ffb347" }` —
  rectangle; `aspect` is the height/width ratio range (rotates with `spin`)

`circle`, `ring`, `streak`, and `rect` all accept `colors: [...]` (seeded
per-entity palette pick) and `colorWeights: [...]` (relative weights, same
length — "mostly cool tones, occasional ember").

### `motion` (one of)

- `{ "type": "drift", "speed": [0.02, 0.06], "angle": 0, "bidirectional": true, "bob": 0.004 }`
  — heading in degrees (0 = right, 90 = down); `bidirectional` flips horizontal
  direction per entity (fish); `bob` adds vertical wobble
- `{ "type": "rise", "speed": [0.01, 0.03], "sway": 0.006 }` — upward, with horizontal sway (bubbles)
- `{ "type": "bounce", "speed": [0.12, 0.24] }` — diagonal, reflecting off edges
- `{ "type": "static" }` — stays exactly where placed (use with `position` for HUD text)
- `{ "type": "orbit", "speed": [10, 40], "radius": [0.05, 0.2], "center": { "x": 0.5, "y": 0.5 } }`
  — angular speed in deg/sec; `center` may instead be `{ "layer": "planet" }`
  to orbit a single-entity parent layer (moons around a wandering planet;
  strictly one level deep)
- `{ "type": "wander", "speed": [0.004, 0.012], "angle": 0, "meander": 0.1, "coherence": 0.7 }`
  — organic harmonic drift: base velocity plus 3 seeded sine octaves per axis.
  Flowing curved paths with zero simulation state. `meander` scales the
  curvature; `coherence` 0..1 blends every entity toward a shared harmonic set
  (1 = the layer undulates as one body — fake flocking)
- `{ "type": "warp", "speed": [0.1, 0.5], "center": { "x": 0.5, "y": 0.5 } }`
  — perspective starfield: entities stream toward the viewer on a depth axis,
  size/alpha/velocity scaling with 1/z. Pair with `streak` sprites for the
  classic warp tunnel
- `{ "type": "path", "points": [{"x":0.1,"y":0.7}, ...], "duration": 30000, "curve": "smooth", "closed": true, "scatter": 0.02 }`
  — choreographed spline (Catmull-Rom, or `linear`); 2..24 waypoints, lap time
  ≥ 2 s; `closed` loops (default), open paths ping-pong; `scatter` offsets
  entities sharing the path; each entity gets a seeded phase along it

All speeds are ranges; each entity draws its own value (seeded).

## Determinism contract

Entity construction consumes the seeded RNG in a **fixed draw order** per layer.
New optional fields only consume RNG draws when present, so adding features to
the format never changes the entity stream of an existing spec — a spec authored
against an older runtime renders bit-identically on a newer one
(`determinism-baseline.test.ts` guards this with snapshot streams).

Positions are **analytic**: `positionAt(entity, t)` is a pure function, so
`renderFrame(t, seed)` can seek anywhere instantly, trails sample the past for
free, and streak headings derive from a finite difference. `ghosting` is the
one frame-coupled effect, and it preserves seekability by replaying a bounded
fixed-step warm-up (≤ 120 frames) from a full clear on any non-contiguous seek.

## Steering

Compiled specs accept live parameter changes via dot-paths —
`layers.0.count`, `background.stops.0.color`, or `key`-based paths like
`cpu-gauge.color` when layers declare `key`. Changes interpolate over a
control-track (`step` | `linear` | `smooth`). Placement/motion changes trigger
a deterministic rebuild (same seed → same stream). See `@idle-screens/core`
for `ControlTrack` and the idlescreens.com MCP `setParam` tool.

## Seeing without eyes — the perception API

`src/perceive.ts` translates a spec into modalities a **non-vision agent** can
reason about, computed analytically from the entity model (no canvas, no
renderer, deterministic, Node-safe). Note: the analytical model approximates
but does not perfectly match canvas rendering — blend modes are simplified
(`screen` ≈ `lighter`), wrapped link segments use straight interpolation, and
background drift is sampled at rest. These are documented trade-offs for a
zero-dependency, renderer-free analysis tool.

- `perceiveScene(spec, {t?, viewport?, seed?})` — one-call bundle: everything below.
- `luminanceGrid(spec, opts)` — an 80×48 luminance image of the composed frame
  (background gradient + entities + link lines, blend-aware), with coverage,
  visual-mass centroid, and **row/column deviation profiles** (1D transects of
  the composition).
- `renderBrailleMap(grid)` — the picture: 12 lines × 40 braille chars, each
  char a 2×4 dot cell, ordered-dithered with auto-exposure. An agent reads the
  whole frame at once instead of reconstructing it entity by entity.
- `dominanceRanking(spec, opts)` — layers ranked by estimated visual weight
  (area × alpha × contrast × glow/motion boosts; links count) — *where the eye
  goes*, normalized to shares.
- `motionStats(spec, opts)` — per-layer mean/max on-screen speed from analytic
  displacement — choreography as numbers.
- `diffScenes(a, b, opts)` — **relative sight**: coverage/luminance deltas,
  visual-balance shift, 3×3 region deltas, dominance-rank movement, and
  advisory codes added/removed. Agents judge "is B better than A" far more
  reliably than "is A good"; this is the edit loop's primary instrument.

Known approximations (deliberate): trails and ghosting are not sampled, soft
circles use a linear falloff, text ink is estimated from font size × string
length. Good enough to perceive composition, focus, balance, and motion —
not a substitute for a human (or VLM) judgement of beauty.

## Examples

Shipped working specs (also exposed as `EXAMPLE_SPECS` /
`SCHEMA_EXAMPLES`): `aquarium`, `rain`, `snowfall`, `lanterns`, `sakura`,
`dev-dashboard`, `orrery`, `constellation`, `comets`, plus the v1-ceiling
showcases — `aurora` (wander + coherence + ghosting + pulse.wave),
`warp-tunnel` (warp + streaks), `polygons` (chain links + heavy ghosting),
`matrix-rain` (grid layout + glyph cycle + ghosting), and `procession`
(path + layer-parented orbit + life staging + ring/rect sprites). See
[`src/examples/`](./src/examples/). The dashboard exercises the static/HUD
subset at scale (34 layers of keyed, positioned text).
