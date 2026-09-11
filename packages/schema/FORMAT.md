# SaverSpec — Format Specification (version 1)

The declarative, agent-authorable screensaver format compiled by
`@idle-screens/schema`. A spec describes a saver as **data** — a background plus
layers of moving sprites — which `compileSaver()` turns into a seeded,
deterministic, flash-safe `SaverPlugin`. There is no code in a spec: no
scripting, no network access, no DOM access.

- **Machine-readable schema:** [`saver-spec.schema.json`](./saver-spec.schema.json)
  (JSON Schema draft-07), covering SaverSpec scenes and `idle-sequence`
  envelopes (`oneOf`, discriminated by `format: "idle-sequence"`). Importable as
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
(2026-07-21 — "the v1 ceiling");
`textBlock` sprite — deterministic multi-line text with viewport-unit sizing;
`textBlock.reveal` — animated typing/deleting via one steerable paint param;
`emit` (sparse events), `clock` (phase-lock), `motion.ease` (settle / buoyant)
(2026-09-05 — time structure); `polygon` / `stroke` sprites and `rect.feather`
(2026-09-05 — shape glyphs); `layout: list | table` and the `bar` sprite
(2026-09-05 — data layout); `textBlock.anchor` / `font` / `opacity`, the
`maxWidth` cap lifted to 2.0, `sync` and `bed` on the sequence envelope,
the `fade` transition, `role` on text sprites, and `text: 'crossfade'` on
`morph` (2026-09-08 — ambient presentations).

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
   them. `clock` deliberately removes the per-entity phase, so the validator
   floors a clocked layer's periods at 1000 ms (1 Hz) instead — a layer in
   unison breathes, it never flashes. `emit` events are floored at one per
   second per entity and always ride a smooth envelope, never a cut.
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
`min ≤ max`; `colorWeights` length must match `colors`; `emit.life ≤
emit.every`; a `clock`ed layer's `pulse`/`grow`/`cycle` period must satisfy
`period / rate ≥ 1000`; a `polygon` takes `sides` or `points`, not both (the
JSON Schema enforces this one too); orbit layer-parents
must exist, have `count: 1`, and not themselves orbit a layer.

## Structure

```jsonc
{
  "schemaVersion": 1,
  "id": "snowfall",              // unique kebab-case id
  "label": "Snowfall",
  "seed": 42,                    // optional; falls back to the host's seed
  "motionIntensity": "calm",     // optional: calm | moderate | energetic
  "density": "normal",           // optional: sparse | normal | dense — declared intent, see below
  "units": "viewport",           // optional: viewport (default) | px
  "referenceViewport": 1080,     // optional; design resolution for density scaling
  "ghosting": 0.9,               // optional 0..0.95; frame-persistence smear
  "background": { ... },         // optional; defaults to black
  "layers": [ { ... }, ... ]     // 1..36, rendered back-to-front
}
```

With `units: "viewport"` (the default) every dimensional value — sizes, radii,
speeds, distances, wavelengths, stroke widths — is a fraction of
`min(width, height)`, so specs scale to any display. Text sprites with an
explicit `px` size in their `font` string (e.g. `"bold 14px monospace"`) are no
exception: the compiler rescales that number by
`min(width, height) / referenceViewport` so the text holds its apparent size,
and only `units: "px"` specs get it verbatim. See **Scale** below.

`ghosting` paints each frame over a faded copy of the previous one instead of
clearing: moving entities leave decaying after-images (Mystify smears, Matrix
trails, long-exposure light). 0.85–0.95 is the useful range; 0 (default) is off.

`density` declares what the emptiness or the crowding means. `sparse` says
the scene is *meant* to be almost empty — one faint mark on a dark ground,
long silences — so `adviseSpec` withholds `sparse-scene` and a scorer that
gates on coverage should read the declaration before calling a faithful
scene broken. `dense` withholds `dense-scene` the same way. The declaration
is checked, not trusted: a `sparse` scene whose alpha-weighted coverage
exceeds 2 %, or a `dense` one that would have tripped `sparse-scene`, gets a
`density-mismatch` advisory instead. Omitted means `normal`. Like
`motionIntensity`, it is a hint — it changes no pixel.

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
| `spin` | number \| `[min,max]` ±360 deg/sec | none | per-entity rotation (seeded start angle); a range gives each entity a seeded speed (confetti, tumbling debris) |
| `grow` | `{amp ≤ 0.8, period ≥ 500}` | none | size breathing (seeded phase) |
| `trail` | `{length ≤ 5000, fade?}` | none | analytic afterglow trail; `length` is **milliseconds** of history (max 5000), `fade` a number 0..1 (not a boolean — `links.falloff` in the next row is the boolean) |
| `links` | see below | none | inter-entity lines |
| `layout` | `{type: "grid", columns?, jitter?}` \| `{type: "list", gap?}` \| `{type: "table", columns, gap?}` | scatter | `grid`: cells fill `region`, `jitter` scalar or `{x?, y?}` 0..1 per axis. **`list` / `table`: data layouts** — entities in reading order from `position` (any count) or centred in `region`, `gap` apart (viewport units of `min(w,h)`, default 0.06); text/emoji take `strings[i]` / `glyphs[i]` and palettes `colors[i]` **in order**, so N labels are one layer |
| `life` | `{enter?, exit?, fade?}` ms | always on | act structure: fade the layer in at `enter`, out at `exit` |
| `emit` | `{every ≥ 1000, life ≥ 500, jitter?, grow?}` (`life ≤ every`) | always lit | **sparse events**: each entity is dark except a `life`-ms window every `every` ms, fading in fast and out slow; `jitter` 0 staggers entities evenly (one event at a time while `life ≤ every / count`), 1 scatters the offsets (a fixed sequence, not seeded — declaring `emit` disturbs no other draw); `grow: [from, to]` scales size across the window — expansion rather than travel |
| `clock` | `{phase?, rate?}` | seeded phases | **phase-lock**: `pulse`, `grow` and `cycle` share one phase (turns, 0..1) and run at `rate` × time; two layers with the same clock breathe in step. Clocked periods must satisfy `period / rate ≥ 1000` |
| `key` | string | none | addressable name → `setParam("key.count", …)` for a layer field, `setParam("key.sprite.color", …)` for a sprite field (the path mirrors the JSON: sprite fields sit under `sprite`) |
| `position` | `{x, y}` 0..1 | none | exact placement; **requires `count: 1`** — except with a `list`/`table` layout, where it anchors the block's top-left; overrides `region` |

