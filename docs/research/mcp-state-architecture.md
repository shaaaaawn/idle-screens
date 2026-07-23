# MCP + Deployed Screen: State Architecture

> **Status (July 2026):** design exploration. Nothing here is implemented.
> Prerequisites: extend `window.__idleScreens` with track/param methods (see §4).
> Sequencing and applications: [roadmap.md](./roadmap.md) (milestones + gating
> experiments), [presence-and-channels.md](./presence-and-channels.md) (the two
> concrete applications built on this substrate),
> [cloudflare-durable-objects-spec.md](./cloudflare-durable-objects-spec.md)
> (concrete implementation spec for topology B on Cloudflare free tier).

---

## 0. The question

How does an MCP server control a deployed `<idle-screen>`, and where does
state live?

---

## 1. The two-hop reality

MCP is a server-side protocol. An MCP server speaks to an MCP **client**
(Claude Desktop, Claude Code, any agent host). A browser tab running
`<idle-screen>` is **not** an MCP client and cannot be addressed by an MCP
server directly. So there are always two hops:

```
Agent (Claude) ⟷ [MCP] ⟷ MCP server ⟷ [WS / SSE] ⟷ browser tab(s)
```

The agent holds no persistent state (it issues tool calls). The browser holds
ephemeral render state (pixels, rAF handles, interpolated param values). The
MCP server (or its backing store) is the only component that **persists
across both hops and outlives any single tab**. This is where declarative
state lives.

---

## 2. State tiers

| Tier | What | Where | Crosses the wire? |
|------|------|-------|-------------------|
| **Ephemeral render** | rAF handle, canvas pixels, current interpolated param values, Worker thread state | Browser only | Never |
| **Declarative steering** | Active saver ID, seed, control-track deltas, sleep/wake | MCP server (source of truth) → browser (replica) | Yes — program + seed + track, never pixels |
| **Config** | Timeout, saver list, workerUrl, preferences | Set at init, rarely changes | Only on connect |

**Hard invariant from the determinism model:** the wire carries program +
seed + track, never pixels, never per-frame commands. The browser
interpolates locally at 60fps from a sparse stream of ~1-10 deltas/second.
This is the "steer, don't puppeteer" model from the control-track spec.

---

## 3. Two topologies (pick one per deployment)

### A. Browser-as-source-of-truth (local dev / single operator)

The engine in the browser tab owns state. The MCP server is a thin remote
control that relays tool calls to a **registered tab** over WebSocket.

```
Agent ⟷ MCP server ⟷ WS ⟷ single browser tab
                              └── engine owns state
                              └── __idleScreens hook is the API surface
```

**State ownership:** browser tab. The MCP server is stateless — it
translates MCP tool calls into `__idleScreens` method calls forwarded
over the WS connection. If the tab reloads, state resets.

**Good for:** local development, personal-site demo, single viewer. This
is what `window.__idleScreens` already models (sleep/wake/setPlugin/state).

**Limitation:** no persistence, no multi-viewer, no recovery on refresh.

### B. Server-as-source-of-truth (deployed / multi-viewer)

Canonical state (program, seed, track) lives in the MCP server's backing
store (an edge KV, Durable Object, SQLite, or even in-memory for a personal
deploy). Browsers subscribe via SSE and render locally. MCP tools mutate
server state; the server pushes changes to all connected browsers.

```
Agent ⟷ MCP server ⟷ SSE/WS ⟷ browser tab 1
              │                  browser tab 2
              │                  ...
              └── backing store (KV / Durable Object / SQLite)
                  └── { saverId, seed, track, sleeping }
```

**State ownership:** server. Browsers are render-only replicas. A tab that
connects late gets the current state snapshot and catches up. Refresh
recovers automatically. Multiple viewers see the same thing.

**Good for:** a deployed screen (e.g. shawn-site), gallery/exhibit,
multi-viewer broadcast, anywhere persistence matters.

**Caveat — "same thing" means same saver + same params, not frame-locked.**
Two tabs running the same saver with the same seed and track will look
similar but won't be pixel-identical unless the server also broadcasts a
shared time origin (an epoch `t=0` all tabs offset from). Without that,
each tab's `t` axis starts from its own connection time. Add a shared
epoch if exact synchronization matters.

