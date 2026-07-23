# Cloudflare Durable Objects: Implementation Spec

> **Status (July 2026):** design spec, nothing implemented. Depends on the steering
> seam (M1 in [roadmap.md](./roadmap.md)) and builds on
> [mcp-state-architecture.md](./mcp-state-architecture.md) topology B.

---

## 0. What this document covers

A concrete implementation plan for deploying idle-screens channels on Cloudflare
Workers + Durable Objects, controlled by agents via MCP (Streamable HTTP transport),
and subscribed to by browser clients via WebSocket. Includes free-tier budget math,
the full message protocol, the Durable Object class, the Worker router, the browser
bridge, and the MCP tool surface — everything needed to build, deploy, and operate.

### Repo boundary

The server (Worker + Durable Object + MCP handler) lives in a **separate repo**
(`idle-server`). It has a different runtime (Cloudflare `workerd`, not
browser DOM), a different deploy pipeline (`wrangler deploy`, not `changesets` →
npm), and different types (`@cloudflare/workers-types`). Mixing server and client
TypeScript in one tsconfig is a fight not worth having.

What stays in **this repo** (`idle-screens`):

| Package | Purpose |
|---------|---------|
| `@idle-screens/channels-protocol` | Shared types: `ChannelMessage`, `ChannelSnapshot`, wire format. Zero deps. Imported by both the server repo and the bridge. |
| `@idle-screens/bridge` | Browser WebSocket client (~60 lines). Connects to any server implementing the channel protocol and translates messages into `__idleScreens` calls. |

What lives in the **server repo** (`idle-server`):

| Module | Purpose |
|--------|---------|
| `src/screen-channel.ts` | Durable Object class |
| `src/worker.ts` | HTTP router (WS upgrade + MCP endpoint) |
| `src/mcp-tools.ts` | MCP tool definitions + JSON-RPC dispatch |
| `wrangler.toml` | Cloudflare deployment config |

The seam is the WebSocket protocol (§7). Any server that speaks it — Cloudflare DO
(`idle-server`), a plain Node WebSocket server, a Deno process — works with
`@idle-screens/bridge`.

---

## 1. Architecture overview

```
┌──────────────────┐       ┌──────────────────────────────────────────────┐
│  Agent (Claude)  │       │              Cloudflare Edge                │
│                  │       │                                              │
│  MCP client      │──────▶│  Worker (router)                            │
│  (Streamable     │ POST  │    │                                        │
│   HTTP)          │◀──────│    │ getByName(channelId)                   │
│                  │  SSE  │    ▼                                        │
└──────────────────┘       │  Durable Object (ScreenChannel)            │
                           │    ├─ state: { scene, epoch, sleeping }     │
┌──────────────────┐       │    ├─ SQLite: schedule, history             │
│  Browser tab 1   │◀═════▶│    ├─ WebSocket clients[] (hibernatable)   │
│  Browser tab 2   │◀═════▶│    └─ alarm: scheduled scene transitions   │
│  ...             │  WS   │                                              │
└──────────────────┘       └──────────────────────────────────────────────┘
```

Three roles, two protocols:

| Hop | Protocol | Direction |
|-----|----------|-----------|
| Agent ↔ Worker | MCP over Streamable HTTP (POST + SSE) | Bidirectional |
| Browser ↔ DO | WebSocket (with hibernation) | Bidirectional |

The Worker is a thin router. The Durable Object owns all state. Browsers are
render-only replicas. The agent steers; the DO broadcasts; the browser interpolates
at 60fps.

---

## 2. Free-tier budget analysis

### 2.1 What the free tier gives us

| Resource | Free limit | Reset |
|----------|-----------|-------|
| Worker requests | 100,000/day | Daily 00:00 UTC |
| Worker CPU | 10ms/invocation | Per invocation |
| DO requests | 100,000/day | Daily 00:00 UTC |
| DO duration | 13,000 GB-s/day | Daily 00:00 UTC |
| DO storage (SQLite) | 5 GB total | — |
| SQLite rows read | 5,000,000/day | Daily 00:00 UTC |
| SQLite rows written | 100,000/day | Daily 00:00 UTC |

**Critical billing detail:** WebSocket messages have a 20:1 compression ratio.
100 incoming WebSocket messages count as 5 DO requests. This is enormously
favorable for our use case.

**Hibernation:** When a DO has no active JavaScript execution and only hibernated
WebSocket connections, duration charges are **zero**. The clients stay connected at
the Cloudflare edge. The DO wakes on the next message, runs its constructor, and
processes. This is the feature that makes the economics work.

### 2.2 Budget math for a personal deploy

**Scenario: 1 channel, 1-3 viewers, agent steering occasionally.**

| Activity | Volume/day | DO requests consumed |
|----------|-----------|---------------------|
| Agent steering deltas | ~200 tool calls | 200 |
| Viewer WebSocket connects | ~10 (reconnects) | 10 |
| Viewer heartbeat pings | ~4,320 (3 viewers × 1/min × 24h) | 216 (at 20:1) |
| State queries from agent | ~50 | 50 |
| **Total** | | **~476/day** |

That's **0.5% of the daily 100k limit.** The personal deploy fits trivially.

