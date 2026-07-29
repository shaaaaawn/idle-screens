# @idle-screens/saver-metaquarium

The screen is a tank. A three.js aquarium populated by Metaquarium fish
([metaquarium.xyz](https://metaquarium.xyz)) — either the bundled hero breed or
live NFT fish streamed from the Metaquarium farm over IPFS — swimming seeded
analytic paths through a dark, fogged, bloom-lit scene.

- **WebGL2** (`minBackend: 'webgl2'`), three.js loaded lazily on first mount.
  A canvas-2D silhouette tank stands in where WebGL2 is unavailable — the tank
  is never blank.
- **Deterministic**: seeded rng only, closed-form swim (`renderFrame(t, seed)`
  is frame-addressable), `timeModel: 'closed-form'`.
- **Steerable**: camera azimuth/elevation/distance, auto-rotate, fish count,
  swim speed, fog color, bloom strength — all live via control track. String
  params (`farmUrl`, `tankTokens`, `ipfsGateway`, `fishUrl`) select which fish
  live in the tank.
- **Device-tiered**: `@idle-screens/capabilities` scales pixel ratio, AA,
  bloom resolution and fish cap; WebGPU-class hardware gets the full tank.
- Zero-dep **`./manifest`** subpath so servers can validate published params
  without pulling three.js.

**Asset note:** unlike most idle-screens savers, this package's saver fetches
remote assets (GLBs from the farm/IPFS) by design — it is first-party trusted
code, same category as the fluid/black-hole savers, not a schema saver. The
bundled beta-fish GLB ships with the host app (playground `public/assets/…`),
not inside the npm package.