**Recommendation:** for a genuinely deployed screen, topology B is the
honest default. The server-as-source-of-truth model matches the AG-UI
state-patch carrier described in the control-track spec (§6 option 1).

---

## 4. Current gap: the debug hook is not steerable

Today `window.__idleScreens` exposes:

```ts
sleep(), wake(), toggle()           // lifecycle
setPlugin(id)                       // saver selection
state(), active(), menuOpen()       // read-only queries
plugins                             // saver list
```

**Missing for MCP steering:**

```ts
applyTrack(track: ControlTrack)     // push a control track to the active saver
setParam(path: string, value: unknown, ease?: Ease, dur?: number)
                                    // set a single param (sugar for a 1-delta track)
getParamSpace()                     // read the active saver's paramSpace
getParams()                         // read current param values
setSeed(seed: number)               // change the seed (re-mount with new RNG)
```

Without these, the MCP server can switch savers and sleep/wake, but **cannot
steer a paramSpace** — which is the entire point of the control-track. This
seam needs extending before the MCP server is useful beyond a remote
play/pause button.

---

## 5. The MCP tool surface

Each tool maps to a state tier. The tool catalog is small because the
control-track does the heavy lifting — the agent doesn't need per-frame
control, just sparse steering.

**Important scope note:** steering tools (`setParam`, `applyTrack`) are only
meaningful for **deep savers** — those with a `paramSpace` and `applyTrack`
implementation. Today, the only deep saver is **black-hole**. All other
savers (warp, pipes, fluid, etc.) are "shallow" — they have no paramSpace
and ignore control-track deltas. Lifecycle tools (`sleep`/`wake`/`setSaver`)
work for all savers. Expanding the steerable surface means either adding
paramSpaces to existing savers or authoring new deep savers.

### Lifecycle tools (write declarative state)

| Tool | Effect | State mutated |
|------|--------|---------------|
| `sleep` | Activate the screensaver | `sleeping: true` |
| `wake` | Dismiss the screensaver | `sleeping: false` |
| `setSaver(id)` | Switch to a different saver | `saverId` |
| `setSeed(n)` | Change the RNG seed | `seed` |

### Steering tools (write declarative state)

| Tool | Effect | State mutated |
|------|--------|---------------|
| `setParam(path, value, ease?, dur?)` | Steer one knob | Appends a delta to `track` |
| `applyTrack(track)` | Push a full control track | Replaces `track` |
| `clearTrack` | Remove steering, return to defaults | Clears `track` |

### Query tools (read state)

| Tool | Returns |
|------|---------|
| `getState` | `{ sleeping, saverId, seed, params, connectedTabs }` |
| `listSavers` | Array of `{ id, label, paramSpace }` |
| `getParamSpace` | The active saver's typed knobs |

### Resource (MCP resource, not a tool)

| Resource | Content |
|----------|---------|
| `screen://state` | Live state, subscribable. Agent gets push updates when a human interacts (wakes, changes saver via config menu) |

---

## 6. Message flow (topology B)

### Agent steers a deployed screen

```
1. Agent calls MCP tool `setSaver("black-hole")`
2. MCP server writes { saverId: "black-hole" } to backing store
3. Server pushes SSE event to all connected tabs:
   { type: "setSaver", id: "black-hole" }
4. Each tab's bridge script calls __idleScreens.setPlugin("black-hole")
5. <idle-screen> mounts the black hole saver

6. Agent calls `setParam("holeSize", 0.8, "smooth", 2000)`
7. MCP server appends delta to track in backing store
8. Server pushes SSE: { type: "delta", path: "holeSize", value: 0.8,
   ease: "smooth", dur: 2000 }
9. Tab's bridge calls __idleScreens.setParam(...) (once §4 gap is filled)
10. Black hole smoothly grows over 2 seconds, interpolated locally at 60fps
```

### Human interacts, agent observes

```
1. Human opens config menu, picks "warp"
2. Bridge script detects change, POSTs to MCP server:
   { type: "stateChange", saverId: "warp" }
3. MCP server updates backing store
4. MCP server emits resource update on screen://state
5. Agent (if subscribed) sees the saver changed and can respond
```

