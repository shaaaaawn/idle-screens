# Scene Format Specification

## Status: Thought experiment

## Overview

A declarative scene format that extends `SaverSpec` into a general-purpose
rich-media runtime — the same design space Flash occupied, rebuilt as
agent-authorable JSON with safety by construction.

A `Scene` describes a self-contained visual program as **data**: a scene graph
of positioned layers, property animations on a timeline, state machines for
interaction, reactive data bindings, and reusable symbols. No bytecode, no
scripting VM, no arbitrary code execution. The renderer compiles scenes to
canvas/WebGPU the same way `compileSaver` compiles specs today.

### Design principles

1. **Data, not code.** Everything expressible in the format is analyzable,
   diffable, and safe by construction. No Turing-complete scripting.
2. **Agent-authorable.** An LLM can write a scene from a natural-language
   description. The format is JSON — no binary encoding, no tooling required.
3. **Deterministic.** Seeded RNG + analytic position functions = same scene +
   seed = identical output on any device, any frame rate.
4. **Progressive.** A scene renders its first frame immediately. Complexity
   (symbols, animations, data) can arrive incrementally over the wire.
5. **Composable.** Scenes embed other scenes (symbols). A dashboard scene can
   host an ambient particle scene as a background layer.
6. **Safe.** No network access, no filesystem, no DOM manipulation. The
   format's expressiveness ceiling IS its security boundary.

---

## Format

```typescript
interface Scene {
  format: 'idle-scene';
  version: 1;
  id: string;
  label: string;
  seed?: number;

  /** Viewport sizing. Default: fill container. */
  viewport?: {
    aspect?: [number, number];         // e.g. [16, 9]
    scaling?: 'fill' | 'fit' | 'none'; // default 'fill'
    background?: string;               // letterbox color
  };

  background?: Background;
  symbols?: Record<string, Symbol>;    // reusable component library
  layers: SceneLayer[];                // the scene graph
  timeline?: Timeline;                 // main animation timeline
  states?: Record<string, State>;      // state machine definitions
  bindings?: Binding[];                // reactive data connections
  audio?: Record<string, AudioDef>;    // sound definitions
}
```

### Backward compatibility

A `Scene` with no `symbols`, `timeline`, `states`, `bindings`, or `audio`
and only basic layers is equivalent to a `SaverSpec`. The renderer treats
`SaverSpec` as a subset — every valid spec is a valid scene.

---

## Scene graph: layers

A `SceneLayer` extends the current `LayerSpec` with transforms, nesting,
conditional visibility, and symbol instancing.

```typescript
interface SceneLayer {
  key?: string;
  count?: number;                      // default 1; >1 scatters instances
  sprite?: Sprite;                     // leaf content (text, shape, image, etc.)
  symbol?: string;                     // reference a defined symbol by name
  children?: SceneLayer[];             // nested layers (scene graph)

  // --- positioning ---
  position?: { x: number; y: number }; // fractional viewport coords (0..1)
  anchor?: { x: number; y: number };   // transform origin (0..1), default center
  transform?: {
    scale?: number | [number, number];
    rotation?: number;                 // degrees
    skew?: [number, number];
  };

  // --- appearance ---
  alpha?: number | [number, number];
  blend?: GlobalCompositeOperation;
  visible?: string;                    // state condition: "playing", "!paused"
  mask?: string;                       // key of another layer to use as mask

  // --- animation ---
  motion?: Motion;                     // particle-style motion (drift/rise/bounce/static)
  animate?: PropertyAnimation[];       // keyframed property changes

  // --- interaction ---
  hit?: HitRegion;                     // clickable/hoverable area
  on?: Record<string, Action[]>;       // event → action mappings

  // --- scatter (count > 1) ---
  region?: { x?: [number, number]; y?: [number, number] };
  size?: [number, number];
  flip?: boolean;
  wrap?: boolean;
  pulse?: { amp: number; period: number };
}
```

### Layer resolution order

1. If `symbol` is set, resolve the symbol definition and merge its layers
   as children. The layer's own `transform`/`alpha`/etc. apply to the group.