`links`: `{ k: 1..8, maxDist, color?, alpha?, width?, mode?, falloff?, closed? }`.
`mode: "nearest"` (default) wires each entity to its k nearest neighbors within
`maxDist`; `"chain"` wires entities in order (Mystify polygons — ignores
`k`/`maxDist`, `closed: true` closes the loop); `"random"` uses a fixed
deterministic wiring filtered by `maxDist`. `falloff: true` fades link alpha
with distance, removing pop-in at the cutoff.

### `sprite` (one of)

- `{ "kind": "emoji", "glyphs": ["🐟", "🐠"], "cycle": { "period": 800 } }` —
  glyph picked per entity (seeded); optional `cycle` rotates variants over time
- `{ "kind": "text", "strings": ["HELLO"], "color": "#e6e8ef", "font": "bold monospace", "align": "center", "baseline": "middle", "maxWidth": 300, "cycle": ..., "role": "read" }`
  — a `font` **with** a px size keeps that shorthand, its number rescaled to the
  viewport (verbatim only under `units: "px"`); a family/weight only
  (`"bold monospace"`) composes with the seeded per-entity `size`; `role` is
  the legibility opt-in described under `textBlock` below (same field, same
  meaning on both text sprites)
- `{ "kind": "circle", "radius": [0.001, 0.003], "color": "#ffffff", "soft": true }` —
  `soft` renders a radial-falloff glow orb instead of a hard disc
- `{ "kind": "ring", "radius": [0.002, 0.005], "color": "#d8f6ff", "width": 0.001 }` —
  unfilled circle (bubbles, portals, sonar)
- `{ "kind": "streak", "length": [0.01, 0.03], "color": "#cfd8ff", "width": 0.002 }` —
  a line oriented along the entity's analytic heading with a faded tail
  (rain that reads as rain, shooting stars, warp stars)
