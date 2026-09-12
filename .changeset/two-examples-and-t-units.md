---
"@idle-screens/schema": patch
---

Two worked examples for features that had none, plus one units clarification.

- **`sparse-night`** — the `density: 'sparse'` declaration in use: a star-grain
  field under the advisory's coverage threshold, one chain-linked figure, one
  satellite that flares every eighteen seconds. Shows the declaration
  withholding `sparse-scene` while opting into `density-mismatch` honesty.
- **`typed-cue`** — `textBlock.reveal` in both moods: a typewriter block with a
  caret (`speed` makes it self-type on the scene clock) and a `glyphFade` block
  that arrives as a wave of overlapping alphas. Both declare `opacity` so the
  path is steerable. The one non-text layer (a soft scan band) keeps the scene
  off the `text-heavy` advisory.
- **FORMAT.md** — `perceiveScene`'s `t` is milliseconds (the MCP `previewScene`
  tool's `t` is seconds and converts). Passing seconds to the library makes a
  self-typing block read as one that never finishes, which wasted a debugging
  pass on the `typed-cue` example.

Determinism baselines for both new examples are pinned in the snapshot suite.
