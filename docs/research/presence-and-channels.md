# Agent Presence & Channels: Two Application Designs

> **Status (July 2026):** design exploration, nothing implemented. Companions:
> [roadmap.md](./roadmap.md) (sequencing — the presence hook is gating
> experiment #1), [mcp-state-architecture.md](./mcp-state-architecture.md)
> (the transport/state substrate both designs ride on).

---

## Part 1 — `@idle-screens/agent-presence`: the screen as the agent's face

While an agent works, its UI is a scrolling terminal — and the idle monitor
next to it does nothing. Map harness activity to *mood, not logs*: you should
feel the session state from across the room without reading a token.

### 1.1 Telemetry sources in a local Claude Code harness

| Source | What it gives | How to tap |
|--------|--------------|------------|
| **Hooks** | `SessionStart/End`, `UserPromptSubmit`, `PreToolUse`/`PostToolUse` (tool name + input/output JSON on stdin), `Notification` (permission requests, waiting), `Stop`, `PreCompact` | Hook script POSTs to localhost — the primary tap; push-based, designed for this |
| **Transcript JSONL** | Every message, tool call, token count (`~/.claude/projects/<slug>/*.jsonl`) | `tail -f`; pull-based, includes content |
| **OpenTelemetry** | Tokens, cost, duration, tool-decision metrics via OTLP | Standardized; heavier than needed |
| **Statusline** | Model, cwd, cost, lines changed, pushed as JSON per update | Siphon state sideways from the statusline command |

### 1.2 Mood signals (derived, not raw)

- **Turn rhythm** — prompt→stop cadence: fast = conversational, long gaps =
  deep work.
- **Tool mix** — Read/Grep/Glob-dense = *exploring*; Edit/Write bursts =
  *building*; repeated Bash test runs = *verifying*.
- **Friction** — failed commands, test failures parsed from PostToolUse,
  a permission prompt sitting unanswered (Notification).
- **Scale** — subagent fan-out; compaction (PreCompact = the agent is
  literally forgetting; deserves a black hole).
- **Resolution** — Stop after green tests vs Stop after an error.

### 1.3 Mapping rules

- Emit mostly **control-track deltas**, not saver switches —
  `setParam('intensity', 0.8, 'smooth', 3000)` as tests fail, rather than
  thrashing plugins. (Depends on roadmap M1 steering seam + M2 derived
  paramSpaces.)
- Saver switches get **hysteresis** (~90s minimum dwell): the screen has
  moods, not seizures.
- Example mapping (user-editable JSON): exploring = warp; building = pipes;
  verifying with failures = rain thickening; blocked = spotlight; compacting
  = black hole; success = lanterns rising.

The whole package is a hook script (~80 lines) plus the mood-map JSON. It
does not require MCP, channels, or schema v2 — which is why it's gating
experiment #1 in the roadmap.

### 1.4 The desktop takeover shell — how thin can it be?

A browser tab can't take over the desktop; some native shell is required.
But it's thin: its entire job is (a) OS-level idle detection, (b) a
fullscreen webview pointed at localhost, (c) teardown on input. All savers,
logic, and steering stay in the web engine — the shell calls
`__idleScreens.sleep()/wake()` and the engine's in-page idle detection is
disabled in favor of the OS signal.

| Tier | Stack | Notes |
|------|-------|-------|
| **Kiosk app** (recommended) | Electron (`powerMonitor.getSystemIdleTime()`) or Tauri v2 | ~200 lines, cross-platform (macOS/Windows/Linux), frameless always-on-top fullscreen window on idle |
| **Real `.saver` bundle** | Swift `ScreenSaverView` + `WKWebView` (prior art: WebViewScreenSaver) | Most legitimate, most brittle — since Sonoma third-party savers run in the sandboxed `legacyScreenSaver` process; localhost networking + WKWebView are finicky there |
| **Tonight-sized prototype** | LaunchAgent polling `ioreg` HIDIdleTime → Chrome `--kiosk` | Ugly; proves the loop before writing any Swift |

Key separation: the hook script POSTs to a tiny local bridge (the topology-A
MCP server from the architecture doc); the fullscreen webview subscribes over
SSE. The native shell knows nothing about agents, MCP, or savers — one dumb
shell works forever while the interesting parts evolve in TypeScript.

---

## Part 2 — Channels: a Shadertoy-for-live-screens

Topology B from the MCP architecture doc, made multi-tenant. The TV metaphor
is the design: channels, schedules, live takeovers, a program guide. The
property that makes the economics work: **determinism means the server never
renders anything.**

### 2.1 Architecture

- A **channel** = one Durable Object (or equivalent): holds
  `{ currentScene, epoch, schedule, writeTokens }`, fans out SSE to viewers.
  Channel state is ~2KB; idle channels hibernate to ~zero cost.
- **Viewers** load a static page (engine from CDN), subscribe to
  `/c/:id/events`, receive a scene snapshot + the shared **epoch**, and render
  locally at 60fps. The epoch is what makes it television: every viewer
  computes the same `t`, so everyone watching a channel sees the same frame.
  Late joiners sync instantly — no pixels on the wire, ever, so no buffering.
- **Writers** connect through a remote MCP server (Streamable HTTP + OAuth,
  scoped per-channel tokens): `publishScene`, `setParam`, `applyTrack`,
  `queueScene`. Any agent anywhere — Claude Desktop, a cron'd session, the
  presence hook from Part 1 — can steer a channel it holds a token for.

### 2.2 What falls out for free

- **Thumbnails/program guide:** no video stills — each thumbnail is the scene
  JSON rendered client-side at `renderFrame(t_now)`. The guide page *is* forty
  live channels running simultaneously; forty sprite fields is nothing for
  canvas2d.
- **Programming:** schedules are day-length control tracks (circadian arcs);
  live takeovers are VJ mode; reruns are recorded tracks replayed against the
  epoch. A channel with no writer online still broadcasts — the track plays
  itself.
- **Moderation better than Shadertoy's:** every `publishScene` runs the flash
  validator server-side before broadcast — the platform *guarantees*
  photosensitive safety, which no shader gallery can (Shadertoy retrofitted
  warnings after real incidents). Scene caps come from `LIMITS`; forking is a
  copy button on JSON; remix lineage is recorded provenance.
- **Federation:** a channel is just an SSE endpoint with a documented event
  shape — anyone can self-host one; the site becomes a directory, not a silo.

### 2.3 Cost sketch

Static hosting + one Durable Object per *active* channel + one validator run
per publish. No GPUs, no transcoding, no video CDN. Shadertoy pays GPU in
every viewer's tab; this pays almost literally nothing. "Screens are cheap"
as an operating model.

### 2.4 Sequencing caveat

Per the roadmap's §6: this is the stadium, and the band hasn't played a gig.
Channels wait for both gating signals (presence hook retention + cold-agent
authoring quality) before any of it gets built.