- `{ "kind": "rect", "width": [0.012, 0.02], "aspect": [1.3, 1.7], "color": "#ffb347", "feather": 0.6 }` —
  rectangle; `aspect` is the height/width ratio range (rotates with `spin`);
  `feather` 0..1 softens the edges — that fraction of the half-size fades out
  toward the border (Rothko's block at 0.5–0.8)
- `{ "kind": "bar", "values": [82, 64, 91], "max": 100, "length": 0.5, "thickness": 0.02, "color": "#17e8c8", "direction": "right" }` —
  a data bar: entity *i* draws `length × values[i] / max` (viewport units),
  `thickness` thick, growing from its position toward `direction` (`right`
  default, `left`, `up`, `down`). `values` are **paint**: `setParam("bars.sprite.values", […])`
  glides every bar (the field lives under `sprite`, so the path does too —
  `bars.values` resolves nothing). With `layout: { type: "list" }` a chart is one layer and
  its labels another — the dashboard genre stops needing one layer per number
- `{ "kind": "polygon", "radius": [0.02, 0.05], "sides": 3, "color": "#f2e8c9", "soft": false }` —
  regular n-gon of the seeded circumradius, point up (`sides` 3..12, default
  6); or `"points": [[-1, 0.9], [0.2, -1], [1, 0.4]]` — 3..24 unit
  coordinates in −1..1 scaled by the radius — for any facet (a Picasso shard,
  a Kandinsky triangle, a Mondrian plane). `soft` feathers the fill from the
  centre. Rotates with `spin`. `points` are paint, so two polygons with the
  same point count `morph` into each other
- `{ "kind": "stroke", "length": [0.08, 0.18], "points": [[-1, 0.3], [-0.5, -0.6], [0.3, -0.7], [1, 0.1]], "width": 0.004, "taper": true, "color": "#f2e8c9" }` —
  a freehand mark: a path through 2..24 unit-coordinate points, scaled so the
  unit box spans the seeded `length`, stroked `width` wide with round joins.
  `curve: "smooth"` (default) is a Catmull-Rom spline, `"linear"` a polyline;
  `taper` thins the mark to almost nothing at both ends (a brush stroke rather
  than a line); `orient: true` turns the path's +x along the entity's heading,
  like `streak`. Rotates with `spin`. Van Gogh's stroke, Hokusai's contour,
  O'Keeffe's petal, Basquiat's scrawl
- `{ "kind": "textBlock", "text": "Multi-line text with wrapping.", "maxWidth": 0.8, "fontSize": 0.04, "lineHeight": 1.4, "align": "left", "color": "#e6e8ef", "anchor": "top-left", "font": "system-ui, sans-serif", "opacity": 1 }` —
  multi-line text block with deterministic line-breaking. All dimensions are
  viewport fractions (of `min(w,h)`), not px — `units: "px"` specs reject
  textBlock sprites at validation time. Without `anchor`, `position` is the
  **top-left corner of the `maxWidth` layout box** regardless of `align`
  (align moves text within the box, not the box itself — different from the
  `text` sprite where `align`/`baseline` shift the meaning of `position`).
  `maxWidth` may reach `2.0` — wider than the frame is legal (a wide caption
  on a portrait screen); the `text-off-screen` advisory reports what runs
  out. Line breaks are computed from a fixed character-class metrics table so
  wrapping is identical across platforms; note that the table is approximate
  — a painted line may slightly exceed `maxWidth` when the real font is wider
  than the table estimates, so `maxWidth` is a layout target, not a hard clip.
  Use with `count: 1`, `motion: { type: "static" }`, and `position`.

  `anchor` (one of nine compass points: `top-left`, `top`, `top-right`,
  `left`, `center`, `right`, `bottom-left`, `bottom`, `bottom-right`) says
  which point of the **rendered text** `position` names — the widest line
  wide, as `align` lays it inside `maxWidth`, and `lines × lineHeight` tall,
  measured after line-breaking. With `anchor: "center"` and
  `position: { "x": 0.5, "y": 0.5 }` the block is centred on **every** aspect
  ratio — `position` is in viewport fractions while `maxWidth` is in
  `min(w,h)`, so hand-computing a centred `x` for one screen misses on the
  next; the anchor removes the arithmetic. Under an anchor `align` only
  shapes the ragged edge (shorter lines sit left/centre/right of the widest);
  it no longer moves the ink. Anchor is placement, so it is part of the
  structural signature (a change rebuilds); rotation stays about the anchor
  point. The perception boxes (`text-overlap`, `text-off-screen`) follow the
  same rule. Absent ⇒ exactly the pre-anchor behaviour above. **Native
  clients that do not read `anchor` render as absent (layout-box top-left).**

  `font` is a CSS family and/or weight/style — `"bold monospace"`,
  `"300 'Inter', sans-serif"` — composed with the scaled `fontSize` the way
  the `text` sprite composes a size-less font; a **size inside it is
  rejected** (`fontSize` owns size, so the block keeps scaling with the
  viewport). A monospace family (`monospace`, `ui-monospace`, Menlo, Courier,
  SF Mono, Fira Code, …) switches the line-breaker to a uniform 0.6 em
  advance so mono wraps land where the real face puts them; every other
  family uses the proportional table. Default `system-ui, sans-serif`.
  **Native clients fall back to the system face** until a face table exists.

  `opacity` (0–1, default 1) multiplies the block's paint alpha — the whole
  block, on top of the layer's per-entity `alpha`. It is **paint**, not
  carpentry: excluded from the structural signature, so
  `setParam("h.sprite.opacity", 0, { dur: 1500 })` glides the block out
  without a rebuild (and back in with `1`). Declare `"opacity": 1` on the
  block to make the path steerable (a `setParam` cannot create a field that
  is not there). Scales perceived ink in the luminance grid. **Native clients
  without `opacity` render at 1.**

  `role` (`"read"` | `"atmosphere"`, on `textBlock` **and** `text`) declares
  what the words are *for*, and is the only thing that turns legibility
  checking on. Absent, or `"atmosphere"`, the layer is texture — a haiku
  fading in a corner, dim labels on a wall board, the `dev-dashboard`'s
  2.6:1 telemetry — and `adviseSpec` says nothing about how readable it is,
  exactly as before the field existed; keep atmospheric text undeclared, the
  advisories would only nag. `"read"` says the words must be read from
  across the room, and opts that layer into two advisories:
  `text-legibility` fires when the text colour's WCAG ratio falls below
  **4.5:1** against the background sampled at the box centre (gradient stops
  interpolated at rest, `band` honoured) **or** against the brightest
  additive layer (`blend: lighter` / `screen`) whose entities can reach the
  box and are at least a glyph tall, taken at its peak alpha (base + pulse)
  composited over that background — a glow parked under a caption is
  measured, dust is not; both ratios appear in the message when an additive layer is beneath — a plate-less read reports only the background ratio. `text-safe-area`
  fires when the box (a `list`'s whole extent) lies within **5 %** of any
  viewport edge, where bezels and overscan hide it. Each is judged at the
  viewport passed to `adviseSpec` — check the portrait one too. `role` is a
  declaration only: it changes **no pixel anywhere, on any client**, is not
  in the structural signature, and native players ignore it with nothing to
  fall back to. The shipped `lobby-talk` example declares it on every text
  layer and produces zero advisories, landscape and portrait.

  textBlock also accepts `reveal` — animated typing/deleting:
  `{ "reveal": { "progress": 1, "mode": "typewriter", "speed": 0, "caret": true } }`.
  Layout always runs on the **full** text; reveal only masks which glyphs are
  painted, so lines never reflow and the block never resizes while typing.
  `progress` (0–1, default 1) is the frontier — it is a numeric **paint**
  param, so steering it with `dur`/`ease` animates typing in a single
  `setParam` call, and gliding it back toward 0 deletes. `mode` quantizes the
  frontier per grapheme (`typewriter`, default), per `word`, or per `line`.
  `speed` (graphemes/sec, max 120) makes the block type itself from scene
  start: effective progress is `min(progress, speed·t/total)`, so a steered
  `progress` can still hold or delete a self-typing block. A fourth mode,
  `glyphFade`, fades each glyph in over a staggered alpha ramp instead of
  popping it whole (the caption look); `fade` (0–1 exclusive of 0, default
  0.15, `glyphFade` only) is each glyph's fade window as a fraction of
  progress — small reads as a soft typewriter, large as a wave of
  overlapping fades. Still a pure function of `progress`, so it glides and
  deletes exactly like the other modes. Native clients render `glyphFade`
  as `typewriter` until they gain per-glyph alpha. `caret` draws a
  blinking caret at the frontier (`true`, or `{ "blink": 1.2, "color": "#fff" }`;
  blink is in full cycles/sec, capped at 3 for flash safety, and is a square
  wave of `t` like every other animation). With `align: "center"`/`"right"`
  the revealing line stays anchored to its alignment as it types — only
  left-aligned text reads as a classic typewriter. `text` itself is paint
  that **steps**: a `setParam` swap or a sequence `morph` switches the string
  whole on the first frame — nothing interpolates a string — so to "edit"
  text live: glide `reveal.progress` to 0, swap `text` while nothing is
  visible, glide back to 1 (or fade the block via its `color`). Inside a
  sequence, a morph declared `text: 'crossfade'` cross-fades the old words
  under the new ones instead (see **Transitions** below).

`circle`, `ring`, `streak`, `rect`, `bar`, `polygon` and `stroke` all accept
`colors: [...]` (seeded per-entity palette pick) and `colorWeights: [...]`
(relative weights, same length — "mostly cool tones, occasional ember").

**Drawing a shape out of sprites.** Overlapping sprites merge into one seamless
silhouette under exactly one set of conditions: a single flat colour, `alpha`
of `[1, 1]`, no `blend`, no `pulse`, and hard edges (no `soft`, no
`rect.feather`). Anything else leaves every overlap visible as an internal edge,
so the layer reads as a pile of sprites rather than a form — `soft` in
particular reads as smoke, not mass. Depth then comes from *layer order* and a
different flat colour per layer, painting back to front, and a later layer can
be used to cut a clean edge across an earlier one. `layerCohesion` measures
which of the two you got; `overlap-seams` warns when you asked for the first
and configured the second.

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

`drift`, `rise` and `wander` also accept **`ease`** — closed-form velocity
shaping, no integration state:
`{ "ease": { "type": "settle", "tau": 2500 } }` starts at the entity's speed
and decelerates to rest with time constant `tau` ms (it travels `speed × tau`
and stops — a mark flung and coming to rest); `"buoyant"` starts at rest and
approaches the speed over `tau` (a bubble reaching terminal velocity). With
`emit`, the eased travel restarts from the spawn point on every event. For
`wander` only the base velocity eases — the harmonic meander keeps breathing,
so a settled wanderer hovers rather than freezes.

**Time structure, composed.** `emit` is how a scene does *almost nothing,
almost never*: one ring every twelve seconds that expands and fades
(`emit: { every: 12000, life: 5000, jitter: 0, grow: [0.15, 2.4] }`) reads as
an event, where the same ring pulsing forever reads as wallpaper. Long
`every`, low `count`, `jitter: 0` for a metronome, `1` for weather; pair with
`ease: settle` so a mark is flung and comes to rest before it fades ("expand,
drift a little, settle, fade" is one layer). `clock` is the other half: two
layers on the same clock are a duet, not a coincidence. The shipped `pings`
example is the whole idea in two layers.
## Scale — what the numbers actually look like

Every dimensional value is a fraction of `min(width, height)`. On a 1920×1080
display that divisor is **1080**, so `0.01` is 10.8 px there and the same
fraction of the short side on a phone or a 4K wall. Nothing below is a rule —
they are measured landmarks, because the most common authoring failure is not
a bad idea, it is an idea rendered two orders of magnitude too small or too
large to see. The px conversions and coverage figures are measured
(`perceiveScene` at 1920×1080, 40 opaque white entities on black, unless a row
says otherwise); the "reads as" readings and the recipe advice are judgment.

### `circle.radius` (a **radius**, so a dot is twice this wide)

| radius | px radius @1080p | px across | coverage (40) | reads as |
|---|---|---|---|---|
| `0.0005` | 0.5 | 1 | 0.9 % | star grain — texture, never the subject |
| `0.002` | 2.2 | 4 | 1.0 % | dust, embers, distant snow |
| `0.005` | 5.4 | 11 | 1.6 % | a distinct dot; graph node, firefly |
| `0.02` | 21.6 | 43 | 6.2 % | a clear disc — bokeh, a planet |
| `0.05` | 54 | 108 | 21 % | a focal object, or a soft glow field |
| `0.1` | 108 | 216 | 52 % | dominant form — sun, moon, one per scene |
| `0.2` | 216 | 432 | 88 % | 40 % of the short side; only as a soft glow plate |

**Read the coverage column with its floor in mind.** `perceiveScene` samples an
80 × 48 grid, so a cell is ~24 × 22 px at 1080p and anything smaller registers as
one cell per entity. That is why the top two rungs both land near 1 % despite a
16 × difference in area — below `radius ≈ 0.01` the column counts entities, not
pixels. It becomes an area measurement from `0.02` up.

The shipped examples put entity *fields* almost entirely in `0.0003 – 0.007`
and large forms in `0.03 – 0.185` (the biggest is a `ring` gauge in
`dev-dashboard`). The gap between is thinly populated
but not empty, and the exception is instructive: `aurora` runs 60–100-entity
layers at `radius [0.045, 0.11]`, because a soft additive orb that large is
atmosphere rather than an object. Within one scene, `lanterns`' three parallax
layers step by ~2.2 × and ~2.4 × per layer; steps much smaller than that read
as one layer with a wide size range rather than as depth.

The bottom two rungs are texture, not content, and `adviseSpec` says so: a
`0.002` field stops raising `sparse-scene` at ~70 entities, while a `0.0005`
field would need over a thousand — far past `LIMITS.maxPerLayer` (400) — so it
raises `sparse-scene` at every legal count and always needs a brighter layer
above it.

### `size` (emoji), `fontSize` (textBlock), `size` (text sprites)

`0.02` ≈ 22 px, `0.035` ≈ 38 px, `0.05` ≈ 54 px, `0.1` ≈ 108 px at 1080p.
Emoji fields in the examples sit at `0.011 – 0.078`; `haiku`, the one textBlock
example, sets `fontSize: 0.05`.

An explicit px size inside a `font` string (`"bold 14px monospace"`) is **not**
absolute: under the default `viewport` units the compiler rescales it by
`min(w, h) / referenceViewport`, so it holds its apparent size across displays
(14 px at 1080p becomes 28 px at 4K and 5 px on a phone). Only `units: "px"`
specs get the number verbatim. Two consequences: a font pinned for a 4K wall
becomes illegibly small on a phone-sized viewport, and a spec that genuinely
wants fixed pixels must say `units: "px"`.

### `speed` (viewport fractions per second)

| speed | px/s @1080p | crosses the short side | crosses a 16:9 width |
|---|---|---|---|
| `0.001` | 1.1 | 17 min | 30 min |
| `0.005` | 5.4 | 3.3 min | 5.9 min |
| `0.02` | 21.6 | 50 s | 89 s |
| `0.06` | 65 | 17 s | 30 s |
| `0.15` | 162 | 7 s | 12 s |

An ambient scene meant to live on a wall for hours wants its background layers
under `0.005` — anything faster resolves as traffic rather than atmosphere.
Above `0.06` a layer reads as an event (rain, warp, a passing comet). Speeds
are ranges and each entity draws its own, so a `[0.002, 0.008]` layer already
carries internal parallax.

### `links.maxDist`

Link density is governed by `maxDist` relative to the mean spacing between
entities, `sqrt(w·h / count) / min(w, h)` — for 40 entities at 1920×1080 that
is `0.21` (228 px), for 100 it is `0.13` (144 px). Measured at `k: 3`, count 40,
averaged over 15 seeds:

| `maxDist` | edges drawn (of `k·count`) | graph |
|---|---|---|
| 0.5 × spacing | ~12 % | scattered pairs; ~45 % of nodes isolated |
| 1.0 × spacing | ~45 % | a constellation with a few loners |
| 1.5 × spacing | ~60 % | usually one connected component, rarely an isolate |
| 2.0 × spacing | ~62 % | saturated — `k` is now the binding cap |

Past ~2 × spacing, raising `maxDist` costs distance tests and buys nothing;
raise `k` instead. `describeScene` reports `linksDrawn` / `linksExpected` and
`isolatedNodes`, so connectivity is checkable per spec rather than guessed —
worth doing, since the seed moves these by several points either way.

### Recipes

**Parallax depth.** Three or four layers where size and speed rise together —
scaling size alone reads as a size distribution, not as distance. `lanterns`'
ladder, which the numbers above are drawn from: `radius [0.0005, 0.0013]` /
`speed [0.0005, 0.002]` / `alpha [0.35, 1]` far, `radius [0.0014, 0.0028]` /
`speed [0.006, 0.013]` / `alpha [0.5, 0.9]` mid, `radius [0.0032, 0.006]` /
`speed [0.015, 0.026]` / `alpha [0.6, 1]` near. Note that alpha *narrows*
toward the front rather than simply rising — the far layer spans the whole
range because distance is what varies it; the near layer is uniformly present.

**Glow stacking.** `soft: true` + `blend: "lighter"` + `alpha` around 0.5–0.9,
with `pulse: { amp: 0.2, period: 3000 }` for breathing. Glow reads only against
a dark plate — over a pale background use `"screen"`. Do not assume a soft orb
covers what a hard disc of the same radius would: `perceiveScene` models the
halo as reaching 2.4 × the radius, so a large soft additive layer measures far
*more* coverage than its hard equivalent — ~2.5 × at `radius 0.05` — while a
small one measures *less*, ~0.5 × at `radius 0.005`, because the faint outer
halo falls under the per-cell visibility threshold. The crossover sits near
`radius 0.01`. Re-measure after switching `soft` or `blend` rather than
compensating by a rule of thumb.

**Graph web.** `count 40–100`, `radius [0.002, 0.005]`, a slow `drift`
(`speed [0.002, 0.007]`) so the topology keeps re-forming, and `links` with
`k: 3`, `maxDist` at 1.5 × mean spacing (`0.3` for 40 entities, `0.2` for 100),
`alpha: 0.15`, `width: 0.0005`. Link alpha wants to be much lower than the
nodes' — at 0.15 the web is a suggestion, at 0.5 it is a diagram. Add
`falloff: true` to fade edges toward the cutoff instead of popping them.

**Focal pin.** One `count: 1` layer with `motion: { type: "static" }` and an
explicit `position`, `radius` in the `0.05 – 0.15` band, over a field of
`0.002`-scale entities. The size ratio between the two is what makes it read as
a subject rather than the largest member of the crowd — an order of magnitude
or more, which is the gap the ladder above shows between the field rungs and
the focal ones.

## Determinism contract

Entity construction consumes the seeded RNG in a **fixed draw order** per layer.
New optional fields only consume RNG draws when present, so adding features to
the format never changes the entity stream of an existing spec — a spec authored
against an older runtime renders bit-identically on a newer one
(`determinism-baseline.test.ts` guards this with snapshot streams).

The same discipline applies to **meaning**, not just RNG draws: a new field may
introduce a default, but a default must never *reinterpret* values that already
exist in published specs. Ship the field opt-in first, flip the default only in
a major, and write the stored-spec migration in the same change. (Learned the
hard way when 2.3.0's `units: "viewport"` default invalidated live channels —
see idle-server's G5 spec stamping, which now heals reads but can't excuse a
repeat.)

Positions are **analytic**: `positionAt(entity, t)` is a pure function, so
`renderFrame(t, seed)` can seek anywhere instantly, trails sample the past for
free, and streak headings derive from a finite difference. `ghosting` is the
one frame-coupled effect, and it preserves seekability by replaying a bounded
fixed-step warm-up (≤ 120 frames) from a full clear on any non-contiguous seek.

## Steering

Compiled specs accept live parameter changes via dot-paths —
`layers.0.count`, `layers.0.sprite.color`, `background.stops.0.color`, or
`key`-based paths like `cpu-gauge.count` / `cpu-gauge.sprite.color` when
layers declare `key` (the key replaces `layers.N`; everything after it
mirrors the JSON, so a sprite field keeps its `sprite.` segment). Changes interpolate over a
control-track (`step` | `linear` | `smooth`). Placement/motion changes trigger
a deterministic rebuild (same seed → same stream). See `@idle-screens/core`
for `ControlTrack` and the idlescreens.com MCP `setParam` tool.

## Seeing without eyes — the perception API

`src/perceive.ts` translates a spec into modalities a **non-vision agent** can
reason about, computed analytically from the entity model (no canvas, no
renderer, deterministic, Node-safe). Persistence is part of the picture:
`ghosting` is modeled as a decayed sum of past-frame splats (ink from m frames
ago survives at weight gᵐ, mirroring the renderer's warm-up replay) and `trail`
mirrors the renderer's past-position sampling — so the smear an audience sees
is measurable, not invisible, in every output below. Note: the analytical model
approximates but does not perfectly match canvas rendering — blend modes are
simplified (`screen` ≈ `lighter`), wrapped link segments use straight
interpolation, and background drift is sampled at rest. These are documented
trade-offs for a zero-dependency, renderer-free analysis tool.

- `perceiveScene(spec, {t?, viewport?, seed?})` — one-call bundle: everything below.
- `perceiveSequenceFrame(seq, T, {viewport?, seed?, releasedBelow?})` — the
  same bundle for one frame of a **sequence** at global time `T`: resolves the
  segment (reported as `segment: {index, key, localT, held?}`) and, when the
  sequence has a `bed`, composes the bed at `T` under the segment's ink at
  `localT` with the segment's background dropped, as the renderer stacks
  them — the grids add, dominance ranks both by raw weight with bed layers
  keyed `bed:<key|index>`, and text/motion/form list bed layers first.
- `luminanceGrid(spec, opts)` — an 80×48 luminance image of the composed frame
  (background gradient + entities + link lines, blend-aware), with coverage,
  visual-mass centroid, and **row/column deviation profiles** (1D transects of
  the composition).
- `renderBrailleMap(grid)` — the compact picture: 12 lines × 40 braille chars,
  each char a 2×4 dot cell, ordered-dithered with auto-exposure. An agent reads
  the whole frame at once instead of reconstructing it entity by entity.
- `renderDensityMap(grid)` — a **higher-fidelity** picture: one ASCII density
  char (`  .:-=+*#%@`) per grid cell, so it's 1:1 with the grid. Pair with a
  larger `cols`/`rows` (e.g. `{cols: 120, rows: 48}`) to resolve structure the
  braille map smears — concentric rings, grids, text blocks. This is the sharper
  read when composition detail matters.
- `dominanceRanking(spec, opts)` — layers ranked by estimated visual weight
  (area × alpha × contrast × glow/motion boosts; links and persistence ink —
  trail ribbons, ghosting smear — count) — *where the eye goes*, normalized to
  shares. Thin-but-bright structures (rings, streaks, link lines) get a
  line-salience boost so they aren't crushed by filled discs.
- `motionStats(spec, opts)` — per-layer mean/max on-screen speed from analytic
  displacement — choreography as numbers.
- `layerCohesion(spec, opts)` — **does a layer read as one form or as N marks?**
  The luminance maps measure ink, not edges, so a layer whose sprites merged
  into a silhouette and one that stayed a pile of discs are identical in every
  other channel. Two independent facts, both reported (also on
  `perceiveScene().form`): `overlap` is geometry — the mean fraction of an
  entity's outline buried inside a sibling (shipped particle fields measure
  ≤ 0.154; a packed silhouette measures 0.79–0.85; `null` for lines, glyphs and
  text, where a merged silhouette is not a meaningful idea). `seamless` is
  paint — whether those overlaps vanish or draw an internal edge, with
  `seamCause` naming the field to change. `reads` combines them into `mass`,
  `seamed` or `marks`.
- `textSprites(spec, opts)` — the literal strings and rendered sizes of every
  text layer. Glyphs are invisible in the luminance maps, so this is the only
  way to confirm *what words* are on screen and how big. (Also on
  `perceiveScene().text`.)
- `adviseSpec(spec)` — non-blocking advisories (also on
  `perceiveScene().advisories`). Two of them are **spatial**, for static text:
  `text-off-screen` (a text/textBlock box crosses the viewport edge by more
  than 1%) and `text-overlap` (two static text layers share more than 10% of
  the smaller box; it carries both boxes as `boxes: [{x, y, w, h}]` in
  viewport fractions so the fix needs no re-derivation). Boxes come from the
  same character-class width table the textBlock line-breaker uses, so they
  are estimates of the renderer's own layout — a caption that fails these
  will look wrong on the wall; one that passes may still sit a few px off.
  Two more are **opt-in** through the text sprite's `role: "read"` (see the
  `textBlock` sprite): `text-legibility` (WCAG ratio below 4.5:1 against the
  background at the box centre or under the brightest additive layer that can
  sit beneath the line) and `text-safe-area` (the box within 5 % of an edge,
  with its box in `boxes`). Undeclared text is never measured for either.
  `overlap-seams` catches the trap the other channels are blind to: a layer
  whose entities bury each other (so it was drawn as one shape) but whose paint
  settings make every overlap visible. It is gated to stay off deliberate
  washes — it needs at least 6 entities and a mean base alpha of 0.45, and
  never fires under `blend: lighter` / `screen`. No shipped example trips it.
  The two density advisories read the spec's declared `density` first:
  `sparse-scene` is withheld under `density: "sparse"` and `dense-scene`
  under `"dense"`, and `density-mismatch` fires instead when the measured
  coverage contradicts the declaration (a "sparse" scene covering more than
  2 % of the frame, a "dense" one that would have read as empty).
- `diffScenes(a, b, opts)` — **relative sight**: coverage/luminance deltas,
  visual-balance shift, 3×3 region deltas, dominance-rank movement, and
  advisory codes added/removed. Agents judge "is B better than A" far more
  reliably than "is A good"; this is the edit loop's primary instrument.

Coverage is **additive-glow-calibrated**: soft circles drawn with
`blend: lighter`/`screen` bloom past their radius (as they do on the real
canvas), so `coverage` tracks what the audience sees instead of under-reporting
glow-heavy scenes by an order of magnitude.

Known approximations (deliberate): trails and ghosting are not sampled, text ink
is estimated from font size × string length. Good enough to perceive
composition, focus, balance, and motion — not a substitute for a human (or VLM)
judgement of beauty.

## Sequence envelope (`idle-sequence`)

A second top-level format that composes multiple SaverSpecs into a sequenced
timeline. Discriminated from SaverSpec by `format: 'idle-sequence'`.

```jsonc
{
  "format": "idle-sequence",
  "schemaVersion": 1,
  "id": "my-sequence",
  "label": "My Sequence",
  "seed": 42,           // optional; forwarded to children without their own seed
  "loop": false,
  "sync": "mount",      // optional; 'mount' (default) or 'epoch' — see **Sync**
  "bed": { /* SaverSpec */ },  // optional; the ground under every segment — see **Bed**
  "segments": [
    { "key": "intro",  "scene": { /* SaverSpec */ }, "duration": 5000 },
    { "key": "main",   "scene": { /* SaverSpec */ }, "duration": 10000, "advance": "auto" },
    { "key": "outro",  "scene": { /* SaverSpec */ } }  // durationless: holds forever
  ]
}
```

**Segments:** 1–24 segments, each carrying an unmodified SaverSpec. Keys must
be unique. Duration is in milliseconds (minimum 1000 ms for flash safety). Only
the final segment may omit duration (holds indefinitely).

**Advance mode:** `auto` (default) and `either` advance on the timer. `input`
makes a timed segment **hold** at the end of its `duration` until a
`sequence.segment` steer releases it — the clicker (see Steering below). The
held scene keeps animating (its `localT` keeps growing), so a slide waiting for
the presenter never freezes. A durationless final segment holds regardless of
`advance`.

**Transitions:** `{ type: 'cut' }` (default) performs a hard switch.
`{ type: 'morph', dur: number, text?: 'step' | 'crossfade' }` interpolates
**numbers and hex colours** (colour, alpha, pulse, `reveal.progress`, …) over
`dur` ms when crossing into the next segment; **every other value — strings,
and `textBlock.text` above all — switches on the first morph frame** under
the default `text: 'step'`. A caption change therefore does not cross-fade
under a plain morph: fade text via its colour (glide it into the background
and back), via `reveal.progress` — or declare **`text: 'crossfade'`**, which
draws each `text` / `textBlock` layer whose string(s) differ between the two
segments **twice** for the window: the outgoing words at alpha `1 − k` under
the incoming at `k`, where `k` is the morph's eased progress, both in the
lerped frame's paint (colour, `opacity` and layer alpha glide as usual). Only
the differing text layers cost a second draw, and only for `dur`; layers
whose words match, and every non-text layer, are untouched. It is an
internal paint pass, not a spec field — no `opacity` appears on the `text`
sprite. `text` is a morph option only (a `fade` already cross-fades whole
frames; a `cut` has no window) and the validator rejects it elsewhere.
**Default `step` is today's behaviour byte for byte** — the sequence
baseline pins it — and a flip to `crossfade` by default would be a major
change, with the baseline regenerated. **Native:** tvOS **steps** the words (it
ignores `text`) but already cross-fades whole frames on every segment
change using the transition's `dur`, so the result on the Apple TV is
close to the web's. Morph requires structurally
identical adjacent segments (same `structuralSignature`); if they differ, the
engine falls back to cut and the validator emits a `morph-structural-mismatch`
warning. When the segments are structural twins whose only differences are
values morph steps (a text-only change), the morph runs but every frame of it
shows the incoming segment — it reads as a cut — and the validator emits a
`morph-nothing-morphable` warning (never an error; stored sequences stay
valid) — unless the transition declared `text: 'crossfade'` and the words
differ, in which case the words are the thing that morphs and the warning is
withheld. During a morph, entity placement inherits the outgoing segment's
seed — the incoming segment's own seed is unused. `dur` must be between 200
and 5000 ms.

`{ type: 'fade', dur: number }` is the general cross-fade, for segments that
have nothing in common: the outgoing segment stays alive on a canvas of its
own for `dur` ms and is composited over the incoming one at
`1 − easeSmooth(localT / dur)`, so both keep animating through the window. The
outgoing segment renders at `duration + localT` — it continues rather than
freezing (and if it was an `advance: 'input'` hold, it resumes from its
`duration`, not from wherever the hold had reached). A fade is always from the
previous segment in the list; under `loop: true` the **last** segment's `fade`
is the wrap's transition into segment 0. It works through the clicker too — a
`sequence.segment` steer lands at `localT` 0 of the fade. Same `dur` bounds
as morph, no structural requirement, and a fade only smooths luminance, so the
flash gate is untouched; it is the remedy for a `boundary-luminance-jump`
advisory. **Tier gate:** two live segments for `dur` is over the budget of the
lowest tiers, so a host on the `basic` (canvas2d only) or `minimal` capability
tier — passed as `capabilityTier` on the `SequenceMountContext`, the tier
`computeTier` from `@idle-screens/capabilities` reports — renders `fade` as
`cut`; absent ⇒ fade enabled. `adviseSequence` says so once per sequence with
the informational `fade-degrades-on-low-tier`. **Native:** tvOS already
cross-fades on every segment change using the transition's `dur`, so `fade`
matches the native player rather than diverging from it; native reads
`fade.dur` where it reads the morph `dur` today.

**Time mapping:** global clock `T` maps to `(segmentIndex, localT)` via prefix
sums of durations. Half-open segments: `[start, start+duration)`. With
`loop: true`, `T` wraps at the sum of all durations (loop is incompatible with
a durationless final segment). An unreleased `advance: 'input'` hold blocks the
wrap; after a wrap every hold is armed again.

**Sync:** `sync` names what the sequence clock is anchored to. `mount`
(the default, and today's behaviour for every stored sequence) starts `T` at
0 when the viewer mounts — every joiner sees segment 0, which is what makes a
pre-roll a pre-roll. `epoch` lets the host seed the clock: the viewer passes
`sequenceBaseT` (ms already elapsed on the shared clock — idlescreens.com
passes `Date.now() − scene.epoch`) on the mount context
(`SequenceMountContext`, a `SaverContext` plus that one field), and the
instance starts at that `T` instead of 0, so every screen in a room resolves
the same segment. The trade-off: a viewer joining an `epoch` sequence lands
**mid-loop**, wherever the room is; `mount` keeps pre-roll semantics. Holds
are the same under both — `advance: 'input'` is armed for every viewer, so a
late joiner whose seeded clock is already past an unreleased hold lands **on**
the held segment (still animating), not past it, and the clicker releases it
from there. `epoch` without a `sequenceBaseT` starts at 0 (a host that does
not pass the hint loses nothing). **Native clients that anchor at their own
mount behave as `mount`** until they read the field and seed from the channel
epoch. The default is never flipped: pre-roll depends on `mount`.

**Bed:** `bed` is one SaverSpec drawn **under every segment on the
sequence's global clock** — the ground that does not reset. Every segment still
starts at its own `localT` 0 (builds replay, `emit` phases and `reveal.speed`
key off segment time exactly as before), but the bed's `T` runs from mount (or
from `sequenceBaseT` under `sync: 'epoch'`) straight through every boundary,
and a `sequence.segment` steer displaces the *segments'* clock only — the
clicker rewinds a slide, never the bed. That is the fix for the boundary
rewind every ambient reviewer flagged: put the motion that must be continuous
(the drifting field, the runner-orb, the slow gradient) in the bed and the
slide content in the segments. Rules:

- **The bed owns the ground.** Segments render over it *transparently*: a
  segment's `background` is never painted while a bed exists (the validator
  warns `bed-hides-segment-background` on each segment that declares one), and
  a segment's `ghosting` is ignored (a smear needs an opaque ground to decay
  into; the bed may declare its own `ghosting`, and it works as usual). A
  segment's ink composites over the bed with its own `blend`/`alpha`.
