---
name: idle-screens-saver-plugin-authoring
description: |
  Author a new saver for the idle-screens library, or port an existing Angular/
  React screensaver into one. Use when adding a saver to packages/savers-* or a
  new saver package, or wiring one into the engine/registry. Covers the
  SaverPlugin/SaverInstance/SaverContext contract, the four rendering patterns
  (repaint canvas, accumulative canvas, DOM/CSS, WebGPU compute), seeded RNG
  (no Math.random), the optional paramSpace + control-track for steerable/
  deterministic savers, passthrough page-eating, the declarative schema path,
  and the full integration checklist.
author: Claude Code
version: 2.0.0
date: 2026-07-06
---

# Authoring an idle-screens saver

## The contract (`@idle-screens/core`)
```ts
interface SaverContext {
  host: HTMLElement;      // full-viewport container you render INTO
  surface?: HTMLCanvasElement | OffscreenCanvas; // pre-created canvas (Worker path)
  dpr: number;            // device pixel ratio — use instead of window.devicePixelRatio
  width: number; height: number;
  rng: Rng;               // seeded PRNG — use this, NEVER Math.random()
  seed: number;
  reducedMotion: boolean;
  page?: PageContext;     // present for passthrough savers (read/eat live page)
}
interface SaverInstance {
  setPaused(paused: boolean): void;   // freeze/resume the loop
  resize(w: number, h: number, dpr?: number): void; // runtime calls this on viewport/DPR change
  renderFrame?(t: number, seed: number): void; // pure, frame-addressable (optional)
  applyTrack?(track: ControlTrack): void;       // steer params over time (optional)
  dispose(): void;        // stop rAF/timers; restore any page mutations
}
interface SaverPlugin { manifest: SaverManifest; mount(ctx): SaverInstance | Promise<SaverInstance>; }
```
Export `export const mySaver: SaverPlugin = { manifest, mount: (ctx) => new MyInstance(ctx) };`

## Manifest fields
Every manifest needs these fields for the capabilities/evaluation system:
```ts
const manifest: SaverManifest = {
  id: 'my-saver',             // unique kebab-case id
  label: 'My Saver',          // human-readable label
  passthrough: false,          // true = overlays live page (see §Passthrough)
  minBackend: 'canvas2d',     // 'css' | 'canvas2d' | 'webgl2' | 'webgpu'
  costTier: 'low',            // 'idle' | 'low' | 'medium' | 'high'
  motionIntensity: 'moderate', // 'calm' | 'moderate' | 'energetic'
  reducedMotionFallback: 'static', // 'static' | 'reduced' | 'hide'
  a11y: { flashSafe: true },  // flash safety declaration (validated by e2e)
  // workerReady?: boolean,   // opt-in for off-main-thread (canvas savers only)
};
```
- `minBackend`: `'css'` for DOM/CSS savers, `'canvas2d'` for canvas savers. For
  WebGPU savers with a canvas2d fallback, use `'canvas2d'` (the floor the saver
  can run on, not the ceiling it can reach).
- `costTier`: `'idle'` for CSS-only, `'low'` for simple canvas, `'medium'`/`'high'` for heavy rendering.
- `motionIntensity`: drives the capabilities evaluation under reduced-motion preferences.

## Four rendering patterns

### 1. Repaint-every-frame canvas (e.g. warp, rainstorm)
Standard rAF loop that clears and redraws every frame. `resize()` just updates the
backing store dimensions — the next frame redraws at the new size automatically.
```ts
// Reference: packages/savers-classic/src/warp.ts
const canvas = ctx.surface ?? document.createElement('canvas');
if (!ctx.surface) {
  (canvas as HTMLCanvasElement).style.cssText = 'display:block;width:100%;height:100%';
  ctx.host.appendChild(canvas);
}
```

### 2. Accumulative canvas (e.g. pipes)
Builds up content over time without clearing each frame. **Key gotcha: setting
`canvas.width` or `canvas.height` wipes all drawn content.** So `resize()` must:
1. Update canvas backing store dimensions
2. Rebuild internal state (grid, particles, etc.)
3. Repaint the background
4. If paused, pre-render a static snapshot