**Scenario: 10 channels, 50 concurrent viewers, active agent steering.**

| Activity | Volume/day | DO requests consumed |
|----------|-----------|---------------------|
| Agent steering | 2,000 tool calls across channels | 2,000 |
| Viewer connects | 200 (reconnects, new viewers) | 200 |
| Scene broadcasts (10 updates/sec avg) | 864,000 outbound WS messages | 0 (outbound is free) |
| Viewer heartbeats | 72,000 (50 × 1/min × 24h) | 3,600 (at 20:1) |
| State queries | 500 | 500 |
| **Total** | | **~6,300/day** |

Still **6.3% of the limit.** The free tier handles a small community site.

**What blows the budget:** Inbound viewer messages at scale. If 1,000 viewers each
send 100 messages/day, that's 100k messages = 5,000 requests. Still fine. The
protocol design keeps viewer→server messages minimal (connect + rare heartbeat) and
server→viewer messages are outbound (free).

### 2.3 Storage budget

A scene is ~2KB of JSON. The SQLite storage holds:

| Data | Size estimate |
|------|--------------|
| 1,000 saved scenes | ~2 MB |
| Channel state (10 channels) | ~20 KB |
| Schedule entries | ~1 KB/channel |
| Scene history/provenance | ~50 KB/channel |

**Total: ~3 MB.** The 5 GB limit is irrelevant at this scale.

### 2.4 When to upgrade to paid ($5/month)

The free tier breaks when:
- Daily requests consistently exceed ~80,000 (80% of limit, leaving headroom)
- You need KV-backed DOs (free only supports SQLite)
- You need custom domains on Workers (free supports `*.workers.dev` only)
- You need more than 10ms CPU per invocation (complex validation)

The $5/month paid plan gives 1M DO requests/month + 400k GB-s, which covers a
medium-traffic gallery site.

### 2.5 Free-tier constraints to design around

| Constraint | Impact | Mitigation |
|-----------|--------|------------|
| 10ms CPU/invocation | Can't run heavy validation in the Worker | Validate specs client-side (agent) before publishing; DO does a lightweight schema check only |
| 100k requests/day hard cap | Exceeding = requests fail with errors until midnight UTC | Rate-limit inbound viewer messages; batch steering deltas |
| No custom domains (free) | URLs are `*.workers.dev` | Acceptable for dev/personal; upgrade for production |
| SQLite only (free) | No KV backend | SQLite is actually better for our use case (relational queries on scene history) |
| No cron triggers (free?) | May not have scheduled Workers | Use DO alarms instead (one alarm per DO, re-schedule in handler) |

---

## 3. Durable Object: `ScreenChannel`

One DO instance per channel. Named by channel ID (e.g., `my-screen`, `lobby-tv`).

### 3.1 State shape

```ts
interface ChannelState {
  /** The active scene: spec + seed + control track. ~2KB. */
  scene: {
    spec: SaverSpec;
    seed: number;
    track: ControlTrack;
  } | null;

  /** Shared epoch (ms since UNIX epoch) — all viewers offset from this
   *  so they compute the same `t` and see the same frame. */
  epoch: number;

  /** Is the screen sleeping (saver active) or awake? */
  sleeping: boolean;

  /** Channel metadata. */
  meta: {
    label: string;
    createdAt: number;
    owner: string;       // write-token hash
  };
}
```

Stored in SQLite via `this.ctx.storage.sql`:

```sql
CREATE TABLE IF NOT EXISTS channel (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Scene history for provenance / undo
CREATE TABLE IF NOT EXISTS scene_history (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  spec_json TEXT NOT NULL,
  seed      INTEGER NOT NULL,
  track_json TEXT,
  published_at INTEGER NOT NULL,
  author    TEXT          -- agent identifier or 'human'
);

-- Schedule: day-length programming
CREATE TABLE IF NOT EXISTS schedule (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  start_at  INTEGER NOT NULL,  -- ms since epoch
  spec_json TEXT NOT NULL,
  seed      INTEGER NOT NULL,
  track_json TEXT
);
```

### 3.2 Class skeleton

