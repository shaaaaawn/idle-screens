# Cold-Agent Authoring Prompt

> **Purpose:** Give this prompt to a fresh agent session (no prior context) pointed
> at `~/code/idle-screens` to test whether the SaverSpec format is self-describing
> enough for cold authoring. This is gating experiment #2 from the
> [roadmap](./roadmap.md#6-sequencing-honestly-two-experiments-before-any-milestone).

---

You are authoring a screensaver as pure JSON data. The format is called SaverSpec.
Your job: invent an original, beautiful screensaver composition and write it as a
SaverSpec. Pick any theme you find compelling — nature, space, city, abstract, seasonal.

## The format

A SaverSpec is a JSON object with this shape:

```
{
  schemaVersion: 1,
  id: string,              // unique kebab-case
  label: string,           // human-readable name
  seed?: number,           // deterministic RNG seed (pick any integer)
  motionIntensity?: 'calm' | 'moderate' | 'energetic',
  background?: solid | gradient,
  layers: LayerSpec[]      // 1-8 layers, painted in order (last = front)
}
```

Background: `{ type: 'solid', color: '#hex' }`
or `{ type: 'gradient', stops: [{ at: 0-1, color }, ...], band?: { color, height } }`
(gradient is top-to-bottom; band is a solid strip at the bottom)

Layer:

```
{
  count: number,           // entities in this layer
  sprite: SpriteSpec,
  size?: [min, max],       // px (font size for emoji/text; ignored for circle)
  motion: MotionSpec,
  wrap?: boolean,          // default true — entities re-enter from the opposite edge
  flip?: boolean,          // face the direction of travel
  alpha?: [min, max],      // per-entity opacity, both 0..1
  blend?: 'lighter',       // additive compositing (glow stacking)
  region?: { x?: [0-1, 0-1], y?: [0-1, 0-1] },  // constrain spawn area
  pulse?: { amp: number, period: number }          // opacity breathing (see limits)
}
```

Sprites:

```
{ kind: 'emoji', glyphs: ['🏮', '⭐'] }            // random pick per entity
{ kind: 'text', strings: ['hello'], color?, font? }
{ kind: 'circle', radius: [min, max], color: '#hex', soft?: boolean }
  // soft = radial gradient falloff (glow orb)
```

Motion:

```
{ type: 'drift', speed: [min, max], angle?: deg, bidirectional?: bool, bob?: px }
  // 0=right, 90=down. bob = vertical wobble
{ type: 'rise', speed: [min, max], sway?: px }      // upward + horizontal sway
{ type: 'bounce', speed: [min, max] }                // diagonal, reflects off edges
```

## Limits (enforced by validator)

- maxPerLayer: 400, maxTotal: 800, maxLayers: 8, maxSpeed: 4000 px/sec
- pulse amp <= 0.5, pulse period >= 500ms (so max 2Hz, under WCAG's 3Hz flash line)
- Each entity gets a seeded random phase for pulse — a layer can't strobe in unison.

## Key rendering behaviors

- Entities spawn at random positions within their region (default: full viewport).
- Each entity gets a random speed from the [min,max] range, random size, random alpha.
- ALL randomness is seeded — same seed = identical scene every time.
- Layers paint in order: layer 0 is behind, last layer is in front.
- `blend: 'lighter'` makes overlapping sprites ADD their light (great for glows/stars).
- Depth illusion: use correlated parallax — farther layers have SMALLER, SLOWER,
  DIMMER, LESS-SWAYING entities. Closer layers are bigger, faster, brighter, more sway.

## What to do

1. Read `packages/schema/src/examples.ts` to see existing specs (aquarium, rain,
   snowfall, lanterns) for reference.
2. Invent your own original theme — don't duplicate an existing one.
3. Add your spec to `examples.ts` and the `EXAMPLE_SPECS` array.
4. Wire it into the playground:
   - `apps/playground/src/main.ts` — add `compileSaver(YOUR_SPEC)` to `ALL_SAVERS`
   - `apps/playground/src/schema-panel.ts` — add import, button, handler, examples entry
   - `apps/playground/e2e/savers.spec.ts` — add id to `ALL_IDS`, update count
   - `docs/specs/behavior-contract.md` — update saver count
5. Run: `pnpm build && pnpm test && pnpm test:e2e`
6. Start the dev server (`pnpm dev`) and verify it looks good in the browser.

Aim for beauty through composition, not brute force. The best specs use 3-6 layers
with correlated depth cues to create a sense of space from simple primitives.
