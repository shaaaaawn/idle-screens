# Saver Benchmark Prompts

Three prompts for evaluating LLM creative output against the idle-screens
schema format. Two variants of the creative benchmark (MCP vs standalone),
plus a follow-up that elicits format feedback for the roadmap.

---

## Prompt 1a — Creative Benchmark (MCP)

For models with idle-screens MCP access. The model discovers the schema and
examples via tools, previews its work, and publishes live.

```
You have access to idle-screens MCP tools that let you design and publish live screensavers. Your goal: create an original, visually compelling screensaver and publish it.

## Workflow

1. **Learn the format.** Read the `screen://schema` resource — it contains the full SaverSpec format reference, all sprite types, motion types, and composition tips. Read `screen://examples` for inspiration (but don't copy them).

2. **Design your scene.** Think about what would be mesmerizing to watch for minutes. The format supports layered sprite fields with parallax depth, glowing orbs, trails, orbital motion, breathing effects, and inter-entity links. The best scenes combine restraint with atmosphere — 50–200 total entities, 3–6 layers, coherent color palette.

3. **Preview before publishing.** Use `previewScene` to render your spec as a static SVG. Check composition, density, and color. Iterate — adjust sizes, speeds, alpha, and layer counts until it looks right. Preview at t=0 and t=5 to see how motion distributes entities.

4. **Publish.** When you're happy, use `publishScene` to push it live to the "studio" channel. Include your `model` name and a brief `intent` describing your creative vision. Fetch the `thumbUrl` from the response to see a live render.

## Composition guidance

- **Parallax depth:** Back layers = many small, slow, dim. Front layers = few large, fast, bright.
- **Glow stacking:** `soft: true` + `blend: "lighter"` = overlapping orbs glow brighter (nebulae, aurora).
- **Trails:** Best on fast entities (comets, shooting stars). Creates afterglow behind movement.
- **Region:** Use `region` to create geography — ground fog, horizon lines, sky-only stars.
- **Color harmony:** 3–5 colors from a coherent palette. Background gradient sets the mood.
- **Restraint > density.** Negative space is your friend.

## Your task

Design something original — not a starfield, not a constellation, not a remix of what you see in the examples. Something with its own concept, mood, and visual identity.

Before publishing, write a brief creative statement (2–3 sentences: what is this scene, what mood does it evoke, why is it worth watching).
```

---

## Prompt 1b — Creative Benchmark (standalone)

For models without MCP access. Self-contained with the full schema, two
example specs, and an open creative brief. Paste into ChatGPT, Gemini,
Mistral, etc.

```
You are designing a screensaver. Your output is a single JSON object conforming to the SaverSpec schema below. The runtime compiles your JSON into a real, running screensaver — no code, just data.

## The format

A SaverSpec describes layers of sprites over a background. The runtime handles rendering, seeded randomness, and animation. Your job is to compose something visually compelling.

### JSON Schema