```ts
import { DurableObject } from 'cloudflare:workers';

interface Env {
  SCREEN_CHANNEL: DurableObjectNamespace;
}

export class ScreenChannel extends DurableObject<Env> {
  private state: ChannelState | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  /** Lazy-load state from SQLite on first access after hibernation wake. */
  private async ensureState(): Promise<ChannelState> {
    if (this.state) return this.state;
    const row = this.ctx.storage.sql
      .exec('SELECT value FROM channel WHERE key = ?', 'state')
      .one();
    this.state = row ? JSON.parse(row.value as string) : this.defaultState();
    return this.state;
  }

  private defaultState(): ChannelState {
    return {
      scene: null,
      epoch: Date.now(),
      sleeping: true,
      meta: { label: 'Untitled', createdAt: Date.now(), owner: '' },
    };
  }

  private async saveState(): Promise<void> {
    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO channel (key, value) VALUES (?, ?)',
      'state', JSON.stringify(this.state),
    );
  }

  /** ── WebSocket: browser viewer connections ── */

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // WebSocket upgrade for browser viewers
    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocket(request);
    }

    // HTTP API for the Worker router (MCP tool dispatch)
    switch (url.pathname) {
      case '/state':       return this.handleGetState();
      case '/publish':     return this.handlePublish(request);
      case '/set-param':   return this.handleSetParam(request);
      case '/apply-track': return this.handleApplyTrack(request);
      case '/sleep':       return this.handleSleep();
      case '/wake':        return this.handleWake();
      case '/set-seed':    return this.handleSetSeed(request);
      default:             return new Response('Not found', { status: 404 });
    }
  }

  private async handleWebSocket(request: Request): Promise<Response> {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Accept with hibernation support
    this.ctx.acceptWebSocket(server);

    // Attach channel state as serialized data (survives hibernation)
    const state = await this.ensureState();
    server.serializeAttachment({ joinedAt: Date.now() });

    // Send current state snapshot immediately
    server.send(JSON.stringify({
      type: 'snapshot',
      scene: state.scene,
      epoch: state.epoch,
      sleeping: state.sleeping,
    }));

    return new Response(null, { status: 101, webSocket: client });
  }

  /** Hibernation handler: called when a WS message arrives and wakes the DO. */
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    // Viewers send minimal messages (heartbeat/ack only)
    // No-op for now — the protocol is server→client dominant
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    // Cloudflare cleans up automatically; nothing to do
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    // Let it disconnect; viewer will reconnect
  }

  /** Broadcast a message to all connected WebSocket viewers. */
  private broadcast(msg: object): void {
    const data = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(data); } catch { /* dead socket, ignore */ }
    }
  }

  /** ── MCP tool handlers (called via HTTP from the Worker) ── */

  private async handleGetState(): Promise<Response> {
    const state = await this.ensureState();
    return Response.json({
      scene: state.scene,
      epoch: state.epoch,
      sleeping: state.sleeping,
      viewers: this.ctx.getWebSockets().length,
      meta: state.meta,
    });
  }

  private async handlePublish(request: Request): Promise<Response> {
    const body = await request.json() as {
      spec: SaverSpec; seed: number; track?: ControlTrack; author?: string;
    };

    // Lightweight validation (heavy validation done agent-side)
    if (!body.spec?.id || !body.spec?.layers?.length) {
      return Response.json({ error: 'Invalid spec' }, { status: 400 });
    }

    const state = await this.ensureState();
    state.scene = {
      spec: body.spec,
      seed: body.seed,
      track: body.track ?? { deltas: [] },
    };
    state.epoch = Date.now();
    await this.saveState();

    // Record in history
    this.ctx.storage.sql.exec(
      'INSERT INTO scene_history (spec_json, seed, track_json, published_at, author) VALUES (?, ?, ?, ?, ?)',
      JSON.stringify(body.spec), body.seed,
      JSON.stringify(body.track ?? { deltas: [] }),
      Date.now(), body.author ?? 'agent',
    );

    // Broadcast to all viewers
    this.broadcast({
      type: 'scene',
      spec: body.spec,
      seed: body.seed,
      track: body.track ?? { deltas: [] },
      epoch: state.epoch,
    });

    return Response.json({ ok: true, epoch: state.epoch });
  }

  private async handleSetParam(request: Request): Promise<Response> {
    const body = await request.json() as {
      path: string; value: unknown; ease?: string; dur?: number;
    };

    const state = await this.ensureState();
    if (!state.scene) {
      return Response.json({ error: 'No active scene' }, { status: 400 });
    }

    const delta = {
      t: Date.now() - state.epoch,
      path: body.path,
      value: body.value,
      ease: body.ease ?? 'smooth',
      dur: body.dur ?? 1000,
    };

    state.scene.track.deltas.push(delta);
    await this.saveState();

    this.broadcast({ type: 'delta', ...delta });

    return Response.json({ ok: true });
  }

  private async handleApplyTrack(request: Request): Promise<Response> {
    const body = await request.json() as { track: ControlTrack };

    const state = await this.ensureState();
    if (!state.scene) {
      return Response.json({ error: 'No active scene' }, { status: 400 });
    }

    state.scene.track = body.track;
    await this.saveState();

    this.broadcast({ type: 'track', track: body.track, epoch: state.epoch });

    return Response.json({ ok: true });
  }

  private async handleSleep(): Promise<Response> {
    const state = await this.ensureState();
    state.sleeping = true;
    await this.saveState();
    this.broadcast({ type: 'sleep' });
    return Response.json({ ok: true });
  }

  private async handleWake(): Promise<Response> {
    const state = await this.ensureState();
    state.sleeping = false;
    await this.saveState();
    this.broadcast({ type: 'wake' });
    return Response.json({ ok: true });
  }

  private async handleSetSeed(request: Request): Promise<Response> {
    const body = await request.json() as { seed: number };

    const state = await this.ensureState();
    if (!state.scene) {
      return Response.json({ error: 'No active scene' }, { status: 400 });
    }

    state.scene.seed = body.seed;
    state.epoch = Date.now();
    await this.saveState();

    this.broadcast({
      type: 'seed',
      seed: body.seed,
      epoch: state.epoch,
    });

    return Response.json({ ok: true, epoch: state.epoch });
  }

  /** ── Alarms: scheduled scene transitions ── */

  async alarm(): Promise<void> {
    const now = Date.now();
    const row = this.ctx.storage.sql
      .exec('SELECT * FROM schedule WHERE start_at <= ? ORDER BY start_at LIMIT 1', now)
      .one();

    if (row) {
      // Publish the scheduled scene
      const state = await this.ensureState();
      state.scene = {
        spec: JSON.parse(row.spec_json as string),
        seed: row.seed as number,
        track: JSON.parse((row.track_json as string) || '{"deltas":[]}'),
      };
      state.epoch = Date.now();
      await this.saveState();

      this.broadcast({
        type: 'scene',
        spec: state.scene.spec,
        seed: state.scene.seed,
        track: state.scene.track,
        epoch: state.epoch,
      });

      // Remove the fired entry
      this.ctx.storage.sql.exec('DELETE FROM schedule WHERE id = ?', row.id);
    }

    // Schedule next alarm if more entries exist
    const next = this.ctx.storage.sql
      .exec('SELECT start_at FROM schedule ORDER BY start_at LIMIT 1')
      .one();
    if (next) {
      await this.ctx.storage.setAlarm(next.start_at as number);
    }
  }
}
```

