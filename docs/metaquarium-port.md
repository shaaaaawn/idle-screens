# Metaquarium → idle-screens Port Plan

> Status: **active plan** (2026-07-17). Phases 1–4 implemented on `feature/saver-metaquarium`
> (walking skeleton + live farm pipeline + bloom + e2e). Phase 5 (idle-server) next.
> Source artwork: `~/code/metaquarium` (Angular 17 + three.js NFT aquarium, metaquarium.xyz).
> Channel server: `~/code/idle-server` (Cloudflare Worker + Durable Objects, idlescreens.com).

## Goal

Port Metaquarium — fish tanks populated by NFT fish fetched from a live API — into
idle-screens as a new saver package, **`@idle-screens/saver-metaquarium`**, deployable
as channels: a screen is a tank with your fish, viewable at
`idlescreens.com/channel/<id>`, steerable live (camera, feeding, which fish) over MCP.

The port doubles as the reference implementation for a new *class* of saver:
imperative 3D scenes with remote assets and data feeds — scalable to future projects
(3D orrery, data dashboards, etc.).

## Decisions (locked)

| Decision | Choice | Why |
| --- | --- | --- |
| Package name | `packages/saver-metaquarium` | — |
| Renderer | **WebGL2 only** (`minBackend: 'webgl2'`) | Direct port of WebGLRenderer + GLSL + UnrealBloom; works everywhere incl. Mac WKWebView (where WebGPU is broken per `gpu-eligible.ts`); WebGPU would force a TSL shader rewrite for zero visual gain at this workload. Revisit when three's WebGPURenderer-with-WebGL-fallback matures. |
| three.js version | **latest (0.185.x)** | Start the package with no legacy debt; example-module APIs used (GLTFLoader, DRACOLoader, UnrealBloomPass) are stable from 0.169. |
| Saver type | **Trusted imperative `SaverPlugin`** | The declarative schema is 2D-only and its security model is no-I/O by construction (THREAT-MODEL boundary 1). A fetching 3D saver is first-party trusted code, same category as black-hole/fluid. Do NOT extend the schema toward 3D. |
| Worker | `workerReady: false`, main thread | WebGL + DOM canvas path; asset fetch/decode can use its own internal worker later (metaquarium precedent). |
| three loading | `dependency` of the saver package, **dynamically `import()`ed inside `mount()`** | First heavy runtime dep in the monorepo; keeps it out of core and off the wire until the saver actually mounts. |

## Source material: what Metaquarium is (key findings)

- Angular 17 + vanilla three.js 0.169. The three layer
  (`angular/src/app/_shared/three-classes/`, ~8.8k LOC) is cleanly separable:
  classes take `(scene, guiParams)` and expose `load/update/dispose`. The Angular
  `HomeComponent` (2.1k LOC) is orchestration glue we replace with the saver contract.
- **Fish pipeline:** public unauthenticated AWS Lambda cache
  (`{lambda3}/y2k/stream/cache`, prod base
  `https://f0ag1g19u8.execute-api.us-west-1.amazonaws.com/production/backend`) lists
  fish metadata (OpenSea-style attributes; `"3d"` field = GLB URL). GLBs are
  DRACO-compressed, fetched from IPFS via our gateway
  `https://hermosa.thepartridge.net/ipfs/` (we control CORS). A web worker fetches
  buffers; `GLTFLoader.parse` on main thread. ERC721A contract
  `0x680cCc4fE7aa62172D20899Ab87C5304545431CB` is only needed for minting — **rendering
  needs no chain access**.
- **Motion:** procedural sinusoid + drift (`SwimSystem`) for most breeds — analytic,
  portable to pure `renderFrame(t)`. Shark is a steering state machine
  (`shark.swim.ts`) — needs a seeded fixed-timestep sim instead. Skeletal swim clips
  via a shared `AnimationMixer`/`AnimationObjectGroup` per breed. Sprite-billboard LOD
  beyond 1000 units.
- **Determinism blockers to fix in port:** 91 unseeded `Math.random()` calls,
  `Date.now()` in swim systems, `new Date().getHours()` in water. Port rule: all
  randomness through `ctx.rng` (fork per fish: `rng.fork(tokenId)`), all time from
  engine `t`/`delta`.
- **Post FX:** selective UnrealBloom via two composers + layer mask + additive
  composite ShaderPass. Portable as-is under WebGL.
- Prior port attempts (WKWebView saver stub, Electron app) wrapped the whole webapp
  and died; this port extracts the engine into a contract built for idle screens.

## Engine fit: what idle-screens already provides

- `mount()` may return a Promise — async asset loading is first-class, with a
  host fallback slot on failure and mount-race tokens discarding slow loads
  (`idle-screen.element.ts:414`, `:431`).
- `minBackend: 'webgl2'` exists in the capability model; **this saver is its first
  consumer**. Precedent shape: `fluid.ts` async dual-path mount.
- `paramSpace` + control-track: typed, ranged, live-steerable knobs with
  smooth interpolation; `SaverInstance.applyTrack()` already exists (black-hole
  implements it).
- `@idle-screens/capabilities` provides device tiering for fish count / bloom /
  pixel-ratio decisions.
- Validator flash/perf gates consume sampled frames — with pinned fixture assets and
  the analytic swim path, a bloom-heavy 3D saver can still be CI-gated.

## Gaps being added (engine work)

1. **`'string'` param type** (core): needed for `whichTank` (wallet address /
   token-id list) and asset URLs. Snaps like enum (no interpolation) —
   `lerpValue`'s fallback already does this.
2. **Zero-dep `./manifest` subpath export** from the saver package, so idle-server's
   Worker can validate params without bundling three.js.
