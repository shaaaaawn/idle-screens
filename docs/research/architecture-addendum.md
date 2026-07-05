# Architecture Addendum (speculative)

> **Status (July 2026): SPECULATIVE / HISTORICAL.** This was an early extension to
> the vision doc, written under the working name "Idyll Pixels" before the project
> settled on `idle-screens`. Most of the ideas here describe production hardening
> for enterprise kiosk / signage deployments that are well beyond v0 scope. The
> ideas are preserved for future reference, annotated with what actually shipped.
>
> The authoritative v0 spec is
> [`behavior-contract.md`](../specs/behavior-contract.md). The vision and roadmap are in
> [`vision-2026.md`](./vision-2026.md).

---

## 1. The "Claude Code" paradigm: agentic guardrails

Anthropic's *Claude Code* demonstrated that autonomous agents cannot safely manipulate raw UI environments (like standard output in a terminal) without causing severe performance degradation. They mitigated this by building a custom React renderer to intercept, diff, and paint terminal states safely.

**idle-screens applies this exact architectural thesis to the web browser's idle state.** If an agent dynamically generates WebGL shaders or injects DOM elements directly into a 24/7 kiosk, it will inevitably hit the Halting Problem, lock the main thread, or trigger a memory leak.

> **The paradigm shift:**
> The agent is strictly a **Director**, not a Programmer. idle-screens acts as the
> protective execution layer. The agent uses a declarative JSON schema, and the
> engine safely executes the mathematical instructions without exposing the browser
> to infinite loops.

*v0: this is exactly what `@idle-screens/schema` does -- `validateSpec` enforces
safety caps (entity count, speed, layer count) and `compileSaver` produces a
bounded, deterministic renderer. The validator (`@idle-screens/validator`) gates
the output for WCAG flash safety and perf budget.*

## 2. **[FUTURE]** Declarative Ambient Schema (DAG)

To safely bridge multi-agent backend frameworks (e.g., LangGraph) with the frontend engine, this addendum proposed abandoning imperative code execution entirely. Savers would be defined as a Directed Acyclic Graph (DAG) of physics behaviors.

* **No Turing completeness:** agents cannot write `for` or `while` loops. They link existing, highly optimized C++/WGSL physics nodes (e.g., `curl_noise`, `attractor`).
* **AST math parsing:** agents can write mathematical expressions (e.g., `calc(sin($time) * 2.0)`) to create organic motion. The engine parses this via a strict Abstract Syntax Tree (AST), rejecting any assignments or logic bombs before execution.
* **Bounded compute:** the schema enforces a `budget` property (e.g., "low", "medium"). If an agent requests an N-body gravity field, the engine internally caps spatial hash lookups to enforce `O(N)` maximum complexity, regardless of the requested entity count.

*v0: the shipped schema is simpler than this DAG vision. It uses a layer + entity
model with motion types (`drift`, `rise`, `bounce`) rather than a compute-graph
DAG. Safety caps are per-layer entity limits and max-speed ceilings, not AST
parsing. The bounded-compute idea is realized at a coarser grain -- `validateSpec`
rejects specs that exceed entity/layer/speed limits, and `compileSaver` derives a
`costTier` from entity count. The DAG / AST / physics-node architecture remains
speculative.*

## 3. **[FUTURE]** Production realities and runtime circuit breakers

Deploying WebGPU/Canvas engines to continuous 24/7 enterprise kiosks exposes hardware fragmentation and browser-level memory vulnerabilities. The engine would introduce the following autonomous safeguards:

**A. The 16ms execution timebox**
Schema validation is insufficient to prevent GPU lockups. The engine would implement a runtime circuit breaker. If an agent-configured shader or simulation tick exceeds 16ms, the engine autonomously kills the Web Worker and gracefully degrades to the CSS motion tier. It does not await agent or host permission.

*v0: not implemented. No Worker exists yet. The perf validator
(`@idle-screens/validator`) reports frame-time p95 and jank ratio after the fact,
but does not kill a running saver.*

**B. Garbage collection via hard resets**
Chromium-based WebViews (including Windows WebView2) frequently suffer from memory fragmentation when manipulating OffscreenCanvas contexts over weeks of uptime. To prevent application crashes on kiosks, the engine would schedule periodic hard destruction and instantiation of the entire Web Worker during long idle stretches to force OS-level garbage collection.

*v0: not implemented. No long-uptime kiosk targets yet.*

**C. Eco-aware dynamic throttling**
Complying with modern battery technical quality standards requires moving beyond static manifest preferences. The SaverContext would continuously monitor device thermals and battery levels. If the temperature spikes or battery drops below 20%, the tick rate is forcefully throttled on the fly, overriding the agent's requested motion intensity.

*v0: `@idle-screens/capabilities` detects static signals (save-data, device
memory, core count) and gates saver eligibility, but does not dynamically
throttle at runtime.*

**D. Passthrough "eat the DOM" constraints**
The signature feature of reading the live page via `page.victims(sel)` will trigger Content Security Policy (CSP) violations and main-thread serialization bottlenecks if polled continuously. **Resolution:** The engine would capture a single, static snapshot (bitmap array or bounding-box coordinates) exactly once when idle-start fires, passing it to the Web Worker to manipulate statically.

*v0: the black hole captures victims via `PageContext.victims()` at mount time
(live DOM queries, not continuous polling). The snapshot-once architecture is
partially realized -- victims are captured at sleep, not continuously polled --
but the data stays on the main thread since there is no Worker.*

## 4. **[FUTURE]** Deployment and ecosystem targeting

Not all streaming devices and OS native shells are viable for a standardized web ambient engine.

* **Primary targets: Android TV / Google TV.** The Android DreamService API officially supports wrapping web engines into a native app, allowing idle-screens to act as the primary system screensaver on smart displays and set-top boxes.
* **Enterprise kiosks and DOOH:** Native Linux/Chromium kiosks and Digital Out-of-Home advertising boards remain the core revenue-generating environments for programmatic, agent-driven visual states.
* **Bypassing tvOS (Apple TV):** Apple tvOS strictly prohibits third-party integration with the system screensaver. Furthermore, standard WKWebView access is limited. idle-screens would intentionally bypass Apple TV as an automated ambient target, treating it only as a manual "active app" launch environment if required.

*v0: the library targets web browsers only. No native deployment code exists. See
the vision doc section 6 for the native wrapper roadmap (macOS .saver, Windows
.scr, Tauri). Enterprise kiosk / signage / Android TV targeting is speculative.*
