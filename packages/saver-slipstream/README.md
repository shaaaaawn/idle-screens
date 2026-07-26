# @idle-screens/saver-slipstream

Passthrough wind screensaver for idle-screens: the live page's blocks become obstacles in an analytic potential-flow field — streamlines thread between the content, part around it, and push it as they pass. Seeded, paramSpace, control-track, frame-addressable.

The fourth deep passthrough saver closes the loop the first three opened:

| | coupling |
| --- | --- |
| black hole | field → blocks (sampled at a point) |
| tide | field derivative → blocks (local affine) |
| limelight | blocks → blocks (occlusion) |
| **slipstream** | **blocks → field → blocks** (the page is the boundary condition) |

The wind is classical potential flow: a uniform stream plus one doublet per
obstacle (flow past a cylinder), superposed. It is closed-form at every point,
divergence-free, and visibly parts around each block. Streamlines are
integrated with fixed-step RK2 from seeded starts and cached per quantised
flow bucket — a pure function of `t` — and dust advects along the cached
polylines by arc-length offset, so real particle advection costs zero
per-frame integration. Blocks hinge at their base like grass and lean with the
**local** deflected wind, not the free stream: a block in a slab's lee feels
different air than one in the open.

`windAngle` is the steered vane and `veer` is drift around it, so a track that
pins `veer: 0` hands an agent the compass. Seek `renderFrame(t, seed)`
anywhere; the frame — canvas and page — reproduces exactly.

See the [idle-screens repository](https://github.com/shaaaaawn/idle-screens) for full documentation.