---

## 7. The bridge script

The browser needs a small bridge that connects to the MCP server and
translates messages into `__idleScreens` calls. This is ~50 lines:

```ts
// idle-screen-bridge.ts (runs in the browser, NOT in the MCP server)

const es = new EventSource('/api/idle-screen/events');

es.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  const hook = window.__idleScreens;
  if (!hook) return;

  switch (msg.type) {
    case 'sleep':      hook.sleep(); break;
    case 'wake':       hook.wake(); break;
    case 'setSaver':   hook.setPlugin(msg.id); break;
    case 'delta':      hook.setParam(msg.path, msg.value, msg.ease, msg.dur); break;
    case 'track':      hook.applyTrack(msg.track); break;
    case 'seed':       hook.setSeed(msg.seed); break;
  }
};

// Report state changes back to the server
const report = () => fetch('/api/idle-screen/state', {
  method: 'POST',
  body: JSON.stringify({
    sleeping: hook.state() === 'sleeping',
    saverId: hook.active(),
  }),
});
```

For topology A (local dev), the bridge connects via WebSocket to
`localhost` and the MCP server runs as a local process alongside the
dev server.

---

## 8. Backing store options (topology B)

| Option | Persistence | Multi-viewer | Complexity |
|--------|-------------|--------------|------------|
| In-memory (Node process) | Process lifetime | Yes (via WS/SSE) | Minimal |
| SQLite file | Durable | Yes | Low |
| **Cloudflare Durable Object** | Edge-durable | Yes, global | Medium |
| Redis / Upstash | Durable, fast | Yes | Medium |
| KV (Cloudflare / Vercel) | Durable | Yes (with polling) | Low |

**Recommended: Cloudflare Durable Objects.** The full implementation spec is in
[cloudflare-durable-objects-spec.md](./cloudflare-durable-objects-spec.md) —
free tier covers a personal deploy ($0/month), WebSocket hibernation means
viewers stay connected at zero compute cost, and SQLite gives durable scene
history. The Cloudflare Worker also hosts the MCP Streamable HTTP endpoint,
so one deploy covers both the viewer and agent sides.

State is tiny (~2 KB of JSON) and recovery from DO restart is graceful
(viewers reconnect and get the current state snapshot).

---

## 9. What stays out of scope

- **Pixel streaming.** The wire never carries rendered frames. If a
  future use case needs cloud-GPU rendering (heavy generative video),
  that's a separate WebRTC/WebCodecs video pipe — the control track
  still only carries steering, not pixels.
- **Multi-writer conflict resolution.** For v1, last-writer-wins per
  param path. If human and agent both steer simultaneously, the last
  delta wins. A CRDT approach is possible later but unnecessary for
  a personal site.
- **Auth/ACL.** For a personal deploy, the MCP server is
  localhost-only or behind site auth. No separate auth layer needed.

---

## 10. Build order (if we build it)

### Repo boundary

The server-side code (Worker + Durable Object + MCP handler) lives in a
**separate repo** (`idle-server`). Different runtime (`workerd` vs
browser), different deploy (`wrangler` vs changesets/npm), different types
(`@cloudflare/workers-types` vs DOM). This repo owns the client-side pieces:
the shared wire protocol (`@idle-screens/channels-protocol`) and the browser
bridge (`@idle-screens/bridge`).

### Sequence

1. **`@idle-screens/channels-protocol`** — shared message types (this repo,
   publish to npm first — everything else imports it)
2. **Extend `__idleScreens`** with `applyTrack`, `setParam`,
   `getParamSpace`, `getParams`, `setSeed` (core change, this repo)
3. **`@idle-screens/bridge`** — WebSocket client + `__idleScreens`
   translation (this repo, depends on step 1)
4. **Server repo** — Worker + ScreenChannel DO + MCP handler (separate
   repo, depends on step 1 from npm). See
   [cloudflare-durable-objects-spec.md](./cloudflare-durable-objects-spec.md)
   for the full implementation spec.
5. **Deploy** — `wrangler deploy` to Cloudflare free tier
6. **Connect shawn-site** — `npm add @idle-screens/bridge`, point at the
   deployed Worker URL
