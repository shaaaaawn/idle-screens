# idle-screens: a 2026 web screensaver library (vision + roadmap)

> **Status (July 2026):** this is the original thinking doc that drove the
> extraction of `idle-screens` from `shawn-site`. The thesis, agentic analysis,
> and control-plane architecture still hold. Code references have been updated
> to match the shipped v0. Sections that describe work not yet built are marked
> **[FUTURE]**. The authoritative specification of what v0 *must do* is
> [`behavior-contract.md`](../specs/behavior-contract.md).

---

## 1. Thesis

A 2026 screensaver library is not "a bag of canvas demos." It is a
**capability-tiered, agent-operable ambient-visual engine** with:

- a **framework-agnostic Web Component core** (`<idle-screen>` custom element),
- a **declarative, agent-authorable saver schema** (`@idle-screens/schema`),
- **safety + performance gates** that make agent-generated content shippable by
  construction (no seizure risk, no battery melt) (`@idle-screens/validator`),
- a debug hook (`window.__idleScreens`) that a future **MCP control surface**
  can wrap, and
- an architecture that can grow into **native wrappers** (macOS `.saver`,
  Windows `.scr`, Tauri desktop).

The "wow" is passthrough page-aware overlays. The durable value is being
**agent-operable and agent-safe**.

---

## 2. What the 2026 platform newly makes possible

The shift since the "canvas + requestAnimationFrame" era: the GPU-compute path
and the off-main-thread path are both mainstream, and there is a real idle /
ambient API surface.

- **WebGPU is roughly baseline** (~85% globally, March 2026: Chrome/Edge 113+,
  Firefox 141+ / 145 on macOS, Safari 26 across macOS/iOS/iPadOS/visionOS). The
  headline for a saver lib is **compute shaders**: real particle / fluid / n-body
  / noise sims and true screen-space gravitational lensing (sample a texture, bend
  it) that a Canvas2D saver can only fake. Transformers.js / ONNX run on the WebGPU
  backend, so on-device generative / reactive savers are viable.
- **OffscreenCanvas + a Web Worker** is the single most important architectural
  change for a library: run the whole render loop off the main thread so the host
  app never janks. A saver that stutters the page it protects is a bug, and in
  2026 that is avoidable by default.
- **CSS-only motion for the low-power tier:** Houdini Paint worklets +
  scroll-driven animations run on the compositor with no JS loop. Ideal for a
  battery-friendly "ambient" mode.
- **WebCodecs** can record a saver to a shareable clip, or play a pre-baked
  hardware-decoded video saver on weak devices.
- **Idle Detection API** gives real OS-level "user idle / screen locked /
  screensaver active" signals instead of custom mousemove timers; **Screen Wake
  Lock** lets an opt-in ambient display stay awake deliberately.
- **The constraint that is now first-class:** OLED burn-in + battery. Google Play
  began enforcing wake-lock battery quality in March 2026. A 2026 lib treats
  eco / OLED-awareness (true-black, pixel-shift, dim static UI) as a feature.

