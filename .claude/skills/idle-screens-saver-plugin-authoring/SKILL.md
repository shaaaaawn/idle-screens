---
name: idle-screens-saver-plugin-authoring
description: |
  Author a new saver for the idle-screens library, or port an existing Angular/
  React screensaver into one. Use when adding a saver to packages/savers-* or a
  new saver package, or wiring one into the engine/registry. Covers the
  SaverPlugin/SaverInstance/SaverContext contract, the host-based rendering seam
  (canvas vs DOM), seeded RNG (no Math.random), the optional paramSpace +
  control-track for steerable/deterministic savers, and passthrough page-eating.
author: Claude Code
version: 1.0.0
date: 2026-07-03
---

# Authoring an idle-screens saver

## The contract (`@idle-screens/core`)
```ts
interface SaverContext {
  host: HTMLElement;      // full-viewport container you render INTO
  width: number; height: number;
  rng: Rng;               // seeded PRNG — use this, NEVER Math.random()
  seed: number;
  reducedMotion: boolean;
  page?: PageContext;     // present for passthrough savers (read/eat live page)
}
interface SaverInstance {
  setPaused(paused: boolean): void;   // freeze/resume the loop
  resize(w: number, h: number): void; // runtime calls this; do NOT add a window 'resize' listener
  renderFrame?(t: number, seed: number): void; // pure, frame-addressable (optional)
  applyTrack?(track: ControlTrack): void;       // steer params over time (optional)
  dispose(): void;        // stop rAF/timers; restore any page mutations
}
interface SaverPlugin { manifest: SaverManifest; mount(ctx): SaverInstance | Promise<SaverInstance>; }
```
Export `export const mySaver: SaverPlugin = { manifest, mount: (ctx) => new MyInstance(ctx) };`

## Rules
1. **Render into `ctx.host`.** Canvas savers: create a canvas child, size the
   backing store with dpr (`Math.min(devicePixelRatio, 2)`), `setTransform(dpr,...)`.
   DOM savers (toasters, DVD, messages): append absolutely-positioned elements;
   inject a `<style>` into host if needed. The runtime clears `host` on dispose.
2. **Seeded, not random.** Replace every `Math.random()` with `ctx.rng.next()` /
   `.range(a,b)` / `.int(a,b)` / `.pick(arr)` / `.fork(salt)`.
3. **`resize(w,h)` not a listener.** The `<idle-screen>` element calls `resize()`;
   never add your own `window.addEventListener('resize')`.
4. **reducedMotion:** at mount call `setPaused(ctx.reducedMotion)`. `setPaused(true)`
   stops the rAF loop (freeze on last frame); `setPaused(false)` restarts it.
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

## De-Angularization mapping (porting a screensaver component)
`@Input() paused/reducedMotion` -> `ctx.reducedMotion` + `setPaused`;
`afterNextRender(fn)` -> run in the constructor; `signal/computed/effect` -> plain
fields; `inject(ElementRef).nativeElement` -> `ctx.host`; `viewChild(canvas)` ->
the canvas you create; `DestroyRef.onDestroy` -> `dispose()`; `NgZone.*` -> delete.

## Register
Add the plugin to the consuming app's plugin array (or the classic-savers
`index.ts`). The engine picks the active one by `manifest.id` via
`config.defaultPluginId` + `config.selection` ('fixed' | 'random' | 'rotate').

## Reference
`packages/saver-black-hole/src/black-hole.ts` is the canonical DEEP example
(seeded, paramSpace, control-track, passthrough). `packages/savers-classic/src/*`
are shallow examples.
