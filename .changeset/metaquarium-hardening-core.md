---
'@idle-screens/core': patch
---

`integrateParam` — closed-form ∫₀ᵗ of a tracked number param's curve, mirroring `sampleTrack`'s exact ramp semantics (dur-ramps, previous-keyframe ramps, step/linear/smooth eases, loop wrap). For savers that multiply a rate by a steered param: integrating the curve makes rate changes glide instead of rescaling all elapsed motion, while staying pure and deterministic — `integrateParam(space, track, path, t, bounds?)`, same inputs, same integral. Optional `bounds` clamps the curve's keyframe values to a declared range (endpoint clamping bounds the whole curve, since every ease is monotone). For number params, `sampleTrack` now coerces finite numeric-string keyframes and ignores junk values — the stringified-`value` MCP trap previously made "22" step as a string instead of meaning 22.