### 3.3 Hibernation lifecycle

```
1. Viewers connect via WebSocket → DO is ACTIVE (duration billing)
2. DO finishes processing → enters HIBERNATION (zero duration billing)
   - WebSocket connections persist at Cloudflare edge
   - In-memory state (this.state) is wiped
3. Agent sends a steering delta → Worker routes to DO → DO WAKES
   - Constructor runs again
   - ensureState() loads from SQLite
   - Processes the delta, broadcasts to viewers
   - Returns to HIBERNATION
4. Viewer sends heartbeat → DO WAKES briefly → returns to HIBERNATION
```

The key insight: between steering events, the DO is hibernated. Viewers stay
connected (Cloudflare edge holds the sockets). Duration charges only accrue
during the milliseconds of actual processing. For a channel that gets steered
once per minute, that's ~60ms of billable duration per minute out of 60,000ms.

---

## 4. Worker: HTTP router + MCP server

The Worker sits in front of the DO and serves two roles:
1. Routes browser WebSocket upgrades to the correct DO
2. Implements the MCP Streamable HTTP transport for agent connections

### 4.1 `wrangler.toml`

```toml
name = "idle-server"
main = "src/worker.ts"
compatibility_date = "2026-07-01"

[[durable_objects.bindings]]
name = "SCREEN_CHANNEL"
class_name = "ScreenChannel"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["ScreenChannel"]
```

### 4.2 Worker router

```ts
export { ScreenChannel } from './screen-channel';

interface Env {
  SCREEN_CHANNEL: DurableObjectNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // ── CORS preflight ──
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // ── Route: /c/:channelId/ws — WebSocket upgrade for viewers ──
    const wsMatch = url.pathname.match(/^\/c\/([^/]+)\/ws$/);
    if (wsMatch && request.headers.get('Upgrade') === 'websocket') {
      const channelId = wsMatch[1];
      const stub = env.SCREEN_CHANNEL.get(
        env.SCREEN_CHANNEL.idFromName(channelId),
      );
      return stub.fetch(request);
    }

    // ── Route: /mcp — MCP Streamable HTTP endpoint ──
    if (url.pathname === '/mcp') {
      return handleMcp(request, env);
    }

    // ── Route: /c/:channelId/state — public read-only state (no MCP) ──
    const stateMatch = url.pathname.match(/^\/c\/([^/]+)\/state$/);
    if (stateMatch && request.method === 'GET') {
      const stub = env.SCREEN_CHANNEL.get(
        env.SCREEN_CHANNEL.idFromName(stateMatch[1]),
      );
      const res = await stub.fetch(new Request('https://do/state'));
      return addCors(res);
    }

    return new Response('Not found', { status: 404 });
  },
};
```

### 4.3 MCP Streamable HTTP handler

The MCP endpoint speaks JSON-RPC over HTTP POST (client→server) and SSE
(server→client streaming). This implements the 2025-03-26 Streamable HTTP
transport spec.

```ts
async function handleMcp(request: Request, env: Env): Promise<Response> {
  if (request.method === 'POST') {
    const body = await request.json();

    // JSON-RPC dispatch
    if (body.method === 'initialize') {
      return mcpJson(body.id, {
        protocolVersion: '2025-03-26',
        serverInfo: { name: 'idle-server', version: '0.1.0' },
        capabilities: {
          tools: {},
          resources: { subscribe: true },
        },
      });
    }

    if (body.method === 'notifications/initialized') {
      return new Response(null, { status: 202 });
    }

    if (body.method === 'tools/list') {
      return mcpJson(body.id, { tools: MCP_TOOLS });
    }

    if (body.method === 'tools/call') {
      return handleToolCall(body, env);
    }

    if (body.method === 'resources/list') {
      return mcpJson(body.id, { resources: MCP_RESOURCES });
    }

    if (body.method === 'resources/read') {
      return handleResourceRead(body, env);
    }

    return mcpError(body.id, -32601, 'Method not found');
  }

  // GET — open SSE stream for server→client notifications (resource updates)
  if (request.method === 'GET') {
    // For v1, return 405 — we don't push resource updates yet
    return new Response('Method not allowed', { status: 405 });
  }

  return new Response('Method not allowed', { status: 405 });
}

function mcpJson(id: string | number, result: unknown): Response {
  return Response.json(
    { jsonrpc: '2.0', id, result },
    { headers: { 'Content-Type': 'application/json', ...corsHeaders() } },
  );
}

function mcpError(id: string | number, code: number, message: string): Response {
  return Response.json(
    { jsonrpc: '2.0', id, error: { code, message } },
    { headers: { 'Content-Type': 'application/json', ...corsHeaders() } },
  );
}
```