- **Clock:** bed at `T`, segment at `localT`, in the same frame. Under
  `loop: true` the bed does not wrap with the segments — it keeps counting.
- **Steering:** `bed.<path>` routes to the bed with the prefix stripped
  (`setParam("bed.field.sprite.color", …)`, `bed.ghosting`, …);
  `sequenceSteerablePaths(seq)` lists them. Without a bed, `bed.*` reaches the
  segments unchanged, so a layer keyed `bed` keeps working. Bed steers are
  not part of the retained segment track — the bed is never re-created.
- **Seed:** the bed uses its own `seed`, else `seq.seed + 24` (past every
  segment's `seq.seed + index`, so it never shares a stream with segment 0 and
  adding a segment does not re-seat it).
- **Perf accounting:** the bed is live alongside whichever segment is up, so
  its entities count **together with the largest segment's** toward the 800
  cap (`validateSequence` errors on `bed` when the sum is over) and toward the
  manifest's `costTier`. A `fade` over a bed puts both segments on canvases of
  their own for `dur` (incoming at k, outgoing at 1 − k, both over the bed):
  three live instances on the lowest tier, which is why fade is tier-gated.
- **Perception:** `perceiveSequenceFrame(seq, T)` composes bed + segment (see
  the perception API above). Bed and segments are assumed to share `units` /
  `referenceViewport`.