Sources: [web.dev WebGPU](https://web.dev/blog/webgpu-supported-major-browsers),
[WebGPU support 2026](https://webo360solutions.com/blog/webgpu-browser-support/),
[MDN OffscreenCanvas](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas),
[Houdini](https://developer.mozilla.org/en-US/docs/Web/API/Houdini_APIs),
[Scroll-driven animations](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Scroll-driven_animations),
[WebCodecs](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API),
[Idle Detection](https://whatwebcando.today/idle.html),
[Wake Lock](https://developer.chrome.com/docs/capabilities/web-apis/wake-lock),
[Android battery enforcement](https://android-developers.googleblog.com/2026/03/battery-technical-quality-enforcement.html).

---

## 3. Product pillars (what it feels like)

1. **Capability tiers with graceful degradation.** One saver, four backends:
   WebGPU -> WebGL2 -> Canvas2D -> CSS-only ambient. Auto-detect and pick. Honor
   `prefers-reduced-motion`, `prefers-reduced-transparency`, `Save-Data`, and
   battery / OLED. Green and accessible by construction.
   *v0: `@idle-screens/capabilities` detects backends and tiers savers. Two
   savers (fluid, reaction-diffusion) have WebGPU compute-shader backends that
   auto-detect and fall back to Canvas2D. The dual-path pattern (async mount,
   GPU probe, CPU fallback) is documented in the saver authoring skill.*
2. **Zero-jank by default.** OffscreenCanvas-in-a-worker for canvas savers that
   opt in via `manifest.workerReady: true`. The `SaverContext.surface` seam lets
   the same saver code render on either an `HTMLCanvasElement` (main thread) or an
   `OffscreenCanvas` (Worker), with automatic fallback when the browser lacks
   `transferControlToOffscreen` or the Worker fails to start.
3. **Framework-agnostic core, thin adapters.** Core is a Web Component
   (`<idle-screen>`) + a plain TS API. ESM, tree-shakeable, each saver its own
   lazy chunk.
   *v0: the Angular site consumes published npm packages (`@idle-screens/core`,
   `@idle-screens/saver-black-hole`, `@idle-screens/savers-classic`) via the
   registry. **[FUTURE]** React/Vue/Svelte adapters (~30-line wrappers each).*
4. **Ambient-aware, not just blackout.** The passthrough "overlay that reads and
   interacts with the live page" (our black hole that eats the DOM) is a signature
   primitive, with a clean "context provider" seam (palette, DOM, scroll). Most
   libs black the screen; this one can define the "ambient overlay" category.
   *v0: black hole (gravitational lensing) and spotlight (roaming light) are
   both passthrough savers.*
5. **A clean plugin contract** (see section 8): lifecycle + a capability manifest
   the runtime and tooling read without executing the saver.
   *v0: `SaverManifest` with `costTier`, `motionIntensity`, `minBackend`,
   `passthrough`, `a11y`, optional `paramSpace`. 20 savers ship.*
6. **Deterministic + themeable.** Seedable RNG, frame-addressable rendering, CSS
   custom-property theming so a brand restyles every saver from tokens.
   *v0: seeded RNG + `renderFrame(t, seed)` + `applyTrack()` proven on the
   black hole; determinism tested in Playwright. **[FUTURE]** CSS custom-property
   theming (the `palette` manifest field exists but is not wired at runtime).*

---

## 4. Agentic considerations beyond "an agent can generate one"

Generation is table stakes. The durable value is being **agent-operable,
agent-safe, and agent-legible**.

- **Ship an agent control surface as a product.** v0 standardized the debug hook
  as `window.__idleScreens` (sleep / wake / toggle / setPlugin / openMenu /
  closeMenu / state / active / plugins). **[FUTURE]** Wrap this into an **MCP
  server** so an agent can list savers + manifests, set active, pause, tune
  params, screenshot, and run a health probe.
- **Deterministic reproduction is an agent primitive.** `saver.renderFrame(t,
  seed)` (pure, frame-addressable) so an agent can screenshot / diff / QA a change
  without animation-timing roulette.
  *v0: proven on the black hole; the playground two-canvas demo confirms
  byte-identical renders.*
- **Declarative, agent-authorable scene schema.** Highest-leverage move: let
  savers be describable by a typed JSON schema an agent can read, write, and
  validate, not only imperative canvas code. An agent modifies a saver by editing
  a schema with guardrails and cannot reach outside the sandbox.
  *v0: `@idle-screens/schema` -- `validateSpec` + `compileSaver` + safety caps.*
- **Agent-safe by construction (the real moat): automated photosensitivity + budget
  gates.** The library validates every saver, including agent-generated ones,
  against WCAG 2.3.1 flash thresholds (<= 3 flashes/sec, relative-luminance limits)
  and a perf budget (FPS / GPU cost per device tier), and refuses to ship one that
  fails. "Let an agent generate a screensaver" then cannot produce a seizure risk
  or a battery-melting sim. No OSS saver lib does this today.
  *v0: `@idle-screens/validator` -- per-tile flash analysis, area threshold,
  perf cost tiers, e2e validated in Playwright.*
- **Self-describing manifests for context-aware selection.** Because each saver
  declares cost / tier / passthrough / palette / motion, an agent or the runtime
  picks the right saver for this device and this page without executing it.
  *v0: `@idle-screens/capabilities` -- `evaluateSaver` gates on backend +
  cost + reduced-motion.*
- **[FUTURE] Provenance.** Agent-generated savers carry metadata (prompt, seed,
  model) for an OSS community gallery. The `provenance` field exists on
  `SaverManifest` but is not populated by any shipped saver.
- **Semantic legibility for the agent operating the host.** An active overlay is
  `inert` + `aria-hidden`, and exposes "a screensaver is active; dismiss via X" so
  a page-driving agent or assistive tech is not blinded. The flip side of
  generation: do not break other agents.

---

## 5. Agent-to-UI streaming: control plane, not frame plane

The protocols in the agent-UI space all stream the SAME kind of thing: discrete,
low-frequency, semantic events (tokens, tool-call JSON, generative-UI component
trees, state patches, task steps, human-in-the-loop approvals), roughly 1 to 10
events per second. That is true of all of them:

- **Agent Client Protocol (ACP):** "LSP for agents," decouples a UI (editor / CLI /
  web client) from the agent. A session / control channel.
- **AG-UI (Agent-User Interaction Protocol, CopilotKit):** an event stream over
  HTTP/SSE of messages, tool calls, **state patches**, and lifecycle signals;
  adopted by Google, LangChain, AWS, Microsoft, Mastra, PydanticAI.
  ([AG-UI docs](https://docs.ag-ui.com/introduction))
- **AI Engineer Foundation Agent Protocol:** OpenAPI task / step / HITL endpoints.
- **Vercel AI SDK Data Stream Protocol:** multiplexes text + tool-call JSON + RSC
  over one HTTP stream; the workhorse behind chat-embedded generative UI.
- **MCP:** context + tools (request/response, plus subscribable resources). Anthropic.
- **A2A / IBM's Agent Communication Protocol:** agent-to-agent orchestration.

A screensaver is the opposite of what these carry: a CONTINUOUS renderer producing
~60 frames/sec of millions of pixels. So "what happens when the agent streams
frames?" surfaces a category error: **frames must never cross the agent boundary.**
Put the data plane onto the control plane and it falls over (bandwidth, latency,
cost), and the agent cannot reason about a pixel buffer anyway.

The clean model is the networking split, control plane vs data plane:

| Plane | Frequency | Carries | Transport |
| --- | --- | --- | --- |
| **Control** (the agent lives here) | ~1 Hz, semantic | list/set saver, patch schema, set param, approve, lifecycle | MCP tools+resources, AG-UI events, ACP session |
| **Authoring** | bursty | a saver preview widget / schema-diff streamed into a chat or editor | Vercel Data Stream / RSC-style |
| **Render** (never crosses the wire) | 60 Hz, pixels | frames | OffscreenCanvas + GPU, LOCAL |
| **Media** (only if remote-rendered) | 30-60 Hz, encoded | pixels | WebRTC / WebCodecs |

### The rule: stream the program, not the pixels

The agent emits (a) a declarative saver schema (the "program") and (b) a sparse,
timestamped, interpolatable stream of parameter changes (a "control track"). The
client renders 60fps LOCALLY, interpolating between deltas. This decouples
agent-Hz (semantic, ~1 Hz) from render-Hz (60 Hz), and it is deterministic: same
schema + same seed + same control track produces identical frames, everywhere,
forever. That determinism is what makes it QA-able, replayable, and shareable.

Mapping onto the existing protocols is natural: the saver's steerable state IS the
"agent state," and **AG-UI state patches map directly onto param deltas.** So you
can adopt AG-UI (or MCP resource-subscriptions) for the control plane, declare the
saver's param space as the shared state, and never invent a bespoke transport. The
frames stay on the GPU.

*v0: the control-track data model (`ControlTrack`, `ParamDelta`, `sampleTrack`)
is implemented and proven. Live streaming over AG-UI / MCP is **[FUTURE]**.*

### The potentially-new layer: a "visual control track"

None of the listed protocols define a real-time PARAMETER-AUTOMATION lane. That is
the gap, and it may be the novel contribution. It is not a frame protocol; it is a
sparse control-signal format. Drafted separately in
[control-track.md](../specs/control-track.md):

- **Prior art to borrow from:** OSC and MIDI (live param streams for VJ / audio),
  shader uniforms (the shader is the program, uniforms are the steering), game
  replay systems (stream INPUTS not frames, then replay deterministically), audio
  automation lanes (keyframed, interpolated parameter curves).
- **Properties:** sparse, timestamped, typed, interpolatable, seed-anchored,
  deterministic, recordable and replayable.
- **Why it matters here:** a human tweaking a saver live, an agent steering it from
  page context, and a recorded "performance" you can share are the SAME thing: a
  control track applied to a seeded program. Provenance (prompt / seed / model +
  the track) travels with it.

### **[FUTURE]** When pixels DO legitimately stream

Two cases, and in both the agent ORCHESTRATES the media pipe rather than carrying
pixels:

1. **Remote / cloud-GPU render:** a heavy WebGPU-compute saver runs on a server GPU
   and streams video to a thin client via WebRTC / WebCodecs. The agent sends a
   stream HANDLE over the control plane, never frames.
2. **Generative video model:** a diffusion / video model literally produces pixels.
   Same story: carry the pixels on a media transport, carry a POINTER on the
   control plane.

The distinction to hold onto: generative-UI protocols assume the output is a DOM /
component tree updated occasionally. A live renderer is a simulation you STEER
through a typed param space. Expose a **steering interface (param space + deltas)**,
not a re-render-the-tree interface.

---

## 6. **[FUTURE]** Portability: native wrappers around a web core

The web core is the single source of truth; thin native shells wrap a webview to
turn it into a real OS screensaver. This is very much capable in 2026.

### Targets and how

| Target | Shell | Webview | Notes |
| --- | --- | --- | --- |
| **macOS `.saver`** | Swift, subclass `ScreenSaverView` | `WKWebView` | Load the bundled web app locally. Handle preview mode (System Settings shows a small live preview). Modern macOS runs savers in a sandboxed `legacyScreenSaver` process, so bundle assets locally and avoid arbitrary network. Notarize. |
| **Windows `.scr`** | C# (WinUI / Win32) or Rust | `WebView2` (Chromium/Edge) | A `.scr` is an `.exe` that handles CLI args: `/s` (show fullscreen), `/p <hwnd>` (preview inside a parent window), `/c` (configure). Host WebView2, go fullscreen on `/s`, embed in the preview HWND on `/p`. WebView2 Evergreen runtime ships with Windows 11. Sign the installer. |
| **Cross-platform desktop** | **Tauri 2.x** (Rust) | system webview | Tiny binary, uses OS webview (WebView2 on Windows, WKWebView on macOS, WebKitGTK on Linux). Great for a single "ambient display" app across all three. |
| **Guaranteed-WebGPU desktop** | Electron / CEF | bundled Chromium | Heavier, but consistent WebGPU everywhere. Use only if WebGPU parity matters more than binary size. |
| **Linux** | fullscreen app or `xscreensaver` hook | WebKitGTK | Either integrate with `xscreensaver` or ship a fullscreen kiosk app. |
| **Kiosk / digital signage / smart displays** | fullscreen browser / kiosk shell | any | The most natural fit: a fullscreen ambient display driven by the same core. |
| **iOS / iPadOS / tvOS** | native app | `WKWebView` | Apple does not allow third-party lock-screen screensavers, so this is an ambient / signage / kiosk app, not a system saver. tvOS "screensaver" hooks are limited. |

### The key portability caveat: WebGPU in system webviews

- **WebView2** (Windows): full WebGPU (it is Chromium). Best case.
- **WKWebView** (macOS / iOS): WebGPU shipped in WebKit / Safari 26, but WKWebView
  exposure can lag or need a preference toggle. **Verify per OS version.**
- **WebKitGTK** (Linux, Tauri): WebGPU is behind / experimental. Expect to fall
  back to WebGL2 / Canvas2D.

Conclusion: the **capability tiers from section 3 are also the portability
insurance.** A saver that degrades WebGPU -> WebGL2 -> Canvas2D -> CSS runs
everywhere a webview does; only the top tier depends on the host webview exposing
WebGPU. Build Canvas2D / WebGL2 first (our black hole already is), add WebGPU as
an opt-in top tier.

### Native <-> web bridge

A small message bridge maps native lifecycle to the plugin lifecycle:

- native -> web: `idle-start`, `idle-stop`, `preview-mode`, `configure`, `multi-monitor`.
- web -> native: `user-interacted` (exit), `ready`, `error`.

Implement with `WKScriptMessageHandler` (macOS), WebView2 `postMessage`
(Windows), Tauri IPC (cross-platform). This is the same seam as the MCP control
surface, just a different transport.

---

## 7. Package layout

The v0 monorepo at `idle-screens/`:

```
idle-screens/
  packages/
    core/              @idle-screens/core              Engine, <idle-screen> element, idle detection, RNG, control-track, types
    saver-black-hole/  @idle-screens/saver-black-hole  Passthrough black hole (seeded, paramSpace, control-track)
    savers-classic/    @idle-screens/savers-classic     19 classic savers (toasters, DVD, warp, fish, rain, globe, spotlight, pipes, bsod, flurry, fluid, reaction-diffusion, snowfall, etc.)
    validator/         @idle-screens/validator          WCAG 2.3.1 flash + perf budget gates
    capabilities/      @idle-screens/capabilities       Device detection + saver eligibility tiering
    schema/            @idle-screens/schema             Declarative saver format: validate, compile, simulate
  apps/
    playground/        Vite workbench: palette, inline preview, determinism, safety, device, schema editor
```

**[FUTURE] packages not yet built:**

```
    mcp/               @idle-screens/mcp               MCP server (list/set/pause/screenshot/health)
    react/             @idle-screens/react              React adapter
    vue/               @idle-screens/vue                Vue adapter
    svelte/            @idle-screens/svelte             Svelte adapter
  apps/
    native-macos/      Swift .saver wrapper
    native-windows/    WebView2 .scr wrapper
    native-tauri/      Tauri cross-platform desktop
```

*Note: a separate `backend-webgpu` package was originally planned but is no longer
needed. WebGPU support is handled per-saver via the dual-path pattern (async mount
with GPU probe, canvas2d CPU fallback) — see fluid and reaction-diffusion.*

---

## 8. Core contracts (v0 as shipped)

The types below reflect the **implemented** API in `packages/core/src/types.ts`.
The original sketch in this section is superseded; see the source for the canonical
definitions.

```ts
export interface SaverManifest {
  id: string;
  label: string;
  minBackend: 'css' | 'canvas2d' | 'webgl2' | 'webgpu';
  passthrough?: boolean;
  costTier: 'idle' | 'low' | 'medium' | 'high';
  motionIntensity: 'calm' | 'moderate' | 'energetic';
  reducedMotionFallback: 'static' | 'slow' | 'hide';
  palette?: string[];
  paramSpace?: ParamSpace;
  a11y: { flashSafe: boolean; notes?: string };
  workerReady?: boolean;
  provenance?: { prompt?: string; seed?: number; model?: string };
}

export interface SaverPlugin {
  manifest: SaverManifest;
  mount(ctx: SaverContext): SaverInstance | Promise<SaverInstance>;
}

export interface SaverInstance {
  setPaused(paused: boolean): void;
  resize(width: number, height: number, dpr?: number): void;
  dispose(): void;
  renderFrame?(t: number, seed: number): void;
  applyTrack?(track: ControlTrack): void;
}

export interface SaverContext {
  host: HTMLElement;
  surface?: HTMLCanvasElement | OffscreenCanvas;
  dpr: number;
  width: number;
  height: number;
  seed: number;
  reducedMotion: boolean;
  rng: Rng;
  page?: PageContext;
}
```

Key differences from the original sketch in this doc:

- `mount()` returns `SaverInstance | Promise<SaverInstance>`. Async mount is used
  by WebGPU dual-path savers to probe for a GPU device before choosing backend.
- `SaverContext` keeps `host: HTMLElement` and adds `surface?: HTMLCanvasElement | OffscreenCanvas`
  plus `dpr: number`. Worker-eligible savers check `ctx.surface` first; passthrough
  savers that read the DOM (black-hole) and WebGPU savers stay main-thread.
- `resize` accepts an optional `dpr` parameter for browser zoom changes.
- `setPaused` and `resize` live on the instance, not the plugin.
- A seeded `Rng` is threaded through context (not just a seed number).

---

## 9. v0 milestones (what shipped)

1. ~~Lift the plugin system to a Web Component.~~ Done. `<idle-screen>` custom
   element with dialog overlay, wake arm-guard, config menu, external-engine
   handoff. Worker rendering is implemented for `workerReady` savers.
2. ~~Formalize the manifest + capability tiers.~~ Done. `SaverManifest`,
   `@idle-screens/capabilities` with `detectCapabilities`, `computeTier`,
   `evaluateSaver`.
3. ~~Port the signature savers.~~ Done. Black hole (deep: seeded, paramSpace,
   control-track, passthrough) + 19 classic savers in `@idle-screens/savers-classic`
   (toasters, DVD, warp, fish, rainstorm, hard-rain, globe, spotlight, fade-out,
   bouncing-ball, logo, messages, messages2, pipes, bsod, flurry, fluid,
   reaction-diffusion, snowfall).
4. ~~Ship the a11y/perf validator.~~ Done. `@idle-screens/validator` with per-tile
   WCAG 2.3.1 flash analysis, area threshold, perf cost tiers. The MCP control
   surface is **[FUTURE]**.
5. ~~Add WebGPU compute backends.~~ Done. Two savers (fluid, reaction-diffusion)
   have WebGPU compute-shader backends with canvas2d CPU fallbacks. The dual-path
   pattern is documented in the saver authoring skill. Async mount probes for a
   GPU device and falls back automatically.
6. **[FUTURE]** Native wrappers: macOS `.saver`, Windows `.scr`, Tauri desktop.

---

## 10. Open questions / risks

- ~~Licensing of any After Dark-inspired artwork (toasters etc.) for an OSS
  release.~~ Addressed: see `CREDITS.md` for full attribution.
- **[RESOLVED]** Control-track: defined as its own data model (`ControlTrack`,
  `ParamDelta`, `sampleTrack`) with `step`/`linear`/`smooth` easing, `dur` ramp
  windows, and `loop`/`duration` wrapping. `expo`/`spring` eases and
  `programVersion`/`provenance` fields are deferred.
- **[RESOLVED]** OffscreenCanvas + Worker: implemented via `SaverContext.surface`,
  `workerReady` manifest field, `runIdleWorker()` harness, and `openInWorker()`
  in `<idle-screen>`. Five canvas savers (warp, hard-rain, rainstorm, globe,
  spotlight) are worker-ready. WebGPU savers (fluid, reaction-diffusion) and
  black-hole stay main-thread (WebGPU in Workers has different API surface;
  black-hole needs DOM access via `ctx.page`). Automatic fallback on Worker
  failure or missing browser support. Additional hardening: Firefox module-worker
  detection (getter-probe), Safari `requestAnimationFrame` polyfill
  (`setTimeout`-based, tested via `forceRafPolyfill`), Worker reuse across sleep
  cycles, post-mount crash recovery (main-thread remount), debounced window
  resize + DPR forwarding to both main-thread and Worker instances, and runtime
  `applyTrack` proxying.
- **[OPEN]** WKWebView + WebKitGTK WebGPU exposure per OS version (verify before
  promising the top tier on macOS/Linux native shells).
- **[OPEN]** Declarative schema expressiveness vs imperative freedom: where to draw
  the line so agents can author safely without limiting hand-written savers.
- **[OPEN]** Passthrough page-reading over arbitrary host sites: security / CSP
  boundaries; the "eat the DOM" trick must restore all mutated nodes and never
  persist state.
