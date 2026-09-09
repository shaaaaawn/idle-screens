# @idle-screens/saver-metaquarium

A three.js aquarium saver: skinned GLB fish swim seeded Catmull-Rom spline
paths through a dark, fogged tank.

## Core animation loop

```
mount
  ├─ WebGLRenderer (stencil off, high-performance, sRGB, linear tone)
  ├─ Scene: fog (fogNear/fogFar) + terrain floor, and — when `environment`
  │         is not `void` — a terrain silhouette and light shafts (a water
  │         ceiling too, for the rooms that have one: reef, kelp, ice, lagoon)
  ├─ PerspectiveCamera on param-steered spherical orbit
  └─ populate():
       for each fish index:
         1. fetch + parse GLB → FishTemplate (module-level cache)
         2. SkeletonUtils.clone() → per-fish skinned mesh
         3. applyNpcMaterials(): seeded palette body + glow colors (all unlit)
         4. compileSwimPlan(rng.fork(i), BOUNDS) → closed Catmull-Rom loop
            on the chosen pathShape, with arc-length table + speed-wobble
            harmonics; swimStyle assigns depth band, formation slot or bond
         5. add to scene

frame loop (rAF or renderFrame(t)):
  1. governor: median frame time > 21ms → render scale ×0.8 (floor 0.56);
     back under 14ms → step it up again
  2. setState(t):
     - sample control track → live params
     - camera orbit from cameraAzimuth + autoRotate * t
     - fog color from fogColor param
     - for each fish:
         distance = distanceAt(plan, tSec, speed)   // closed-form integral
         pose = swimPoseAtDistance(plan, distance)   // arc-length → spline param
         group.position ← pose.xyz
         group.lookAt ← pose.forward
         group.rotateZ ← pose.roll (bank into turns)
         + maneuver displacement (seeded per-fish event schedule)
         mixer.setTime ← beat * 0.045, wrapped to clip length (tail beat)
  3. renderer.render(scene, camera)
```

## Architecture

- **Deterministic**: seeded RNG only, closed-form swim. `renderFrame(t, seed)`
  is frame-addressable — same inputs, same frame.
- **Steerable**: camera, cast, room, swim style, maneuvers and palette — every
  param below rides the control track.
- **Additive by default**: each param's default reproduces the behaviour that
  existed before it was added, so a bump never changes a scene already running.
- **Device-tiered**: `@idle-screens/capabilities` scales pixel ratio, AA, and
  fish cap per device.
- **Adaptive governor**: steps render resolution down when frames exceed budget.
- **Zero-dep manifest subpath**: servers validate params without pulling three.js.

## Params

The paramSpace in `src/manifest.ts` is the source of truth — it carries the
bounds, eases and the reasoning behind each default. Every param defaults to
the behaviour that existed before it was added, so a scene already on a wall
never changes because a dependency was bumped.

### Camera

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| cameraAzimuth | number | 35 | Orbit angle (degrees), 0–360 |
| cameraElevation | number | 15 | Height angle above the waterline, −5–60 |
| cameraDistance | number | 110 | Distance from tank center, 80–400 |
| autoRotate | number | 0 | Continuous orbit speed (deg/s), 0–12 |

### Cast

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| fishCount | number | 1 | Visible fish, 1–24 (step). Default 1 = hero mode; the pool grows on demand and never shrinks |
| fishUrl | string | `ipfs://…/fish_257_….glb` | GLB model URL, single-breed mode (`ipfs://` supported; the playground overrides to a local asset) |
| fishMix | string | `""` | Mixed population DSL: `id[:count][@style]` comma-separated, catalog ids or breed aliases (`"257:2,100:1"`, `"457:3@hover,257:6@school"`). A minted id is an INDIVIDUAL — no id twice in a scene. Non-empty overrides fishUrl + fishCount; counts absolute, tier-capped |
| dracoPath | string | `""` | Where the Draco decoder lives (most Metaquarium models are Draco-compressed). Empty = the copy shipped beside this package |