```ts
// Reference: packages/savers-classic/src/pipes.ts
resize(width: number, height: number, dpr?: number): void {
  this.w = width;
  this.h = height;
  if (dpr !== undefined) this.ctxSaver.dpr = dpr;
  this.sizeCanvas();  // wipes the canvas!
  this.rebuild();      // rebuild grid + repaint background
  if (this.paused) this.renderStill();
}
```

### 3. DOM/CSS (e.g. messages, bsod, dvd)
Append elements + a `<style>` into `ctx.host`. Use CSS animations/transitions.
Toggle an `is-paused` class to control `animation-play-state`.
```ts
// Reference: packages/savers-classic/src/messages.ts
setPaused(paused: boolean): void {
  this.root.classList.toggle('is-paused', paused);
}
dispose(): void {
  this.root.remove();
  this.style.remove();
}
```

### 4. WebGPU compute with canvas2d fallback (e.g. fluid)
A single saver ID with two backends: a WebGPU compute-shader solver that
auto-upgrades when a GPU is available, falling back to a canvas2d CPU solver
when it isn't. The `mount()` function is `async` and probes for a GPU device.

**Architecture:**
- **`fluid-shared.ts`** — constants, emitter logic, and utilities shared by both paths
- **`fluid.ts`** — the `SaverPlugin` with async `mount()`, plus the `FluidCPU` class
- **`fluid-gpu.ts`** — the `FluidGPU` class (WebGPU compute shaders + render pipeline)

```ts
// Reference: packages/savers-classic/src/fluid.ts
export const fluid: SaverPlugin = {
  manifest: fluidManifest,  // minBackend: 'canvas2d' — the floor, not the ceiling
  async mount(ctx: SaverContext): Promise<SaverInstance> {
    try {
      const adapter = await navigator.gpu?.requestAdapter();
      if (adapter) {
        const device = await adapter.requestDevice();
        return new FluidGPU(ctx, device);
      }
    } catch { /* fall through */ }
    return new FluidCPU(ctx);
  },
};
```

**Key rules for WebGPU savers:**
- **`minBackend` stays `'canvas2d'`** (or whatever your fallback uses). The GPU
  path is an upgrade, not a requirement. The capabilities system gates on
  `minBackend` — setting it to `'webgpu'` would block the saver on non-GPU devices.
- **`mount()` returns `Promise<SaverInstance>`** — async mount is supported by the
  contract. The `<idle-screen>` element awaits it.
- **Add `@webgpu/types` as a devDependency** in the saver package and use
  `/// <reference types="@webgpu/types" />` at the top of the GPU file.
- **WGSL `override` constants** for grid dimensions (N, STRIDE, SZ) are baked at
  pipeline-creation time — no runtime uniform overhead for layout constants.
- **Jacobi vs Gauss-Seidel:** GPU solvers use Jacobi iteration with ping-pong
  buffers (parallelizable), not Gauss-Seidel (sequential). When ping-ponging,
  **zero both buffers** before a solve loop — stale data in boundary cells of
  the scratch buffer corrupts the solve (the boundary kernel only writes edges,
  leaving interior cells of the scratch buffer untouched on the first pass).
- **GPU buffer partial updates:** when updating a few cells in a large buffer
  (e.g. reseeding a simulation), use per-cell `writeBuffer(buf, offset, cell)`
  — NEVER allocate a full-size zero-filled array, set a few cells, and write
  the whole thing. That wipes the entire simulation state. This has caused bugs
  in both the fluid and reaction-diffusion savers.