2. If `children` is set, this is a group node. Render children in order.
3. If `sprite` is set, this is a leaf node. Render the sprite.
4. If `count > 1`, scatter instances using the same seeded-entity system
   as today's `buildEntities`.

---

## Sprites

Extend the current `SpriteSpec` with vector shapes, images, and containers.

```typescript
type Sprite =
  // --- existing ---
  | { kind: 'emoji'; glyphs: string[] }
  | { kind: 'text'; strings: string[]; color?: string; font?: string;
      align?: 'left' | 'center' | 'right';
      baseline?: 'top' | 'middle' | 'bottom';
      maxWidth?: number; lineHeight?: number; wrap?: boolean }
  | { kind: 'circle'; radius: number | [number, number]; color: string; soft?: boolean }

  // --- new: vector shapes ---
  | { kind: 'rect'; width: number; height: number;
      fill?: string; stroke?: string; strokeWidth?: number;
      radius?: number | [number, number, number, number] }
  | { kind: 'line'; points: [number, number][];
      stroke: string; strokeWidth?: number;
      closed?: boolean; fill?: string }
  | { kind: 'path'; d: string;                    // SVG path data
      fill?: string; stroke?: string; strokeWidth?: number }

  // --- new: data viz ---
  | { kind: 'bar'; value: number; max: number;
      width: number; height: number;
      color: string; bgColor?: string;
      direction?: 'horizontal' | 'vertical';
      rounded?: boolean;
      thresholds?: { at: number; color: string }[] }
  | { kind: 'ring'; value: number; max: number;
      radius: number; width: number;
      color: string; bgColor?: string;
      startAngle?: number; sweep?: number }
  | { kind: 'sparkline'; values: number[]; maxPoints?: number;
      width: number; height: number;
      color: string; fill?: boolean; fillAlpha?: number }

  // --- new: media ---
  | { kind: 'image'; src: string;                 // data: URI only (self-contained)
      width: number; height: number; fit?: 'cover' | 'contain' | 'fill' }
```

### Vector drawing model

Shapes use the canvas 2D drawing API directly. Coordinates are in the
layer's local space (transformed by the layer's position/scale/rotation).
Fills and strokes support hex colors; gradients are a future extension.

`path` uses SVG path `d` syntax (`M`, `L`, `C`, `Q`, `A`, `Z`), parsed
and compiled to canvas calls at mount time. This gives full vector
expressiveness without a scripting language.

---

## Symbols: reusable components

The Flash equivalent of a Library Symbol / MovieClip. A symbol is a
self-contained group of layers with its own local coordinate space.

```typescript
interface Symbol {
  /** Layers rendered as a group. Coordinates are local (0..1 = symbol bounds). */
  layers: SceneLayer[];
  /** Symbol's own timeline, independent of the scene timeline. */
  timeline?: Timeline;
  /** Size of the symbol's local viewport in px (for absolute-px sprites). */
  size?: { width: number; height: number };
}
```

Usage:

```json
{
  "symbols": {
    "gauge": {
      "size": { "width": 120, "height": 120 },
      "layers": [
        { "sprite": { "kind": "ring", "value": 0, "max": 100, "radius": 50,
                       "width": 6, "color": "#44ff88", "bgColor": "#112211" },
          "key": "ring" },
        { "sprite": { "kind": "text", "strings": ["0%"], "color": "#44ff88",
                       "font": "bold 20px monospace", "align": "center" },
          "position": { "x": 0.5, "y": 0.5 },
          "key": "label" }
      ]
    }
  },
  "layers": [
    { "symbol": "gauge", "key": "cpu-gauge",
      "position": { "x": 0.3, "y": 0.3 } },
    { "symbol": "gauge", "key": "mem-gauge",
      "position": { "x": 0.7, "y": 0.3 } }
  ]
}
```

Two gauge instances, each addressable by key for independent data binding
(`cpu-gauge.ring.value`, `mem-gauge.ring.value`). Same symbol definition,
different positions, different live data.

---