{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "SaverSpec (format version 1)",
  "description": "Declarative screensaver: background + layers of moving sprites. All randomness is seeded — same spec + seed = identical frames.",
  "type": "object",
  "required": ["schemaVersion", "id", "label", "layers"],
  "additionalProperties": false,
  "properties": {
    "schemaVersion": { "const": 1 },
    "id": { "type": "string", "pattern": "\\S", "description": "Unique kebab-case id." },
    "label": { "type": "string", "description": "Human-readable name." },
    "seed": { "type": "number", "description": "RNG seed. Same seed = identical output." },
    "motionIntensity": { "enum": ["calm", "moderate", "energetic"] },
    "background": {
      "oneOf": [
        { "type": "object", "required": ["type", "color"], "properties": { "type": { "const": "solid" }, "color": { "type": "string", "pattern": "^#[0-9a-fA-F]{6}$" } } },
        { "type": "object", "required": ["type", "stops"], "properties": {
          "type": { "const": "gradient" },
          "stops": { "type": "array", "minItems": 2, "items": { "type": "object", "required": ["at", "color"], "properties": { "at": { "type": "number", "minimum": 0, "maximum": 1 }, "color": { "type": "string" } } } },
          "band": { "type": "object", "properties": { "color": { "type": "string" }, "height": { "type": "number" } } },
          "drift": { "type": "object", "required": ["period"], "properties": { "period": { "type": "number", "minimum": 10000, "description": "Slow oscillation of gradient stops in ms." }, "amount": { "type": "number", "maximum": 0.3, "description": "How far stops shift. Default 0.15." } } }
        } }
      ]
    },
    "layers": { "type": "array", "minItems": 1, "maxItems": 36, "items": { "$ref": "#/definitions/layer" } }
  },
  "definitions": {
    "layer": {
      "type": "object",
      "required": ["count", "sprite", "motion"],
      "properties": {
        "count": { "type": "integer", "minimum": 1, "maximum": 400, "description": "Entities in this layer. Max 800 total across all layers." },
        "sprite": { "oneOf": [
          { "properties": { "kind": { "const": "emoji" }, "glyphs": { "type": "array", "items": { "type": "string" } }, "cycle": { "type": "object", "required": ["period"], "properties": { "period": { "type": "number", "minimum": 500 } } } } },
          { "properties": { "kind": { "const": "text" }, "strings": { "type": "array", "items": { "type": "string" } }, "color": { "type": "string" }, "font": { "type": "string" }, "cycle": {} } },
          { "properties": { "kind": { "const": "circle" }, "radius": { "description": "[min, max] px" }, "color": { "type": "string" }, "soft": { "type": "boolean", "description": "Radial glow falloff instead of hard disc." }, "colors": { "type": "array", "items": { "type": "string" }, "description": "Per-entity color palette (seeded pick)." } } }
        ] },
        "motion": { "oneOf": [
          { "properties": { "type": { "const": "drift" }, "speed": { "description": "[min,max] px/sec, max 4000" }, "angle": { "description": "Degrees: 0=right, 90=down" }, "bidirectional": { "type": "boolean" }, "bob": { "description": "Vertical wobble amplitude in px" } } },
          { "properties": { "type": { "const": "rise" }, "speed": { "description": "[min,max] px/sec" }, "sway": { "description": "Horizontal sway in px" } } },
          { "properties": { "type": { "const": "bounce" }, "speed": { "description": "[min,max] px/sec" } } },
          { "properties": { "type": { "const": "static" } } },
          { "properties": { "type": { "const": "orbit" }, "speed": { "description": "[min,max] deg/sec, max 180" }, "radius": { "description": "[min,max] px" }, "center": { "properties": { "x": {}, "y": {} }, "description": "Fractional position. Default {0.5, 0.5}." } } }
        ] },
        "size": { "description": "[min, max] px for emoji/text sprites" },
        "alpha": { "description": "[min, max] opacity 0..1" },
        "blend": { "const": "lighter", "description": "Additive compositing (glow)." },
        "region": { "properties": { "x": {}, "y": {} }, "description": "Fractional spawn window, e.g. { y: [0.8, 1] } for bottom 20%." },
        "pulse": { "properties": { "amp": { "maximum": 0.5 }, "period": { "minimum": 500 } }, "description": "Sinusoidal opacity breathing. Per-entity seeded phase." },
        "spin": { "description": "Rotation speed in deg/sec, -360..360." },
        "grow": { "properties": { "amp": { "maximum": 0.8 }, "period": { "minimum": 500 } }, "description": "Sinusoidal size breathing." },
        "flip": { "type": "boolean", "description": "Flip sprite to face heading." },
        "wrap": { "type": "boolean", "description": "Wrap at edges. Default true." },
        "key": { "type": "string", "description": "Named handle for this layer." },
        "position": { "properties": { "x": {}, "y": {} }, "description": "Exact position (requires count: 1)." },
        "trail": { "properties": { "length": { "maximum": 5000 }, "fade": { "maximum": 1 } }, "description": "Afterglow trail in ms behind moving entities." },
        "links": { "properties": { "k": { "maximum": 8 }, "maxDist": {}, "color": {}, "alpha": {}, "width": {} }, "description": "Lines to k nearest neighbors within maxDist." }
      }
    }
  }
}

### Building blocks at a glance

| Feature | What it does | Good for |
|---------|-------------|----------|
| `drift` | Linear motion at an angle | Fish, toasters, rain (angle:90), diagonal streaks |
| `rise` | Upward + sway | Bubbles, lanterns, sparks, snow (slow) |
| `bounce` | Diagonal, reflects off edges | DVD logo, billiards, retro pong |
| `orbit` | Circular path around a center | Orreries, electrons, spirographs |
| `static` | Stays in place | Star fields, pinned focal points |
| `circle` + `soft` | Glowing orb with radial falloff | Nebulae, fireflies, bokeh, aurora |
| `blend: 'lighter'` | Additive compositing | Glow stacking, light effects |
| `trail` | Afterglow behind moving entities | Comets, shooting stars, firefly traces |
| `drift.bob` | Vertical wobble on drift | Floating, swimming, hovering |
| `pulse` | Opacity breathing | Stars twinkling, heartbeat, bioluminescence |
| `grow` | Size breathing | Jellyfish pulsing, breathing organisms |
| `spin` | Continuous rotation | Snowflakes, gears, windmills |
| `links` | Lines between nearby entities | Constellations, neural networks, webs |
| `background.drift` | Gradient stops oscillate slowly | Living sky, aurora background |
| `region` | Constrain spawn area | Horizon lines, ground layers, sky-only |
| `flip` | Face direction of travel | Fish, birds, vehicles |
| `colors` (on circle) | Per-entity color palette | Multi-colored particle fields |
| Layered depth | Small/slow/dim behind, large/fast/bright in front | Parallax, depth, atmosphere |