- **Native:** tvOS **ignores `bed` initially** and renders segments with their
  own backgrounds, exactly as it does today — so a sequence authored with a bed
  should still carry sensible segment backgrounds until the native player
  draws the bed (a second compiled scene drawn first, which its layer model
  already supports). Web viewers hide those backgrounds; native shows them.
- **Not a default.** The "cheap form" — rendering a morph chain's root child at
  `T − segmentStart(chainRoot)` so twins keep one continuous clock — is **not**
  implemented and never will be as a default: stored morph-chained sequences
  pin their per-segment `t = 0` frames (`sequence-baseline.test.ts`). A bed is
  the supported way to keep motion continuous across segments; if a per-segment
  `timebase: 'sequence'` is ever wanted it will be opt-in, after this.

Absent `bed` ⇒ the code path is byte for byte what it was (the sequence
baseline proves it): every segment paints its own ground.

**Compilation:** `compileSequence()` returns an ordinary `SaverPlugin` — the
viewer needs zero changes (a host that wants `sync: 'epoch'` passes a
`SequenceMountContext`; a plain `SaverContext` still mounts). All children
share a single canvas; only the active segment's `SpecInstance` is alive at
any time — plus the `bed`'s, when one is declared, and for the `dur` of a
`fade` the outgoing segment on an offscreen canvas of its own. `workerReady`
is `false` (the worker compile-hook does not dispatch sequences).