## Timeline: property animation

The generalization of our control track. Animates any numeric or color
property on any keyed layer over time.

```typescript
interface Timeline {
  duration: number;                    // ms
  loop?: boolean | number;             // true = infinite, number = count
  autoplay?: boolean;                  // default true
  tracks: Track[];
}

interface Track {
  target: string;                      // key path: "cpu-gauge.ring.value"
  keyframes: Keyframe[];
}

interface Keyframe {
  t: number;                           // ms
  value: number | string | boolean;
  ease?: 'step' | 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out'
       | 'spring' | [number, number, number, number];  // cubic-bezier
}
```

Example: a loading spinner that rotates and pulses.

```json
{
  "timeline": {
    "duration": 2000,
    "loop": true,
    "tracks": [
      { "target": "spinner.transform.rotation",
        "keyframes": [
          { "t": 0, "value": 0, "ease": "linear" },
          { "t": 2000, "value": 360 }
        ]},
      { "target": "spinner.alpha",
        "keyframes": [
          { "t": 0, "value": 0.4, "ease": "ease-in-out" },
          { "t": 1000, "value": 1 },
          { "t": 2000, "value": 0.4 }
        ]}
    ]
  }
}
```

### Relation to control tracks

A `Timeline` subsumes `ControlTrack`. The existing control track
infrastructure (keyframes, easing, `sampleTrack`) becomes the
implementation of timeline playback. `ControlTrack` remains the
low-level API; `Timeline` is the user-facing format.

---

## State machines: interaction without scripting

Flash needed ActionScript for `onPress`, `onRelease`, `gotoAndPlay`.
State machines express the same patterns declaratively.

```typescript
interface State {
  enter?: Action[];                    // run on state entry
  exit?: Action[];                     // run on state exit
  transitions: Transition[];
}

interface Transition {
  on: EventType;                       // what triggers it
  target: string;                      // state name to transition to
  guard?: string;                      // condition expression (see below)
  actions?: Action[];                  // run during transition
}

type EventType =
  | 'tap'                              // click/touch on a hit region
  | 'hover-enter' | 'hover-exit'
  | 'timer'                            // after a duration
  | 'data-change'                      // a binding value changed
  | 'timeline-end'                     // main or symbol timeline completed
  | { type: 'timer'; delay: number }
  | { type: 'data'; path: string; condition: 'gt' | 'lt' | 'eq'; value: number };

type Action =
  | { type: 'set'; path: string; value: unknown }
  | { type: 'toggle'; path: string }
  | { type: 'goto-state'; machine: string; state: string }
  | { type: 'play-timeline'; target?: string; from?: number }
  | { type: 'pause-timeline'; target?: string }
  | { type: 'play-audio'; sound: string }
  | { type: 'emit'; event: string; data?: unknown };
```

Example: a button with hover and pressed states.

```json
{
  "states": {
    "button": {
      "enter": [{ "type": "set", "path": "btn.sprite.color", "value": "#334455" }],
      "transitions": [
        { "on": "hover-enter", "target": "button-hover" },
        { "on": "tap", "target": "button-pressed" }
      ]
    },
    "button-hover": {
      "enter": [{ "type": "set", "path": "btn.sprite.color", "value": "#445566" }],
      "transitions": [
        { "on": "hover-exit", "target": "button" },
        { "on": "tap", "target": "button-pressed" }
      ]
    },
    "button-pressed": {
      "enter": [
        { "type": "set", "path": "btn.sprite.color", "value": "#3a86ff" },
        { "type": "play-audio", "sound": "click" },
        { "type": "emit", "event": "button-clicked" }
      ],
      "transitions": [
        { "on": { "type": "timer", "delay": 200 }, "target": "button" }
      ]
    }
  }
}
```

### Why not scripting?

State machines are strictly less powerful than a Turing-complete language.
That's the point. They cover buttons, menus, toggles, drag interactions,
multi-step flows, game logic (turn-based, not physics), quizzes, and
tutorials. They can't do arbitrary computation — but they also can't
`eval()`, can't `fetch()`, can't access `document.cookie`.