### Motion

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| swimSpeed | number | 1 | Swim time-scale multiplier, 0.2–3 |
| swimStyle | enum | `loop` | `loop` (pre-style), `school`, `drift`, `hover`, `patrol`, `bottom`, `surface`; relationship styles `follow` / `pair` / `chase` bond a fish to the nearest preceding unbonded fish; `auto` gives each untagged token its breed's default |
| pathShape | enum | `wander` | The shape a loop is drawn on: `wander`, `orbit`, `eight`, `helix`, `canyon`, `crossing` (camera-relative parade lane) |
| formationShape | enum | `phalanx` | How a `school` holds together: `phalanx`, `line`, `ring`, `wedge`, `ball`, `wheel`. Ignored by non-formation styles |
| swimVariance | number | 0 | Per-fish spread, 0–1: 0 a uniform shoal, 1 every fish its own animal (±40% speed, ±25% size, own phase) |
| bodyWiggle | number | 0 | Procedural body yaw for models with no animation clip, 0–1. Clipped models ignore it; 0.3–0.4 recommended for a clip-less cast |
| maneuver | enum | `none` | Named event layered over the swim style: `dart`, `startle`, `graze`, `curious`, `zoomies`. Each fish runs its own seeded schedule |
| maneuverRate | number | 0.5 | How often events fire, 0–3: 0 never, 1 the maneuver's own tempo (~14–20 s per fish), 3 nearly back to back |
| maneuverIntensity | number | 0.7 | How hard — scales the surge, the kick and the tail flurry together, 0–1 |
| lightSeek | number | 0 | Free fish drawn toward the room's light shafts, each to its own pool, 0–1 (needs rays) |
| formationBreathe | number | 0 | The school relaxes outward and back on a ~15 s cycle, 0–1; only ever expands |

### The room

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| environment | enum | `void` | The ROOM: `void` (exactly the pre-environment scene), `abyss`, `reef`, `kelp`, `ice`, `vent`, `lagoon`, `universe`. Adds terrain and light shafts, plus a water ceiling for the rooms that have one (reef, kelp, ice, lagoon); never overrides your palette params |
| floorKind | enum | `auto` | Override the environment's terrain: `auto`, `flat`, `dunes`, `ridges`, `basin` |
| waterY | number | −1 | Water-ceiling height, −1–220. −1 follows the environment (step, not smooth — the sentinel can't be interpolated through) |
| rayStrength | number | −1 | Light-shaft strength, −1–1. −1 follows the environment, 0 = off (step, same sentinel reason) |

### Palette

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| fogColor | color | `#030009` | Water / atmosphere (background + fog) |
| fogNear | number | 60 | Fog start distance, 20–200 |
| fogFar | number | 500 | Fog full-opacity distance, 120–1100; the tank enforces far > near + 20 |
| floorColor | color | `#0a1d33` | Floor disc color |
| moteDensity | number | 0 | Plankton motes, 0–1 of the tier budget. 0 = off |
| moteColor | color | `#7fd6ff` | Mote tint |

## File map

`ls src/` is the truth if this drifts; the roles below are what each module owns.

| File | Role |
|------|------|
| tank.ts | Renderer, scene, fish spawn, environments, setState, governor, dispose |
| plan.ts | Catmull-Rom swim: compile, arc-length, pose-at-distance, path shapes |
| swim.ts | Swim styles, formations, depth bands, relationship bonds |
| maneuver.ts | Named seeded events (dart, startle, graze, curious, zoomies) |
| environments.ts | The named rooms: water ceiling, terrain, light shafts, cost budget |
| materials.ts | Seeded palette coat (unlit MeshBasicMaterial) |
| ipfs.ts | `ipfs://` resolution, gateway ladder, fishMix parsing, fish catalog |
| farm.ts | Metaquarium farm lookup (breed aliases, minted token ids) |
| asset-cids.ts | Pinned CIDs for the default catalog |
| tank-draco.ts | Draco decoder wiring, scoped to a decode |
| runtime.ts | three.js runtime resolution seam |
| manifest.ts | Param space, palettes, manifest metadata (zero-dep subpath) |
| quality.ts | Device-tier quality caps |
| metaquarium.ts | Plugin factory + demo track |