---

## 5. MCP tool surface

### 5.1 Tool definitions

```ts
const MCP_TOOLS = [
  {
    name: 'publishScene',
    description: 'Publish a SaverSpec scene to a channel. All connected viewers will render it immediately.',
    inputSchema: {
      type: 'object',
      properties: {
        channelId: { type: 'string', description: 'Channel name (e.g. "my-screen")' },
        spec: { type: 'object', description: 'A valid SaverSpec JSON object' },
        seed: { type: 'number', description: 'Deterministic RNG seed' },
        track: { type: 'object', description: 'Optional ControlTrack for time-based parameter changes' },
      },
      required: ['channelId', 'spec', 'seed'],
    },
  },
  {
    name: 'setParam',
    description: 'Steer a single parameter of the active scene. The change interpolates smoothly over the specified duration.',
    inputSchema: {
      type: 'object',
      properties: {
        channelId: { type: 'string' },
        path:  { type: 'string', description: 'Dot-path to the parameter (e.g. "layers.0.count")' },
        value: { description: 'New value for the parameter' },
        ease:  { type: 'string', enum: ['step', 'linear', 'smooth'], default: 'smooth' },
        dur:   { type: 'number', description: 'Transition duration in ms', default: 1000 },
      },
      required: ['channelId', 'path', 'value'],
    },
  },
  {
    name: 'applyTrack',
    description: 'Replace the control track on the active scene. Use for pre-composed multi-parameter choreography.',
    inputSchema: {
      type: 'object',
      properties: {
        channelId: { type: 'string' },
        track: { type: 'object', description: 'A ControlTrack object with deltas array' },
      },
      required: ['channelId', 'track'],
    },
  },
  {
    name: 'setSeed',
    description: 'Change the RNG seed and reset the epoch. Same spec + different seed = different arrangement of the same composition.',
    inputSchema: {
      type: 'object',
      properties: {
        channelId: { type: 'string' },
        seed: { type: 'number' },
      },
      required: ['channelId', 'seed'],
    },
  },
  {
    name: 'sleep',
    description: 'Activate the screensaver on a channel.',
    inputSchema: {
      type: 'object',
      properties: { channelId: { type: 'string' } },
      required: ['channelId'],
    },
  },
  {
    name: 'wake',
    description: 'Dismiss the screensaver on a channel.',
    inputSchema: {
      type: 'object',
      properties: { channelId: { type: 'string' } },
      required: ['channelId'],
    },
  },
  {
    name: 'getState',
    description: 'Read the current state of a channel: active scene, epoch, viewer count, sleeping status.',
    inputSchema: {
      type: 'object',
      properties: { channelId: { type: 'string' } },
      required: ['channelId'],
    },
  },
  {
    name: 'queueScene',
    description: 'Schedule a scene to go live at a specific time. Use for day-length programming (circadian arcs, timed exhibitions).',
    inputSchema: {
      type: 'object',
      properties: {
        channelId: { type: 'string' },
        spec: { type: 'object' },
        seed: { type: 'number' },
        track: { type: 'object' },
        startAt: { type: 'number', description: 'Unix timestamp (ms) when this scene should go live' },
      },
      required: ['channelId', 'spec', 'seed', 'startAt'],
    },
  },
];
```

### 5.2 Tool call handler

```ts
async function handleToolCall(body: any, env: Env): Promise<Response> {
  const { name, arguments: args } = body.params;
  const channelId = args.channelId;

  if (!channelId) {
    return mcpJson(body.id, {
      content: [{ type: 'text', text: 'Error: channelId is required' }],
      isError: true,
    });
  }

  const stub = env.SCREEN_CHANNEL.get(
    env.SCREEN_CHANNEL.idFromName(channelId),
  );

  let doUrl: string;
  let doBody: string | undefined;

  switch (name) {
    case 'publishScene':
      doUrl = 'https://do/publish';
      doBody = JSON.stringify({ spec: args.spec, seed: args.seed, track: args.track });
      break;
    case 'setParam':
      doUrl = 'https://do/set-param';
      doBody = JSON.stringify({ path: args.path, value: args.value, ease: args.ease, dur: args.dur });
      break;
    case 'applyTrack':
      doUrl = 'https://do/apply-track';
      doBody = JSON.stringify({ track: args.track });
      break;
    case 'setSeed':
      doUrl = 'https://do/set-seed';
      doBody = JSON.stringify({ seed: args.seed });
      break;
    case 'sleep':
      doUrl = 'https://do/sleep';
      break;
    case 'wake':
      doUrl = 'https://do/wake';
      break;
    case 'getState':
      doUrl = 'https://do/state';
      break;
    case 'queueScene':
      // Handled specially — writes to schedule table + sets alarm
      doUrl = 'https://do/queue';
      doBody = JSON.stringify({
        spec: args.spec, seed: args.seed,
        track: args.track, startAt: args.startAt,
      });
      break;
    default:
      return mcpJson(body.id, {
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        isError: true,
      });
  }

  const doReq = new Request(doUrl, {
    method: doBody ? 'POST' : 'GET',
    body: doBody,
    headers: doBody ? { 'Content-Type': 'application/json' } : {},
  });

  const doRes = await stub.fetch(doReq);
  const result = await doRes.json();

  return mcpJson(body.id, {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
  });
}
```