The set of actions is fixed and auditable. A renderer can statically
analyze a scene's state machine to guarantee termination, bound memory
usage, and prove safety properties.

For content that genuinely needs scripting (games with physics, generative
art, custom simulations), use the imperative `SaverPlugin` path. Two tiers
of content, two tiers of trust.

---

## Reactive bindings: live data

The generalization of `setParam`. Bindings map external data channels to
layer properties, with optional transforms.

```typescript
interface Binding {
  /** External data channel name. */
  channel: string;
  /** Path within the incoming data object. */
  field?: string;
  /** Target layer property path. */
  target: string;
  /** Optional transform. */
  transform?: Transform;
}

type Transform =
  | { type: 'identity' }
  | { type: 'clamp'; min: number; max: number }
  | { type: 'map-range'; from: [number, number]; to: [number, number] }
  | { type: 'format'; template: string }      // "{{value}}%" → "73%"
  | { type: 'threshold'; steps: { at: number; value: unknown }[] }
  | { type: 'append'; maxLength?: number };    // sparkline buffer
```

Example: CPU metric bound to a gauge.

```json
{
  "bindings": [
    { "channel": "system", "field": "cpu",
      "target": "cpu-gauge.ring.value" },
    { "channel": "system", "field": "cpu",
      "target": "cpu-gauge.label.sprite.strings.0",
      "transform": { "type": "format", "template": "{{value}}%" } },
    { "channel": "system", "field": "cpu",
      "target": "cpu-gauge.ring.color",
      "transform": { "type": "threshold", "steps": [
        { "at": 0, "value": "#44ff88" },
        { "at": 70, "value": "#ffaa44" },
        { "at": 90, "value": "#ff4444" }
      ]}}
  ]
}
```

When the renderer receives `{ channel: "system", data: { cpu: 73 } }` over
the wire, all three bindings fire: the ring fills to 73%, the label reads
"73%", and the ring turns orange.

### Wire protocol

Bindings receive data via the existing WebSocket protocol:

```json
{ "type": "data", "channel": "system", "data": { "cpu": 73, "mem": 4.2 } }
```

The MCP `setParam` tool becomes sugar over this — it posts a data message
to the channel, which the binding system routes to the targets.

---

## Audio

Declarative sound definitions. Self-contained (data URIs) like images.

```typescript
interface AudioDef {
  src: string;                         // data: URI (base64 wav/mp3/ogg)
  volume?: number;                     // 0..1, default 1
  loop?: boolean;
}
```

Audio plays in response to actions (`play-audio`) or timeline cues.
No ambient autoplay — audio only triggers from user interaction or
explicit timeline events (respects browser autoplay policies).

---

## Example: interactive dashboard

A complete scene combining particles, positioned text, symbols, bindings,
and state machines.

