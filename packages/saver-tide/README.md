# @idle-screens/saver-tide

Passthrough tide screensaver for idle-screens: a rising water field that refracts, shears and floats the live page's own content. Seeded, paramSpace, control-track, frame-addressable.

Where the black hole point-samples each page block and moves it rigidly, `tide`
evaluates the analytic **Jacobian** of its wave field at every block and hands
the block that local affine — so text under water stretches, squashes and shears
with the wave instead of merely sliding. Light blocks float up and raft on the
surface; heavy ones sink out of focus.

Every parameter is a closed-form function of `t` (no integrated state), so
`renderFrame(t, seed)` reproduces a frame exactly — canvas *and* page.

See the [idle-screens repository](https://github.com/shaaaaawn/idle-screens) for full documentation.