**Steering:** segment switching uses the `sequence.segment` delta path via
`applyTrack` (`setParam("sequence.segment", n)` over MCP). The
`SequenceInstance` intercepts this path before delegation, and `bed.<path>`
deltas go to the bed (see **Bed**); every other delta
is forwarded to the active segment's `applyTrack` **and retained** (last wins
per path, merged across calls). Segment instances are created lazily and
disposed at each boundary, so the retained set is re-applied to every segment
as it comes up: **a steer persists across segment changes and lands on the
segment that owns the path.** `bars.sprite.values` steered while the title
slide is up takes effect the moment the chart slide appears (by timer or by
clicker), and stays if the show leaves and returns; on segments without a
`bars` key the delta is simply a no-op, as is any delta whose value does not
validate on that particular segment (the rest of the set still applies). A
morph's two lerp endpoints carry the retained set too, so a steered colour
rides through the glide instead of vanishing for `dur` — but a steer that
lands while the morph itself is in progress takes effect immediately rather
than gliding over its own `dur`, since the morph's cross-fade is already the
active transition on that child. Pinned by `sequence.test.ts` →
"SequenceInstance — retained track".

The steer **moves the clock, not the frame**: it displaces the timeline so the
target segment starts at its own `localT` 0 (its `life.enter` build replays)
and then runs on the timer from there — the next animation frame resolves to
the same segment instead of snapping back to the wall clock. A steer to
segment `n` also counts as the presenter clicking past every `advance: 'input'`
hold before `n`; holds at and after `n` stay armed, so steering backwards
re-arms the ones in between. This is the whole clicker: a deck is a sequence
whose slides carry `advance: 'input'`, and "next" is one `setParam`. Pinned by
`sequence.test.ts` → "sequence.segment steering is sticky" and
"advance: 'input' holds until released".

