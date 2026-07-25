---
'@idle-screens/saver-tide': minor
---

New package: `@idle-screens/saver-tide` — a deep, steerable passthrough saver in the
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
