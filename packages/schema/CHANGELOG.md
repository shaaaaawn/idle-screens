# @idle-screens/schema

## 2.1.0

### Minor Changes

- cf2591b: SaverSpec format upgrades: multi-color circles (colors[]), glyph/text cycling (cycle.period), inter-entity links (links with k-nearest toroidal neighbors), viewport-relative units, sparse-scene advisory, constellation example saver, and toroidal link drawing fix.

## 2.0.0

### Minor Changes

- 7c68846: Worker/OffscreenCanvas rendering for canvas savers (`workerReady`, generation-token mount races fixed); new savers (pipes, bsod, flurry, fluid, reaction-diffusion, mystify) with WebGPU dual-path where applicable and WKWebView GPU skip; schema v2 primitives (alpha, blend, region, pulse, soft) plus published SaverSpec JSON Schema + FORMAT.md; live steering via `applyTrack` on compiled specs (`steer` helpers exported); host-owned fallback slot on `<idle-screen>` (`slot="fallback"` when mount fails); `previewAt` hook for timeline-driven previews; security: prototype-pollution guard in `resolveSpecPath`, `validateSpec` gate on track deltas, worker mount clears fallback class

### Patch Changes

- Updated dependencies [7c68846]
  - @idle-screens/core@0.3.0

## 1.0.0

### Minor Changes

- 9fa2a68: Add Worker/OffscreenCanvas rendering, new savers (pipes, bsod, flurry, fluid, reaction-diffusion), and schema extensions (static motion, positioning, text alignment, dashboard support)

### Patch Changes

- Updated dependencies [9fa2a68]
  - @idle-screens/core@0.2.0