### 5.3 MCP resources

```ts
const MCP_RESOURCES = [
  {
    uri: 'screen://schema',
    name: 'SaverSpec Schema',
    description: 'The SaverSpec JSON schema, runtime semantics, and a worked example. Everything an agent needs to author a scene.',
    mimeType: 'application/json',
  },
  {
    uri: 'screen://channels',
    name: 'Active Channels',
    description: 'List of known channels with their current state.',
    mimeType: 'application/json',
  },
];
```

---

## 6. Browser bridge client — `@idle-screens/bridge`

Lives in this repo at `packages/bridge/`. A small package that connects to
any server implementing the channel WebSocket protocol (§7) and translates
messages into `__idleScreens` API calls. Zero dependency on Cloudflare — it
speaks WebSocket, not Workers.

```ts
// packages/bridge/src/index.ts (~60 lines)

export function connectChannel(
  channelId: string,
  baseUrl: string,
): { disconnect: () => void } {
  const wsUrl = `${baseUrl.replace(/^http/, 'ws')}/c/${channelId}/ws`;
  let ws: WebSocket;
  let reconnectTimer: number;

  function connect() {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log(`[idle-screens] connected to channel: ${channelId}`);
    };

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      const hook = (window as any).__idleScreens;
      if (!hook) return;

      switch (msg.type) {
        case 'snapshot':
          // Full state sync on connect
          if (msg.scene) {
            hook.loadScene?.(msg.scene, msg.epoch);
          }
          if (msg.sleeping) hook.sleep(); else hook.wake();
          break;

        case 'scene':
          // New scene published
          hook.loadScene?.(
            { spec: msg.spec, seed: msg.seed, track: msg.track },
            msg.epoch,
          );
          break;

        case 'delta':
          // Single parameter change
          hook.setParam?.(msg.path, msg.value, msg.ease, msg.dur);
          break;

        case 'track':
          // Full track replacement
          hook.applyTrack?.(msg.track);
          break;

        case 'seed':
          hook.setSeed?.(msg.seed);
          break;

        case 'sleep':
          hook.sleep();
          break;

        case 'wake':
          hook.wake();
          break;
      }
    };

    ws.onclose = () => {
      // Reconnect with exponential backoff (capped at 30s)
      const delay = Math.min(1000 * Math.pow(2, reconnectAttempt++), 30000);
      reconnectTimer = window.setTimeout(connect, delay);
    };

    ws.onerror = () => {
      ws.close();
    };
  }

  let reconnectAttempt = 0;
  connect();

  return {
    disconnect() {
      clearTimeout(reconnectTimer);
      ws?.close();
    },
  };
}
```

### 6.1 Integration with `<idle-screen>`

```html
<!-- In the consuming page (e.g. shawn-site) -->
<idle-screen></idle-screen>

<script type="module">
  import { connectChannel } from '@idle-screens/bridge';

  // After the engine is set up:
  connectChannel('my-screen', 'https://idle-server.workers.dev');
</script>
```

The bridge depends on the `__idleScreens` steering seam (M1 in the roadmap).
Until `loadScene`, `setParam`, `applyTrack`, `setSeed` exist on the hook,
only `sleep`/`wake` work through the bridge.

### 6.2 Server agnosticism

The bridge talks WebSocket, not Cloudflare. Any backend that:
1. Accepts a WebSocket connection
2. Sends the messages defined in §7.1
3. Optionally receives heartbeats per §7.2

...works with `@idle-screens/bridge`. This means you can prototype with a
50-line Node `ws` server before deploying to Cloudflare, or run a local-only
setup with no cloud dependency at all.

---

## 7. WebSocket message protocol

### 7.1 Server → Client (DO → browser)

| Message type | Fields | When sent |
|-------------|--------|-----------|
| `snapshot` | `scene`, `epoch`, `sleeping` | On WebSocket connect |
| `scene` | `spec`, `seed`, `track`, `epoch` | New scene published |
| `delta` | `path`, `value`, `ease`, `dur`, `t` | Single param steered |
| `track` | `track`, `epoch` | Full track replaced |
| `seed` | `seed`, `epoch` | Seed changed |
| `sleep` | — | Saver activated |
| `wake` | — | Saver dismissed |

### 7.2 Client → Server (browser → DO)

Minimal by design — keeps inbound message count low (billing).