**Seed:** `seq.seed` is forwarded to children that lack a scene-level seed
(offset by segment index for independence). Children with their own seed are
unaffected.

**Hot-swapping a republished sequence:** the instance `compileSequence().mount()`
returns is a `SequenceSaverInstance` with `hotSwapSequence(next): boolean`
(feature-detect with `hasHotSwapSequence(inst)`; an older engine's instance
has no such method). When the republished sequence is
`sequenceSwapCompatible` with the running one — the same number of
segments, every segment's scene a structural twin (`structuralSignature`) of
its counterpart with the same render seed, a `bed` on both sides or neither
(twins, same seed), the same `loop` and `sync`, and the same `duration`,
`advance` and `transition` on every segment — the swap happens in place:
every live segment child and the bed take their new scene, the clock, the
active segment, every released hold and the retained track stay exactly
where they were (steered paint is re-applied on top of the republished
scene), and the next frame resolves to the same `(segment, localT)` with
every entity where it was a frame ago. Paint is free: words, colours, alpha,
`background`, ids, labels, segment keys. A structural edit (a layer added,
a count or motion changed), a timing edit (a duration — it would move every
later boundary under a clock that keeps running — an `advance`, a
transition's type or `dur`), a seed, `loop` or `sync` change, or a bed added
or removed returns `false` and changes nothing; the host remounts then, as
it always has. idle-server's viewer wires this so a mid-talk caption fix does
not send every screen in the room back to segment 0. Pinned by
`sequence.test.ts` → "SequenceInstance — hotSwapSequence".

## Examples

Shipped working specs (also exposed as `EXAMPLE_SPECS` /
`SCHEMA_EXAMPLES`): `aquarium`, `rain`, `snowfall`, `lanterns`, `sakura`,
`dev-dashboard`, `orrery`, `constellation`, `comets`, plus the v1-ceiling
showcases — `aurora` (wander + coherence + ghosting + pulse.wave),
`warp-tunnel` (warp + streaks), `polygons` (chain links + heavy ghosting),
`matrix-rain` (grid layout + glyph cycle + ghosting), and `procession`
(path + layer-parented orbit + life staging + ring/rect sprites);
`nostalghia-candle` and `haiku` (restraint and text); and the 2026-09 trio —
`pings` (emit + grow + ease: one event at a time), `facets` (polygon, stroke
and feathered rect) and `relay-board` (list layout + bar: a chart in five
layers); and `lobby-talk` (one screen of a quarter-in-review, every text
layer `role: "read"`, zero advisories — readable copy over additive
atmosphere). See [`src/examples/`](./src/examples/). The dashboard exercises the
static/HUD subset at scale (34 layers of keyed, positioned text).
