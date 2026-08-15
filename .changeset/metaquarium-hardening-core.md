---
'@idle-screens/core': patch
---

`integrateParam` — closed-form ∫₀ᵗ of a tracked number param's curve, mirroring `sampleTrack`'s exact ramp semantics (dur-ramps, previous-keyframe ramps, step/linear/smooth eases, loop wrap). For savers that multiply a rate by a steered param: integrating the curve makes rate changes glide instead of rescaling all elapsed motion, while staying a pure function of `(space, track, t)`.
