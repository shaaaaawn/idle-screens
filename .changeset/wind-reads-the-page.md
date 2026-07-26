---
'@idle-screens/saver-slipstream': minor
'@idle-screens/saver-limelight': minor
---

**New package: `@idle-screens/saver-slipstream`** — the fourth deep passthrough
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
