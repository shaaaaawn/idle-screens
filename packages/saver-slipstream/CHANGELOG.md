# @idle-screens/saver-slipstream

## 1.0.5

### Patch Changes

- Updated dependencies [1204859]
  - @idle-screens/core@0.4.5

## 1.0.4

### Patch Changes

- Updated dependencies [374814d]
  - @idle-screens/core@0.4.4

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

- 3a10f2c: Keep the streamline crossfade from taxing the steady state, and advect dust /
  dashes along a continuous phase integral so the page lean follows live wind
  rather than a stale flow-bucket snapshot. Amortize streamline integration across
  the bucket window so bucket rebuilds stay smooth under `renderFrame(t, seed)`.
- Updated dependencies [3a10f2c]
  - @idle-screens/core@0.4.1

## 1.0.0

### Minor Changes

- 072780b: **New package: `@idle-screens/saver-slipstream`** — the fourth deep passthrough
  saver, and the one that closes the coupling loop: the page is the boundary
  condition of a physical field.

  The wind is classical potential flow — a uniform stream plus one doublet per
  obstacle (flow past a cylinder), superposed — so the velocity anywhere is
  closed-form. The page's largest blocks ARE the obstacles: streamlines visibly
  thread between paragraphs and part around images, drawn as travelling dashes
  with dust motes advected along the cached polylines by arc-length offset (real
  particle advection, zero per-frame integration). And the field pushes back:
  blocks hinge at their base like grass and lean with the LOCAL deflected wind —
  a block in a slab's lee feels different air than one in the open, which the
  unit tests assert. `windAngle` is the steered vane; a track pinning `veer: 0`
  hands an agent the compass. Streamlines rebuild on a t-derived flow bucket, so
  `renderFrame(t, seed)` reproduces any frame exactly, page transforms included.

  **limelight (minor): the image grew up.** The point light in the content became
  a theatre rig: the lamp hangs off-screen above the stage (`rigHeight`), so
  shadows rake down the page in near-parallel instead of radiating from a hotspot
  in the middle of the text. New: a volumetric beam drawn on an offscreen layer
  with the set's shadows CARVED out of it (the page's content visibly interrupts
  the shaft), side walls that give each lifted flat thickness, rim light along
  lamp-facing edges, a cold counter-light (`backLight`) with its own second
  shadow pass, distance-faded shadow gradients instead of flat slabs, and dust
  that rides the beam instead of orbiting a point. Params gained `rigHeight`,
  `beamStrength`, `backLight`, `rim`; costTier is now `high`.

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

- Updated dependencies [072780b]
- Updated dependencies [072780b]
  - @idle-screens/core@0.4.0
