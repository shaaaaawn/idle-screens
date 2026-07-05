/**
 * Framework-agnostic reactivity. We re-export `@preact/signals-core` so the rest
 * of the engine uses the same `signal` / `computed` / `effect` primitives it did
 * as Angular signals, with near-identical semantics.
 */
export {
  signal,
  computed,
  effect,
  batch,
  untracked,
  type Signal,
  type ReadonlySignal,
} from '@preact/signals-core';