3. **Loading UX pattern** (no engine primitive): acquire canvas synchronously in
   mount, draw a shimmer loading state, stream fish in as GLBs arrive.
4. **Long-running hygiene**: WebGL context-loss recovery, honor
   `setPaused`/`reducedMotion`, FPS cap + capability tier for thermals.

## idle-server integration (separate repo, Phase 5)

Verified seams in `~/code/idle-server`:

- **Allowlist:** `src/classic-savers.ts` `CLASSIC_SAVER_LIST` — checked by
  `specProblems()` (`src/worker.ts:117–139`) on every publish. Add
  `{ id: 'metaquarium', … }`.
- **Drift gate:** `scripts/build-site.mjs:74–97` fails the build for allowlisted ids
  not shipped by `@idle-screens/savers-classic`. This is why **black-hole is currently
  unpublishable**. Fix: teach the gate about first-party saver packages beyond
  savers-classic (unblocks black-hole channels too).
- **Viewer registry:** `site/src/App.tsx:8–9` `ALL_SAVERS` — import the plugin.
  Scenes arrive over WebSocket `/c/:id/ws`.
- **Params lane (new work):** classic savers publish as bare `{id}`; `setParam`/
  `applyTrack` reject them (path resolution only works on schema specs), and there's
  no per-channel config store. Design:
  - Extend publishable shape to `{ id, params?: Record<string, ParamValue> }`,
    validated in `specProblems` against the saver's `paramSpace` (via the `./manifest`
    subpath import).
  - `setParam`/`applyTrack` for id-savers resolve paths against `paramSpace` keys and
    append `TrackDelta`s exactly like the schema lane.
  - Viewer forwards track messages to the mounted instance's `applyTrack()` (client
    half already exists in core).
  - This generalizes: every future imperative saver gets per-channel config + MCP
    steering for free.
- **CSP (introduce with this feature):** no CSP exists today anywhere on
  idlescreens.com. Add in the SPA-fallback branch (`worker.ts:1731–1761`):
  `connect-src` for the Lambda origin + `hermosa.thepartridge.net`;
  `img-src`/`worker-src blob: data:` (three decodes GLB textures via blob URLs — known
  strict-CSP failure mode).
- Rate limits (60 mutations/min/channel) and `isk_` token auth need no changes.
- Mac app (optional, later): add to `site/mac/savers.ts` catalog; sha-256 manifest
  handles the bundle; WebGL2 works in WKWebView.

## Live-endpoint findings (verified 2026-07-17)

- The production farm cache is **up**: 512 fish with full OpenSea-style metadata.
- The API **allowlists Origins server-side** — `metaquarium.xyz` works,
  `localhost`/`idlescreens.com` are rejected. Dev uses a Vite proxy
  (`/farm` → Lambda, wearing the metaquarium.xyz Origin); production needs either
  an idle-server proxy route or an AWS CORS allowlist entry for idlescreens.com.
- The `hermosa.thepartridge.net` IPFS gateway is currently **down**;
  `ipfs.io` serves the CIDs with permissive CORS and is the default
  `ipfsGateway` param.
- **Live NFT fish GLBs are plain glTF — no DRACO** (only local NPC assets were
  draco'd). The farm pipeline therefore needs no decoder; DRACO support is only
  needed if bundled NPC breeds are added later.
- Fish GLBs carry a `Swim` clip and `GLOW *` materials; the saver maps GLOW
  materials to emissive so UnrealBloom picks them up (metaquarium's look).

## Phases

1. **Engine prep** *(this branch)* — `string` param type; manifest subpath pattern.
2. **Walking skeleton** *(this branch)* — package scaffold; one bundled beta fish GLB
   swimming in a lit, fogged tank with water plane, in the playground. Proves
   WebGL2 + GLTF/DRACO + skeletal + seeded-analytic swim end-to-end.
   Early smoke test in Mac WKWebView (riskiest unknown).
3. **The port** (1–2 wk) — extract water/lights/simplified floor/4–5 breeds/swim
   systems/LOD/track/bloom (~3–4k LOC; skip floor editor, XR, arcade UI, player-path
   camera). Seed everything; analytic base swim → working `renderFrame(t, seed)` with
   pinned assets.
4. **Live fish pipeline** — Lambda cache fetch + IPFS GLB streaming with progressive
   spawn-in; bundled DRACO decoder; capability-tiered fish count/bloom; full
   paramSpace (`whichTank`, `cameraAzimuth`, `cameraPitch`, `autoRotate`,
   `followToken`, `feedRate`, `bloom`).
5. **Server integration** (idle-server, ~2–4 d) — allowlist + drift gate + viewer
   registry + `{id, params}` lane + CSP.
6. **Channel pilot** — `channel/shawns-tank`; steer over MCP; overnight soak
   (GPU memory/thermals); then Mac catalog.

## Determinism strategy

- **Tier A (mandatory):** seeded rng everywhere, engine-injected clock.
  Reproducible given same fish list + seed.
- **Tier B (do it):** analytic base swim → pure `renderFrame(t, seed)` → workbench
  scrubbing + validator gates in CI against fixture GLBs.
- **Tier C (defer):** shark state machine as seeded fixed-timestep sim —
  deterministic replay, not seekable.

## Risks

- Mac WKWebView WebGL2 behavior (test in Phase 2, not Phase 6).
- three example-module API drift 0.169 → 0.185 during shader/bloom port.
- GPU memory/thermals over hours-long runs — dispose discipline, LRU asset cache,
  FPS cap.
- IPFS gateway availability/CORS from idlescreens.com origin (we control hermosa).
- Flash-gate risk from bloom + emissive materials — keep the validator in the loop.