```json
{
  "format": "idle-scene",
  "version": 1,
  "id": "ops-dashboard",
  "label": "Ops Dashboard",
  "seed": 256,

  "background": {
    "type": "gradient",
    "stops": [{ "at": 0, "color": "#06060c" }, { "at": 1, "color": "#0c0c18" }]
  },

  "symbols": {
    "metric-card": {
      "size": { "width": 200, "height": 80 },
      "layers": [
        { "sprite": { "kind": "rect", "width": 200, "height": 80,
                       "fill": "#0e1018", "stroke": "#1a1a2a", "strokeWidth": 1,
                       "radius": 8 } },
        { "key": "label", "position": { "x": 0.1, "y": 0.3 },
          "sprite": { "kind": "text", "strings": ["METRIC"], "color": "#445566",
                       "font": "9px monospace", "align": "left" } },
        { "key": "value", "position": { "x": 0.1, "y": 0.7 },
          "sprite": { "kind": "text", "strings": ["0"], "color": "#44aaff",
                       "font": "bold 24px monospace", "align": "left" } }
      ]
    }
  },

  "layers": [
    { "count": 40,
      "sprite": { "kind": "circle", "radius": [0.3, 1], "color": "#1a2538" },
      "alpha": [0.1, 0.25],
      "motion": { "type": "drift", "speed": [0.3, 1.2], "bob": 0.3 } },

    { "key": "title", "position": { "x": 0.5, "y": 0.05 },
      "sprite": { "kind": "text", "strings": ["OPS DASHBOARD"], "color": "#556677",
                   "font": "600 14px monospace", "align": "center" },
      "motion": { "type": "static" } },

    { "symbol": "metric-card", "key": "cpu",
      "position": { "x": 0.15, "y": 0.2 } },
    { "symbol": "metric-card", "key": "mem",
      "position": { "x": 0.45, "y": 0.2 } },
    { "symbol": "metric-card", "key": "req",
      "position": { "x": 0.75, "y": 0.2 } }
  ],

  "bindings": [
    { "channel": "metrics", "field": "cpu",
      "target": "cpu.value.sprite.strings.0",
      "transform": { "type": "format", "template": "{{value}}%" } },
    { "channel": "metrics", "field": "cpu",
      "target": "cpu.value.sprite.color",
      "transform": { "type": "threshold", "steps": [
        { "at": 0, "value": "#44ff88" },
        { "at": 70, "value": "#ffaa44" },
        { "at": 90, "value": "#ff4444" }
      ] } },
    { "channel": "metrics", "field": "memory_gb",
      "target": "mem.value.sprite.strings.0",
      "transform": { "type": "format", "template": "{{value}} GB" } },
    { "channel": "metrics", "field": "rps",
      "target": "req.value.sprite.strings.0" }
  ]
}
```

Three metric cards from one symbol definition, each bound to a different
data field. CPU color changes at thresholds. Push `{ cpu: 73, memory_gb: 4.2,
rps: 1240 }` to the `metrics` channel and all three cards update.

---

## What this doesn't do (and why)

| Capability | Why excluded | Alternative |
|---|---|---|
| Arbitrary scripting | Security boundary | Imperative `SaverPlugin` for escape hatch |
| Network requests | No exfiltration | Data arrives via bindings from the host |
| DOM access | Sandboxed canvas | Passthrough savers for page interaction |
| File I/O | No persistence | Host manages state, pushes via bindings |
| Dynamic code loading | No supply chain risk | All content is in the scene JSON |
| Physics simulation | Not declarative enough | Imperative saver with physics engine |
| 3D scenes | Separate domain | WebGPU saver for 3D content |
| Video playback | Streaming complexity | Native `<video>` alongside the scene |

The format intentionally stops short of Turing completeness. The gap
between "declarative scene" and "application" is filled by the host
environment (the `<idle-screen>` element, the MCP server, the data
bindings from external systems). The scene is the VIEW; the host is
the CONTROLLER.

---

## Implementation path

Given what exists today in `@idle-screens/schema`:

| Step | What | Builds on |
|---|---|---|
| **Done** | Static motion, position, key, text alignment | SaverSpec |
| **Done** | Dashboard example (34-layer text HUD) | All of the above |
| 1 | `rect` sprite + `path` sprite | Canvas drawing API |
| 2 | `transform` on layers (scale, rotation) | Canvas transform stack |
| 3 | Symbol definitions + instancing | Layer resolution |
| 4 | Timeline (generalized control track) | Existing `sampleTrack` |
| 5 | `bar` / `ring` / `sparkline` sprites | Canvas drawing |
| 6 | Reactive bindings (data → property) | Existing `setParam` |
| 7 | Hit regions + state machines | Event system |
| 8 | Conditional visibility | State machine integration |
| 9 | Audio definitions + playback | Web Audio API |
| 10 | Scene-level viewport / aspect ratio | Canvas sizing |
| 11 | `image` sprite (data URI) | Canvas drawImage |
| 12 | Nested scenes (symbol timelines) | Recursive rendering |

Steps 1-6 are the pragmatic core — they cover dashboards, data viz,
ambient scenes, and simple animations. Steps 7-9 add interaction.
Steps 10-12 are the full Flash-equivalent feature set.