| Message type | Fields | When sent |
|-------------|--------|-----------|
| `heartbeat` | — | Every 60s (keeps connection alive through proxies) |

Viewers are render-only. State changes originate from agents (via MCP tools)
or from the schedule (via alarms). If a human viewer needs to interact (e.g.
wake the screen locally), that's handled by the local `<idle-screen>` element
— it doesn't need to flow through the channel.

---

## 8. Development workflow

### 8.1 This repo: shared protocol + bridge

```bash
# In idle-screens (this repo)

# 1. Shared wire types (zero deps, imported by both sides)
mkdir -p packages/channels-protocol/src
# → exports ChannelMessage, ChannelSnapshot, etc.

# 2. Browser bridge client
mkdir -p packages/bridge/src
# → exports connectChannel(), depends on channels-protocol + core
```

Both are standard workspace packages: tsup build, npm publish via changesets,
`"type": "module"`, same tsconfig conventions as the rest of the monorepo.

### 8.2 Server repo (`idle-server`): Cloudflare Worker + DO

```bash
# Separate repo
mkdir idle-server && cd idle-server
npm init -y
npm add -D wrangler @cloudflare/workers-types
npm add @idle-screens/channels-protocol  # from npm
```

Structure:

```
idle-server/
  src/
    worker.ts            # HTTP router + MCP handler
    screen-channel.ts    # Durable Object class
    mcp-tools.ts         # Tool definitions + dispatch
  wrangler.toml
  tsconfig.json
  package.json
```

The server imports `@idle-screens/channels-protocol` from npm for the shared
message types. It does NOT depend on `@idle-screens/core` — it never renders
anything; it just stores and relays scene JSON.

### 8.3 Local development

```bash
# Terminal 1: run the Cloudflare Worker locally
cd idle-server
npx wrangler dev --local

# This gives you:
# - http://localhost:8787/c/test/ws   (WebSocket for viewers)
# - http://localhost:8787/mcp         (MCP endpoint for agents)
# - http://localhost:8787/c/test/state (public state read)

# Terminal 2: run the playground (this repo)
cd idle-screens
pnpm dev
# → localhost:5173 with bridge connecting to localhost:8787
```

**Local MCP testing with Claude Code:**

```json
// In Claude Code's MCP config:
{
  "mcpServers": {
    "idle-screens": {
      "type": "streamableHttp",
      "url": "http://localhost:8787/mcp"
    }
  }
}
```

Then in Claude Code: "publish a scene to channel 'test' — a starfield with
three depth layers" → agent calls `publishScene` tool → DO broadcasts to any
connected browser tabs.

### 8.4 Deploy

```bash
# Server (idle-server repo):
npx wrangler deploy
# → https://idle-server.<account>.workers.dev

# Client packages (idle-screens repo):
# Publish @idle-screens/channels-protocol and @idle-screens/bridge
# via the normal changesets flow (merge to main → npm publish)
```

Free tier. No credit card. No custom domain needed.

### 8.5 Connect from shawn-site

```ts
// In the Angular site, after idle-screen mounts:
import { connectChannel } from '@idle-screens/bridge';

connectChannel('shawn-screen',
  'https://idle-server.<account>.workers.dev');
```

Now any agent with the MCP endpoint URL can steer the live site's screensaver.

---

## 9. Auth model

### 9.1 For a personal deploy (v1)

