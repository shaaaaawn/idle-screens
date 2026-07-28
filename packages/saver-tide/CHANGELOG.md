# @idle-screens/saver-tide

## 1.0.3

### Patch Changes

- Updated dependencies [f0831ef]
  - @idle-screens/core@0.4.3

## 1.0.2

### Patch Changes

- bae7b6b: `SaverManifest.timeModel` (`'closed-form' | 'simulated'`) — a semantic claim
  about how the saver relates to time, so tooling can prefer it over hardcoded
  per-saver capability lists. Catalog savers declare theirs; the playground
  properties panel surfaces the claim.
- Updated dependencies [bae7b6b]
  - @idle-screens/core@0.4.2

## 1.0.1

### Patch Changes

- Updated dependencies [3a10f2c]
  - @idle-screens/core@0.4.1

## 1.0.0

### Minor Changes

- 072780b: New package: `@idle-screens/saver-tide` — a deep, steerable passthrough saver in the
  black-hole family.

  A tide floods the live page. Where the black hole point-samples each page block and
  moves it rigidly, `tide` evaluates the **analytic Jacobian** of its wave field at each
  block and hands over that local affine, so submerged content stretches, squashes and
  shears with the wave. Light blocks are pulled up to raft on the surface (tilting with
  the local slope, bobbing, trailing a wake on the canvas); heavy ones sink and blur out
  of focus.

  Nothing in the saver integrates state across frames — water level, buoyancy and
  deformation are all closed-form in `t` — so `renderFrame(t, seed)` reproduces a frame
  exactly, **including the page's own transforms**, not just the canvas overlay.

  14 typed params (`waterLevel`, `tideSwing`, `waveAmp`, `waveScale`, `shear`,
  `buoyancy`, `depthBlur`, `caustics`, …) plus a `demoTrack`. Passes the WCAG 2.3.1
  flash gate and restores every inline style it touches on dispose.

### Patch Changes

- 072780b: **core:** new optional `SaverInstance.composition(): SaverLayer[]` — a mounted
  instance can describe its practical composition stack, bottom-up: the `page`
  deck a passthrough saver performs on (host-bound; the saver only borrows the
  document), the `surface`(s) it owns, and the logical draw `pass`es inside
  them. Deliberately distinct from the schema's declared sprite layers, and
  deliberately small: multi-surface savers, per-pass toggles and cross-saver
  scenes extend this model rather than replacing it.

  All four deep passthrough savers (catwalk, tide, limelight, slipstream) now
  describe their stacks. The playground's Layers panel renders the stack for
  any mounted saver — compositor-style, top deck first, with eye toggles that
  solo decks for inspection (hide the page, keep the performer; hide the
  overlay, watch the pure page deformation).

- 072780b: New package: `@idle-screens/saver-limelight` — the third deep passthrough saver,
  and the first where the page's blocks interact with **each other**.

  A key light hangs from a rig OFF-SCREEN above the stage and rakes its pool
  across the live page. Every block gets a height (small chips read as standing
  flats, a hero image is stage floor), stands off the page with viewer-relative
  parallax and visible side walls, and casts a distance-faded silhouette shadow
  from an apex above the frame — so shadows sweep the page in near-parallel
  instead of radiating from a hotspot in the content. A cold counter-light hung
  opposite the key adds a second, fainter shadow and a blue rim.

  The picture is built so the set acts on the light, not just under it: the pool
  is an additive glow the shadows visibly carve (which is what makes the shadow
  story read even on dark pages), and the volumetric shaft is drawn on its own
  layer with the set's shadow slots punched out of it before compositing — the
  beam is visibly interrupted by the page's own content, with dust riding it and
  a terminal splash where it lands. And a block standing behind another block is
  dimmed by it: that block-on-block occlusion is the step past black hole (a
  field applied to blocks) and tide (a field's derivative applied to blocks).
  The content is the set.

  The light aims in **content-box space**, not viewport space: `lightX: 0.5`
  means "the middle of the content", so on a page with a centered column the
  pool tracks the column instead of spending half its roam lighting empty
  margin. `lightX`/`lightY` are the steered aim and the roam is an offset around
  it, so a track pinning `roamX: 0, roamY: 0` gives an agent absolute control.
  18 typed params plus a `demoTrack` that rakes cross-stage and tightens to a
  warm followspot.

  Occlusion resolves on a clock bucket derived from `t` — never a frame counter —
  so `renderFrame(t, seed)` reproduces a frame exactly, page transforms included.

  **tide (patch):** per-block buoyancy, draft and bob phase now come from
  `rng.fork(index)` rather than the shared cursor. `resize()` re-collects victims,
  and drawing from the shared stream silently re-rolled every block's buoyancy on
  each viewport change — so the same `t` rendered differently before and after a
  resize. Caught by the new seek-and-resize determinism test.

- Updated dependencies [072780b]
- Updated dependencies [072780b]
  - @idle-screens/core@0.4.0
