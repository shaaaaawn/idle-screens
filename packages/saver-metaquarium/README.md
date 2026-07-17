# @idle-screens/saver-metaquarium

The screen is a tank. A three.js aquarium saver ported from
[Metaquarium](https://metaquarium.xyz) — fish swim seeded, analytic Lissajous
wander paths through a fogged, lit volume under a displaced water plane.

- **WebGL2** (`minBackend: 'webgl2'`), main thread; three.js loads lazily on
  first `mount()`.
- **Deterministic:** all randomness from the seeded `Rng` (forked per fish), all
  motion a pure function of logical time — `renderFrame(t, seed)` works once
  assets resolve.
- **Steerable** via `paramSpace`/`applyTrack`: camera azimuth/elevation/distance,
  auto-rotate, fish count, swim speed, fog color, fish GLB URL (`string` param).
- `@idle-screens/saver-metaquarium/manifest` is a zero-dependency subpath export
  (manifest + paramSpace only) for server-side param validation without three.

Walking-skeleton status: one breed (GLB via `fishUrl`, procedural fallback if
the fetch fails). The full port plan lives in `docs/metaquarium-port.md`.
