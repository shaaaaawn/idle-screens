# SaverSpec — Format Specification (version 1)

The declarative, agent-authorable screensaver format compiled by
`@idle-screens/schema`. A spec describes a saver as **data** — a static
background plus layers of moving sprites — which `compileSaver()` turns into a
seeded, deterministic, flash-safe `SaverPlugin`. There is no code in a spec: no
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
`align`, `baseline`, `maxWidth` (text sprites).

## Safety invariants

These hold **by construction** — no spec can violate them:

1. **No flash primitive.** The background is static and entities are bounded
   sprites, so a compiled spec cannot strobe the full field. Provable by
   sampling any compiled spec through `@idle-screens/validator`.
2. **Pulse is bounded.** Opacity breathing amplitude is capped at 0.5 and its
   period floored at 500 ms (2 Hz — under the WCAG 3 Hz flash threshold), and
   every entity gets its own seeded phase, so a layer can never pulse in unison.
3. **Motion is bounded.** Speeds are capped at 4000 px/sec.
4. **Work is bounded.** ≤ 36 layers, ≤ 400 entities per layer, ≤ 800 total.
5. **Determinism.** All randomness comes from a seeded PRNG. Same spec + same
   seed ⇒ identical entity streams and identical frames at any time `t`
   (compiled savers expose `renderFrame(t, seed)`).

## Validation semantics

Two validators exist with deliberately different strictness:

| | unknown fields | everything else |
|---|---|---|
| `saver-spec.schema.json` | **rejected** (catches authoring typos) | identical |
| `validateSpec()` (runtime) | **ignored** (forward compatibility) | identical |

Author against the JSON Schema; ship through the runtime validator.

Two rules the JSON Schema cannot fully express (the runtime enforces them):
total entities across all layers ≤ 800, and every `[min, max]` range must
satisfy `min ≤ max`.

## Structure

```jsonc
{
  "schemaVersion": 1,
  "id": "snowfall",              // unique kebab-case id
  "label": "Snowfall",
  "seed": 42,                    // optional; falls back to the host's seed
  "motionIntensity": "calm",     // optional: calm | moderate | energetic
  "background": { ... },         // optional; defaults to black
  "layers": [ { ... }, ... ]     // 1..36, rendered back-to-front
}
```

### `background`

- `{ "type": "solid", "color": "#06060c" }`
- `{ "type": "gradient", "stops": [{ "at": 0, "color": "#06121e" }, { "at": 1, "color": "#0d2436" }], "band": { "color": "#3a2d18", "height": 90 } }`
  — vertical gradient (`at` 0 = top → 1 = bottom); optional solid `band` at the
  bottom (e.g. an aquarium seafloor). All colours are hex (`#rgb` / `#rrggbb`).

### `layers[]`

| Field | Type | Default | Meaning |
|---|---|---|---|
| `count` | int 1..400 | — | entities in this layer |
| `sprite` | SpriteSpec | — | what each entity looks like |
| `motion` | MotionSpec | — | how entities move |
| `size` | `[min,max]` px > 0 | sprite-dependent | font size for emoji/text; ignored for circle |
| `wrap` | boolean | `true` | wrap to the opposite edge when leaving the viewport |
| `flip` | boolean | `false` | mirror the sprite to face its heading |
| `alpha` | `[min,max]` 0..1 | `[1,1]` | per-entity opacity range |
| `blend` | `"lighter"` | source-over | additive compositing (glow stacking) |
| `region` | `{x?, y?}` ranges 0..1 | full viewport | fractional spawn window (placement only, not travel) |
| `pulse` | `{amp ≤ 0.5, period ≥ 500}` | none | seeded-phase opacity breathing |
| `key` | string | none | addressable name → `setParam("key.field", …)` |
| `position` | `{x, y}` 0..1 | none | exact placement; **requires `count: 1`**; overrides `region` |

### `sprite` (one of)

- `{ "kind": "emoji", "glyphs": ["🐟", "🐠"] }` — glyph picked per entity (seeded)
- `{ "kind": "text", "strings": ["HELLO"], "color": "#e6e8ef", "font": "bold 24px monospace", "align": "center", "baseline": "middle", "maxWidth": 300 }`
- `{ "kind": "circle", "radius": [1, 3], "color": "#ffffff", "soft": true }` —
  `soft` renders a radial-falloff glow orb instead of a hard disc

### `motion` (one of)

- `{ "type": "drift", "speed": [20, 60], "angle": 0, "bidirectional": true, "bob": 4 }`
  — heading in degrees (0 = right, 90 = down); `bidirectional` flips horizontal
  direction per entity (fish); `bob` adds vertical wobble (px)
- `{ "type": "rise", "speed": [10, 30], "sway": 6 }` — upward, with horizontal sway (bubbles)
- `{ "type": "bounce", "speed": [120, 240] }` — diagonal, reflecting off edges
- `{ "type": "static" }` — stays exactly where placed (use with `position` for HUD text)

All speeds are px/sec ranges; each entity draws its own value (seeded).

## Determinism contract

Entity construction consumes the seeded RNG in a **fixed draw order** per layer.
New optional fields only consume RNG draws when present, so adding features to
the format never changes the entity stream of an existing spec — a spec authored
against an older runtime renders bit-identically on a newer one.

## Steering

Compiled specs accept live parameter changes via dot-paths —
`layers.0.count`, `background.stops.0.color`, or `key`-based paths like
`cpu-gauge.color` when layers declare `key`. Changes interpolate over a
control-track (`step` | `linear` | `smooth`). See `@idle-screens/core` for
`ControlTrack` and the idlescreens.com MCP `setParam` tool.

## Examples

Shipped working specs (also exposed as `EXAMPLE_SPECS`): `aquarium`, `rain`,
`snowfall`, `lanterns`, `sakura`, `mystify`, `dev-dashboard` — see
[`src/examples.ts`](./src/examples.ts). The dashboard exercises the static/HUD
subset at scale (34 layers of keyed, positioned text).
