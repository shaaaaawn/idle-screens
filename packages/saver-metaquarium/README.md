# @idle-screens/saver-metaquarium

A three.js aquarium saver: skinned GLB fish swim seeded Catmull-Rom spline
paths through a dark, fogged tank.

## Core animation loop

```
mount
  ├─ WebGLRenderer (stencil off, high-performance, sRGB, linear tone)
  ├─ Scene: fog (near 60, far 500) + flat MeshBasicMaterial floor
  ├─ PerspectiveCamera on param-steered spherical orbit
  └─ populate():
       for each fish index:
         1. fetch + parse GLB → FishTemplate (module-level cache)
         2. SkeletonUtils.clone() → per-fish skinned mesh
         3. applyNpcMaterials(): seeded palette body + glow colors (all unlit)
         4. compileSwimPlan(rng.fork(i), BOUNDS) → closed Catmull-Rom loop
            with arc-length table + speed-wobble harmonics
         5. add to scene

frame loop (rAF or renderFrame(t)):
  1. governor: median frame time > 21ms → step render scale down 0.8×
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
         mixer.setTime ← distance * 0.045 (tail beat)
  3. renderer.render(scene, camera)
```

## Architecture

- **Deterministic**: seeded RNG only, closed-form swim. `renderFrame(t, seed)`
  is frame-addressable — same inputs, same frame.
- **Steerable**: camera, fish count, swim speed, fog color — all live via
  control track.
- **Device-tiered**: `@idle-screens/capabilities` scales pixel ratio, AA, and
  fish cap per device.
- **Adaptive governor**: steps render resolution down when frames exceed budget.
- **Zero-dep manifest subpath**: servers validate params without pulling three.js.

## Params

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| cameraAzimuth | number | 35 | Orbit angle (degrees) |
| cameraElevation | number | 15 | Height angle above waterline |
| cameraDistance | number | 110 | Distance from tank center |
| autoRotate | number | 0 | Orbit speed (deg/s) |
| fishCount | number | 1 | Visible fish (step) |
| swimSpeed | number | 1 | Swim time-scale multiplier |
| fogColor | color | #030009 | Atmosphere / background |
| fishUrl | string | ipfs://…/fish_257_….glb | GLB model URL, single-breed mode (playground can override to a local asset) |
| fishMix | string | "" | Mixed population DSL: `id[:count][@style]` comma-separated, catalog ids or breed aliases (`"257:2,100:1"`, `"457:3@hover,257:6@school"` — per-token swim style; untagged tokens follow `swimStyle`). Non-empty overrides fishUrl + fishCount; counts absolute, tier-capped |
| fogNear | number | 60 | Fog start distance (the old hardcoded Fog near) |
| fogFar | number | 500 | Fog full-opacity distance; tank enforces > near + 20 |
| moteDensity | number | 0 | Plankton motes, 0–1 of the tier budget (400/250/120). 0 = off |
| moteColor | color | #7fd6ff | Mote tint |
| floorColor | color | #0a1d33 | Floor disc color (the old hardcoded navy) |

## File map

| File | Lines | Role |
|------|-------|------|
| tank.ts | ~480 | Renderer, scene, fish spawn, setState, governor, dispose |
| plan.ts | ~180 | Catmull-Rom swim: compile, arc-length, pose-at-distance |
| materials.ts | ~90 | Seeded palette coat (unlit MeshBasicMaterial) |
| manifest.ts | ~100 | Param space, palettes, manifest metadata |
| quality.ts | ~35 | Device-tier quality caps |
| metaquarium.ts | ~40 | Plugin factory + demo track |