### Two examples for reference

**Night Lanterns** — parallax depth via layered size/speed/alpha:

{
  "schemaVersion": 1, "id": "lanterns", "label": "Night Lanterns", "seed": 88,
  "motionIntensity": "calm",
  "background": { "type": "gradient", "stops": [
    { "at": 0, "color": "#04060f" }, { "at": 0.55, "color": "#0b1026" },
    { "at": 0.85, "color": "#251731" }, { "at": 1, "color": "#472518" }
  ] },
  "layers": [
    { "count": 60, "sprite": { "kind": "circle", "radius": [0.5, 1.4], "color": "#8fa0c8" },
      "alpha": [0.35, 1], "region": { "y": [0, 0.62] },
      "motion": { "type": "drift", "speed": [0.5, 2], "bob": 1 } },
    { "count": 36, "sprite": { "kind": "circle", "radius": [1.5, 3], "color": "#b06a2a", "soft": true },
      "alpha": [0.5, 0.9], "blend": "lighter", "pulse": { "amp": 0.18, "period": 2800 },
      "motion": { "type": "rise", "speed": [6, 14], "sway": 4 } },
    { "count": 14, "sprite": { "kind": "circle", "radius": [3.5, 6.5], "color": "#e08a34", "soft": true },
      "alpha": [0.6, 1], "blend": "lighter", "pulse": { "amp": 0.22, "period": 3400 },
      "motion": { "type": "rise", "speed": [16, 28], "sway": 7 } },
    { "count": 8, "sprite": { "kind": "emoji", "glyphs": ["🏮"] }, "size": [26, 44],
      "alpha": [0.85, 1], "motion": { "type": "rise", "speed": [30, 48], "sway": 10 } },
    { "count": 4, "sprite": { "kind": "emoji", "glyphs": ["🏮"] }, "size": [58, 84],
      "motion": { "type": "rise", "speed": [52, 74], "sway": 14 } },
    { "count": 12, "sprite": { "kind": "circle", "radius": [2, 5], "color": "#e08a34", "soft": true },
      "alpha": [0.12, 0.35], "blend": "lighter", "region": { "y": [0.93, 1] },
      "pulse": { "amp": 0.1, "period": 2200 }, "motion": { "type": "drift", "speed": [2, 6], "bob": 2 } }
  ]
}

**Comet Shower** — trails and background drift:

{
  "schemaVersion": 1, "id": "comets", "label": "Comet Shower", "seed": 42,
  "motionIntensity": "moderate",
  "background": { "type": "gradient", "stops": [
    { "at": 0, "color": "#0a0015" }, { "at": 0.5, "color": "#0d1b2a" }, { "at": 1, "color": "#1b0a2e" }
  ], "drift": { "period": 25000, "amount": 0.12 } },
  "layers": [
    { "key": "stars", "count": 120,
      "sprite": { "kind": "circle", "radius": [0.5, 2], "color": "#ffffff", "soft": true },
      "motion": { "type": "static" }, "alpha": [0.3, 0.7],
      "pulse": { "amp": 0.15, "period": 3000 } },
    { "key": "comets", "count": 8,
      "sprite": { "kind": "circle", "radius": [3, 8], "color": "#88ccff", "soft": true },
      "motion": { "type": "drift", "speed": [80, 200], "angle": 225 },
      "alpha": [0.7, 1], "blend": "lighter", "trail": { "length": 1500, "fade": 1 } },
    { "key": "fireflies", "count": 20,
      "sprite": { "kind": "circle", "radius": [2, 5], "color": "#ffdd44", "soft": true },
      "motion": { "type": "drift", "speed": [10, 30], "bidirectional": true, "bob": 20 },
      "alpha": [0.4, 0.8], "pulse": { "amp": 0.3, "period": 2000 },
      "blend": "lighter", "trail": { "length": 800 } }
  ]
}

### Scale reference (at 1080p)

| radius | What it looks like |
|--------|-------------------|
| 0.5–2 | Distant stars, dust, fine particles |
| 2–5 | Snowflakes, raindrops, small fireflies |
| 5–15 | Prominent orbs, bokeh circles, visible sprites |
| 15–40 | Large focal elements, moons, jellyfish |
| 40+ | Dominant features, suns — use sparingly |