- **Scale parameters with grid resolution.** When the GPU path uses a higher
  grid (e.g. N=256 vs CPU's N=96), diffusion/viscosity scale as `(96/N)^2`,
  force rate as `(96/N)`, and injection radius as `(N/96)`.
- **`dispose()` must destroy all GPU buffers AND the device** (since it was
  created specifically for this saver in `mount()`).
- **`resize()` must reconfigure the WebGPU canvas context** after changing
  canvas dimensions (unlike canvas2d where it's implicit).
- **Handle `device.lost`** — set a flag to skip render calls gracefully.
- The GPU path is **not Worker-ready** (WebGPU in Workers has different API
  surface). Don't set `workerReady: true` on WebGPU savers.
- Seeded RNG still applies — use `ctx.rng` for emitter initialization.

### WebGL (three.js) savers — hard-won laws (metaquarium, 2026-07)

- **`dispose()` MUST call `renderer.forceContextLoss()`** after
  `renderer.dispose()`. Browsers cap live WebGL contexts (~16) and kill the
  oldest past the cap; dispose alone waits on GC, so workbench churn (saver
  picker, previews, remounts) exhausts the pool → "janky and crashes" with
  nothing naming the cause. Also guard the render loop with
  `renderer.getContext()?.isContextLost?.()` so a lost context freezes
  instead of throwing every frame.
- **Do NOT set `preserveDrawingBuffer: true`** — on ANGLE/Metal it taxes
  every frame with a buffer copy (measured: 20fps → 60fps on an M1 Max by
  removing it). Readback consumers (validator sampler, perception
  scratch-copy) must read in the SAME task as `renderFrame`, where the
  buffer is still intact by spec; anything async (channel thumbs) must
  trigger a fresh `renderFrame` first.
- **Cap pixel ratio ~1.5 and run bloom at half resolution.** Retina-full
  through a post-processing chain is ~15 Mpix per pass; the visual delta is
  slight softness, the cost is the whole frame budget.
- **Detect software GL** (`SwiftShader`/`llvmpipe` in
  `WEBGL_debug_renderer_info`) and drop to the cheapest tier with no
  post-processing — headless CI runs on it, and every real-GPU assumption
  inverts there.
- **Cache parsed remote assets (GLB templates) at MODULE level**, keyed by
  URL, shared across instances. Instances must then never dispose template
  resources — `SkeletonUtils.clone` shares geometry — so pull spawned
  objects out of the scene before sweeping scene-owned resources in
  `dispose()`. Seed any template-time randomness from the URL (not
  `ctx.rng`) so the cache can't leak one session's seed into another.
  Delete a cache entry on fetch abort (dispose race), keep real failures
  cached (no retry storms).
- **A wall of tiles must not pay for a tank**: `ctx.dpr < 0.5` marks a
  thumbnail-scale mount (gallery hands `dpr = cardWidth/refWidth`) — cap the
  asset pool and skip post-processing composers there (UnrealBloom's shader
  compile is a main-thread spike per tile).
- Reference: `packages/saver-metaquarium/src/tank.ts` (+ `plan.ts` for the
  compiled swim itinerary, `materials.ts` for authored-vs-recoat lanes).

## Rules
1. **Render into `ctx.host` (or `ctx.surface`).** Canvas savers: check `ctx.surface`
   first — if present, use it as your canvas (this is the Worker/OffscreenCanvas path).
   If absent, create a canvas child inside `ctx.host`. Size the backing store with
   `ctx.dpr` (never read `window.devicePixelRatio` directly): `Math.min(ctx.dpr, 2)`,
   `setTransform(dpr,...)`. DOM savers: append absolutely-positioned elements into
   `ctx.host`; inject a `<style>` if needed. Namespace CSS class names with `is-`
   prefix so multiple CSS savers can coexist.
   **Worker-ready savers** that avoid all DOM APIs beyond canvas can set
   `manifest.workerReady: true` to enable off-main-thread rendering. Guard
   `canvas.remove()` in dispose with `if (canvas instanceof HTMLCanvasElement)`
   since OffscreenCanvas has no `.remove()`. See `warp.ts` for the reference pattern.
2. **Seeded, not random.** Replace every `Math.random()` with `ctx.rng.next()` /
   `.range(a,b)` / `.int(a,b)` / `.pick(arr)` / `.fork(salt)`.
   **Anything rebuilt after mount must draw from a `fork(salt)`, not `ctx.rng`.**
   `ctx.rng` is a running stream: build-time draws consume it, so a `resize()`
   that rebuilds particles or re-collects passthrough victims gets *different*
   values the second time and the same `(seed, t)` silently stops reproducing
   the frame. `fork(salt)` derives from the original seed, so every rebuild
   gets the identical stream. Assert it: render at `t`, `resize()` to the same
   dimensions, render at `t` again, expect an identical snapshot
   (`packages/saver-tide/src/tide.frames.test.ts`).
3. **`resize(w, h, dpr?)` not a listener.** The `<idle-screen>` element calls
   `resize()` on viewport changes (debounced, including DPR changes from zoom or
   browser zoom); never add your own `window.addEventListener('resize')`.
   When `dpr` is provided, update your stored DPR before resizing the canvas
   backing store (e.g. `if (dpr !== undefined) this.ctx.dpr = dpr; this.sizeCanvas();`).
4. **reducedMotion:** at mount call `setPaused(ctx.reducedMotion)`. `setPaused(true)`
   stops the rAF loop (freeze on last frame); `setPaused(false)` restarts it.
   For accumulative savers, consider pre-rendering a small snapshot for the
   reduced-motion still frame so it's not just a blank background.
   **`renderStill()` warmup budget:** if you run simulation steps synchronously
   to pre-render a still frame, keep the total work under ~100k cell-updates
   (e.g. N=256 grid × ~1.5 steps). The fluid saver's `for i<200` warmup is
   cheap because its CPU grid is 96×96×1 step; copying that loop count to a
   256×256×32-step simulation freezes the main thread for seconds.
5. **Self-contained:** NO external asset URLs. Substitute emoji drawn via canvas
   `fillText`, canvas-drawn shapes, inline SVG data URIs, or DOM text.
6. **Deep (steerable) savers** add a typed `paramSpace` to the manifest and read
   params each frame from a control-track:
   `const p = this.track ? sampleTrack(PARAM_SPACE, this.track, t) : this.defaults;`
   and expose a pure `renderFrame(t, seed)` (see saver-black-hole). This is what
   makes a saver deterministic + agent-steerable. Shallow savers skip both.
7. **Passthrough** (overlays + reads the live page): set `manifest.passthrough = true`
   and use `ctx.page.victims(selector)` to grab elements, saving/restoring their
   inline styles; `dispose()` MUST restore them.

## Declarative schema path (`@idle-screens/schema`)
Instead of writing imperative code, you can author a saver as a JSON `SaverSpec`
and compile it into a `SaverPlugin` via `compileSaver()`. The schema supports:
- **Sprite types:** `emoji`, `text`, `circle` (`soft: true` renders a radial glow orb)
- **Motion types:** `drift` (speed, angle, bob), `rise` (speed, sway), `bounce` (speed)
- **Backgrounds:** solid color or gradient with stops
- **Layers:** up to 8 layers, each with count + sprite + motion, plus optional
  `alpha: [min,max]` (per-entity opacity), `blend: 'lighter'` (additive glow),
  `region: {x?, y?}` (fractional spawn window — composition control), and
  `pulse: {amp, period}` (opacity breathing; amp ≤ 0.5, period ≥ 500ms, per-entity
  seeded phases — bounded so a layer can never strobe in unison)

Schema savers are flash-safe by construction (no full-field strobe primitive),
seeded, deterministic, and `renderFrame`-addressable. They go in
`packages/schema/src/examples/` (one file per spec, registered in `index.ts`) and get wired into the playground's schema panel
(`apps/playground/src/schema-panel.ts`) and `ALL_SAVERS` in `main.ts`.

**Limitations (as of the 2026-07-21 "v1 ceiling"):** the schema now covers spin,
grow, trails, links (nearest/chain/random), ghosting, wander/warp/path motion,
grid layout, lifecycle staging, and ring/streak/rect sprites. What it still can't
do: custom draw calls, particle interactions (real flocking/collision), and
per-pixel fields (fluid, reaction-diffusion). Those stay imperative — or wait
for a v2 simulation schema (`docs/v2-simulation-schema-notes.md`).

**Determinism/compat rule for schema features:** optional layer fields must only
consume EXTRA seeded-rng draws when the field is present in the spec, so specs
written before a feature existed keep bit-identical entity streams (guarded by
`determinism-baseline.test.ts` snapshot streams). Two traps proven in practice:
(1) **Never reorder existing draws.** Draw order in `buildEntities` is part of
the format contract — computing an existing draw (e.g. `pulsePhase`) earlier in
the loop shifts the stream for every spec using that field, even though the
draw count is unchanged. (2) **Derive, don't redraw.** When a new feature
replaces a seeded value with a computed one (e.g. position-derived wave phase),
still consume the historical draw in its original position, then PATCH the
computed value onto the entity after the push — toggling the feature must not
shift any other draw. New Entity fields must be optional-and-absent for old
specs or the snapshots churn.

## Integration checklist (classic savers)
When adding a saver to `packages/savers-classic/`, update ALL of these files:

1. **Create** `packages/savers-classic/src/{name}.ts` — the saver implementation
2. **Edit** `packages/savers-classic/src/index.ts` — add import, named export, and
   entry in `CLASSIC_SAVERS` array
3. **Edit** `packages/savers-classic/src/savers.test.ts` — add id to `EXPECTED_IDS`,
   update "expected N saver ids" count
4. **Edit** `apps/playground/e2e/savers.spec.ts` — add id to `ALL_IDS`, update
   "all N savers" count in test description
5. **Edit** `docs/specs/behavior-contract.md` — update "all N must honor" count
6. **If `workerReady: true`:** edit `packages/savers-classic/src/idle-worker.ts` to
   add to worker registry, and `apps/playground/e2e/worker.spec.ts` to add to
   `WORKER_SAVERS`
7. **Edit** `CREDITS.md` — add the saver to the "Original savers" table (or
   "After Dark" table if it's a port). Note the rendering approach and whether
   the implementation is clean-room or derived from an external source.

No edit needed to `apps/playground/src/main.ts` — classic savers auto-include via
`...CLASSIC_SAVERS` in the `ALL_SAVERS` array.

## Integration checklist (schema savers)
1. **Add** a spec file under `packages/schema/src/examples/` and register it in `SCHEMA_EXAMPLES` (`examples/index.ts`)
2. **Edit** `apps/playground/src/schema-panel.ts` — add import, button, click handler,
   and entry in `window.__schema.examples` (or rely on `SCHEMA_EXAMPLES` via harness)
3. **Edit** `apps/playground/src/main.ts` — add `compileSaver(MY_SPEC)` to `ALL_SAVERS`
4. **Edit** `apps/playground/e2e/savers.spec.ts` — add id to `ALL_IDS`, update count
5. **Edit** `docs/specs/behavior-contract.md` — update saver count

Schema example tests in `packages/schema/src/examples.test.ts` iterate
`EXAMPLE_SPECS` automatically — no manual test update needed.

## De-Angularization mapping (porting a screensaver component)
`@Input() paused/reducedMotion` -> `ctx.reducedMotion` + `setPaused`;
`afterNextRender(fn)` -> run in the constructor; `signal/computed/effect` -> plain
fields; `inject(ElementRef).nativeElement` -> `ctx.host`; `viewChild(canvas)` ->
the canvas you create; `DestroyRef.onDestroy` -> `dispose()`; `NgZone.*` -> delete.

## Reference files
- **Deep/steerable:** `packages/saver-black-hole/src/black-hole.ts` (paramSpace, control-track, passthrough)
- **Deep/steerable, fully frame-addressable:** `packages/saver-tide/src/tide.ts` — every
  quantity is closed-form in `t` (no `p += ...` accumulators), so `renderFrame` reproduces
  the *page's* transforms too, not just the canvas. Victims get the analytic Jacobian of the
  field as a real `matrix()` (shear/stretch), depth-graded `filter`, and style writes are
  diffed against the last written string.
- **Repaint canvas:** `packages/savers-classic/src/warp.ts` (worker-ready, rAF loop)
- **Accumulative canvas:** `packages/savers-classic/src/pipes.ts` (grid growth, resize rebuild)
- **DOM/CSS:** `packages/savers-classic/src/messages.ts` (CSS animations, style injection)
- **DOM/CSS cycling:** `packages/savers-classic/src/bsod.ts` (multiple screens, crossfade timer)
- **WebGPU dual-path (Navier-Stokes):** `packages/savers-classic/src/fluid.ts` + `fluid-gpu.ts` + `fluid-shared.ts` (Jacobi solver, boundary kernel, emitter injection)
- **WebGPU dual-path (Gray-Scott):** `packages/savers-classic/src/reaction-diffusion.ts` + `reaction-diffusion-gpu.ts` + `reaction-diffusion-shared.ts` (toroidal wrapping, per-cell reseed, no boundary kernel needed)
- **Schema/declarative:** `packages/schema/src/examples/` (SaverSpec JSON definitions)
