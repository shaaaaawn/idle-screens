---
'@idle-screens/schema': minor
---

`density: 'sparse' | 'normal' | 'dense'` — a declared density intent on the spec, the way `motionIntensity` declares tempo. `sparse` says the emptiness is the point: `adviseSpec` withholds `sparse-scene`, and coverage-gated scorers can read the declaration before scoring a faithful one-mark scene as broken (the holdout house style built on restraint sat at the suite floor for exactly this reason). `dense` withholds `dense-scene`. The declaration is checked against measured coverage and a new `density-mismatch` advisory fires when the scene contradicts it. Additive: specs without `density` render and advise exactly as before.