No auth. The Worker is public, the channel names are unguessable-ish (or just
well-known — it's a personal site). The MCP endpoint is open. This matches
the "localhost-only or behind site auth" model from the MCP architecture doc.

### 9.2 For a multi-user channel site (v2)

Add bearer tokens scoped per channel:

```ts
// In the Worker, before routing to DO:
const token = request.headers.get('Authorization')?.replace('Bearer ', '');
if (!token || !await verifyChannelToken(token, channelId)) {
  return new Response('Unauthorized', { status: 401 });
}
```

Tokens are hashed and stored in the DO's SQLite (`channel.meta.owner`).
Read-only access (viewing) stays unauthenticated. Write access (MCP tools)
requires a token. This matches the MCP Streamable HTTP spec's recommendation
for authentication.

---

## 10. End-to-end flow: agent authors and steers a live screen

```
1.  Developer deploys the Worker (npx wrangler deploy)
2.  shawn-site loads <idle-screen> + bridge script
    → bridge connects WebSocket to /c/shawn-screen/ws
    → DO creates, hibernates (zero cost)

3.  Agent (Claude Code) connects to /mcp endpoint
    → MCP initialize handshake
    → Agent calls tools/list, sees publishScene, setParam, etc.

4.  Agent: "I'll compose a night sky"
    → tools/call publishScene {
        channelId: "shawn-screen",
        spec: { /* lanterns spec */ },
        seed: 88
      }
    → Worker routes to DO
    → DO saves state, broadcasts { type: "scene", ... } to all WebSocket clients
    → Bridge receives, calls __idleScreens.loadScene(...)
    → Browser renders lanterns at 60fps
    → DO hibernates (zero cost while viewers render)

5.  Agent: "make the lanterns pulse brighter"
    → tools/call setParam {
        channelId: "shawn-screen",
        path: "layers.1.pulse.amp",
        value: 0.4,
        ease: "smooth",
        dur: 3000
      }
    → DO wakes (~2ms), appends delta, broadcasts, hibernates

6.  Agent: "schedule a dawn sky at 6am tomorrow"
    → tools/call queueScene {
        channelId: "shawn-screen",
        spec: { /* dawn spec */ },
        seed: 42,
        startAt: 1752051600000
      }
    → DO sets alarm for 6am
    → At 6am: DO wakes, publishes the dawn scene, hibernates
    → No agent online needed — the schedule plays itself

7.  Human visits shawn-site at 6:15am
    → Bridge connects, receives snapshot of dawn scene
    → Sees the same sky that's been running since 6am (shared epoch)
```

---

## 11. What this costs

### Personal deploy on free tier

| Line item | Monthly cost |
|-----------|-------------|
| Workers | $0 |
| Durable Objects compute | $0 |
| Durable Objects storage | $0 |
| Custom domain | $0 (use `*.workers.dev`) |
| **Total** | **$0** |

### Small community (10 channels, ~50 viewers) on paid tier

| Line item | Monthly cost |
|-----------|-------------|
| Workers paid plan | $5 |
| DO requests overage | $0 (well within 1M included) |
| DO duration overage | $0 (hibernation keeps it negligible) |
| DO storage overage | $0 (under 1 GB) |
| **Total** | **$5/month** |

### What you'd pay elsewhere for the same thing

| Alternative | Monthly cost | Why more |
|-------------|-------------|---------|
| EC2 t3.micro always-on | ~$8 + bandwidth | No hibernation, you pay for idle |
| Fly.io | ~$5-15 | Similar to DO but no WebSocket hibernation |
| Supabase Realtime | $25+ | Row-level subscriptions overkill |
| PubNub / Ably | $0-50 | Message pricing scales badly with viewers |

Durable Objects with hibernation is the **only** serverless primitive that holds
thousands of WebSocket connections at zero cost while idle. That's what makes it
the right choice for a protocol that steers once per minute and renders at 60fps
on the client.

---

## 12. Build order

Two repos, three workstreams. Steps marked **(S)** are in the server repo;
steps marked **(C)** are in this repo (idle-screens).

| Step | Repo | What | Depends on | Effort |
|------|------|------|-----------|--------|
| 1 | **(C)** | `packages/channels-protocol/`: shared message types, wire format | Nothing | 1 hour |
| 2 | **(S)** | Server repo scaffold: wrangler.toml, tsconfig, deps | Step 1 (npm) | 1 hour |
| 3 | **(S)** | `ScreenChannel` DO: state, WebSocket accept, broadcast, hibernate | Step 2 | 3 hours |
| 4 | **(S)** | Worker router: WebSocket upgrade, `/c/:id/state`, `/c/:id/ws` | Step 3 | 2 hours |
| 5 | **(S)** | MCP handler: initialize, tools/list, tools/call dispatch | Step 4 | 3 hours |
| 6 | **(C)** | `packages/bridge/`: WebSocket client + `__idleScreens` translation | Step 1 | 2 hours |
| 7 | **(C)** | `__idleScreens` steering seam: `loadScene`, `setParam`, etc. | Core M1 | 4 hours |
| 8 | — | Local dev test: wrangler dev + playground + Claude Code MCP | Steps 1-7 | 2 hours |
| 9 | **(S)** | Deploy to Cloudflare free tier | Step 8 | 30 min |
| 10 | **(C)** | Connect shawn-site via `@idle-screens/bridge` | Steps 6, 9 | 1 hour |

**Total estimate: ~19.5 hours.** The server repo (steps 2-5, 9) and the client
packages (steps 1, 6-7) can be built in parallel after the protocol types ship.
Step 1 unblocks everything — publish `@idle-screens/channels-protocol` first.

---

## 13. Open questions

1. **Scene validation at the edge.** The full `validateSpec` has zero dependencies
   but might exceed 10ms CPU on the free tier for complex specs. Options: (a) validate
   agent-side only and trust the input, (b) run a lightweight structural check in the
   DO and full validation in the agent, (c) upgrade to paid for the CPU headroom.
   Recommendation: (b) — the agent has already validated before publishing.

2. **Epoch drift.** Two viewers connecting at different times both offset from the
   shared epoch, but their local clocks may differ by seconds. For sprite fields
   this is invisible. For frame-locked art (pixel-identical across viewers) it would
   need NTP-quality sync. Not worth solving until someone asks for it.

3. **Channel discovery.** How do viewers find channels? For v1: hardcoded channel
   name in the bridge config. For a gallery: a `listChannels` MCP tool + a directory
   page that renders live thumbnails (each thumbnail = a tiny canvas running the
   scene's `renderFrame` at the current `t`).

4. **Multi-writer.** Two agents steering the same channel simultaneously: last-writer-
   wins per delta `t`. Good enough for personal use. A CRDT per param path is possible
   later but adds complexity with no current demand.

5. **Code deploys disconnect WebSockets.** Every `wrangler deploy` drops all WS
   connections. The bridge's reconnect logic handles this, but viewers see a brief
   flash of reconnection. Acceptable for a personal deploy; for a production channel
   site, use Cloudflare's gradual rollout.