Emoji `size` follows the same scale (it's the font size in px).
Speeds: 1–10 = barely drifting, 20–60 = gentle, 80–200 = brisk, 300+ = fast/energetic.

### Composition tips

- **Parallax depth:** Use 3+ layers. Back layers: many small, slow, dim entities. Front layers: few large, fast, bright entities. This single technique makes any scene feel 3D.
- **Glow stacking:** `soft: true` + `blend: "lighter"` makes overlapping orbs glow brighter where they overlap — nebulae, aurora, bioluminescence.
- **Color harmony:** Pick 3–5 colors from a coherent palette. Use `colors` array on circle sprites for variety within harmony. The background gradient sets the mood.
- **Trails:** Best on fast-moving entities (comets, shooting stars). On slow entities, trails create ghostly traces. On static entities, trails do nothing.
- **Don't fill the screen.** Restraint > density. A few well-placed layers with breathing room look better than maxing out entity counts. 50–200 total entities is usually right.
- **Use region to create geography.** Ground fog at `y: [0.85, 1]`, sky-only stars at `y: [0, 0.4]`, a horizon line.

## Your task

Design an original screensaver. Not a remix of the examples above — something with its own concept, mood, and visual identity. Think about what would be mesmerizing to watch on a screen for minutes at a time.

Your output must be:
1. A brief creative statement (2–3 sentences: what is this scene, what mood does it evoke)
2. The complete SaverSpec JSON — valid against the schema, ready to compile and run

Be bold with your concept. The format is more expressive than it looks — layering, trails, glow, parallax, and color can produce scenes that feel alive and atmospheric. The best screensavers find a sweet spot between complexity and hypnotic simplicity.
```

---

## Prompt 2 — Format Feedback & Roadmap

Give this in the same conversation after the model produces its saver. The
model's answers are most useful when fresh from the creative attempt.

```
Now that you've created a screensaver with this format, I'd like your feedback on the experience. This will directly inform what features we build next.

Answer each section honestly. If you had a great experience, say so — but the most valuable feedback is about friction, limitations, and unfulfilled ideas.

## 1. What you wanted but couldn't express

What visual effects, motion patterns, or compositions did you imagine but couldn't achieve with the current schema? Be specific — describe the scene or effect you had in mind and what was missing. Examples:

- "I wanted particles to follow curved paths, but drift only goes in straight lines"
- "I wanted entities to react to each other (flocking, attraction, repulsion)"
- "I wanted a slowly zooming fractal background instead of a gradient"

List as many as you thought of, even if they seem ambitious.

## 2. What was confusing or surprising

Where did the format trip you up? Did any field not work the way you expected? Were there naming or unit choices that felt unintuitive? For example:

- "I expected angle: 0 to mean 'up' but it means 'right'"
- "I didn't understand what 'soft' does until I saw the examples"
- "The difference between alpha and pulse wasn't clear"

## 3. What you'd build with more tools

If the format had these additional features, what screensavers would you create? Pick 2–3 from this list and describe a scene you'd make with them:

- **Harmonic/Lissajous motion** — entities follow sinusoidal curves instead of straight lines
- **Waypoint paths** — entities follow a defined route (bezier, catmull-rom)
- **Canvas-fade ghosting** — frame-level afterimage (every entity leaves fading trails without per-entity trail config)
- **Perspective depth (z-axis)** — entities have a z-coordinate; far = small/slow, near = large/fast (real warp starfield)
- **Polygon/connected-vertex shapes** — N vertices connected by lines, each moving independently (Mystify, string art)
- **Spawn timing** — layers that appear/disappear at specific times (narrative structure, acts)
- **Grid layout** — entities snap to rows/columns instead of scattering randomly (Matrix rain, LED walls)
- **Fractal sprites** — Koch snowflakes, Sierpinski triangles, L-system trees as sprite shapes

## 4. Quality-of-life improvements

What would make authoring easier or more predictable?

- Better documentation or examples?
- A preview/feedback loop?
- More sprite kinds?
- Different defaults?
- Validation messages that explain what's wrong?

## 5. Your dream saver

If you had unlimited format capabilities (simulation, shaders, physics, anything), describe the single most mesmerizing screensaver you'd design. Don't constrain yourself to what's possible today — describe the vision. This helps us understand where the format should evolve long-term.
```

---

## Usage notes

- **1a (MCP)** tests the full authoring loop: schema discovery, preview
  iteration, live publish. For models connected to the idle-screens MCP server.
- **1b (standalone)** works with any LLM, no tools needed. Output is raw JSON
  you can manually publish via `publishScene`.
- **Prompt 2** goes in the same conversation after the model produces its saver.
- Compare models on: visual imagination, schema correctness (does it validate?),
  use of advanced features (trails, glow stacking, parallax), and restraint
  (not just maxing everything out).
