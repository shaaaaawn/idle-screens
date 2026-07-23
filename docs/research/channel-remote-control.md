# The Channel as a Remote-Controlled Timeline

## Status: Design / vision (July 2026)

"Publish + rewind" is a media player. A **remote control** means you *conduct* a
live surface — transport, program, mix, recall, automate, hand off. And the
operator here is unusual: an **LLM speaking natural language over MCP**. So the
remote is a *command surface an agent drives*, backed by a deterministic,
seekable timeline. This doc defines that model.

## The core frame: three layers

A channel is not "the current scene." It's a conductable timeline with three
layers:

1. **The strip** — everything ever published. Every `publishScene` is a keyframe
   on an infinite tape (already recorded in `scene_history`). Because a scene is
   `{spec, seed, track}` and everything is seeded, **any point on the strip is
   re-renderable exactly** — the determinism proof means the tape is lossless.
2. **The head** — what's live *now*. The playhead. Normally parked at "live,"
   but it can sit on a past keyframe (rewind), scrub within a scene's control
   track (any `t`), or preview a scheduled future.
3. **The program** — what plays *next*. A playlist / schedule / ruleset that
   advances the head on its own: day-parting, loops, reactive triggers.

A remote is the set of verbs that operate on those three layers. Two operators
drive them: an **agent** (MCP tools) and a **human** (a companion control view —
phone as the remote for the TV).

## The control surfaces (the verbs)

### 1. Transport — move the head
The determinism makes this real, not faked. Every scene is a filmstrip.
- `now()` / `live()` — jump the head to live.
- `rewind({to})` — park the head on a past keyframe (a `historyId` or a
  timestamp: "what was on an hour ago").
- `scrub({t})` — within the current scene, seek to logical time `t` (uses
  `renderFrame(t, seed)`; exact).
- `pause()` / `resume()` — freeze/unfreeze the head. (Viewers already honor
  `setPaused`.)
- `speed({rate})` — slow-mo / time-lapse a scene's track playback.

### 2. Library & recall — name points on the strip
History is an auto-preset list; names sit on top.
- `history({channelId})` — the timestamped strip (read the rows already written).
- `save({name})` — bookmark the current state as a named preset.
- `recall({name|historyId})` — re-publish a stored scene as live. Deterministic,
  so it returns *identical*, control-track and all.
- `morph({from, to, dur})` — cross-dissolve between two points (needs a
  viewer-side crossfade of two mounted savers — the web host already cross-fades
  on saver change; generalize it to A/B).

### 3. Program — what plays next (the "channel" in channel)
Turns a channel into an actual station.
- `playlist({items:[{scene, durationMs}], loop, shuffle, crossfade})` — a
  sequence the head advances through automatically.
- `queue()` (exists) — one-shot future scene via alarms.
- `dayparts({morning, day, evening, night})` — time-of-day programs, driven by
  the DO alarm we already use for `queueScene`.

### 4. Live mix — a VJ deck (raw primitives exist)
- `setParam()` / `applyTrack()` (exist) — the raw knobs.
- `macro({name})` — intent-level, not path-level: "calmer," "wilder," "warmer,"
  "sparser." A macro is a named bundle of `setParam`s the *server* knows, so the
  agent says intent and the server maps it to the spec's actual paths. This is
  the natural-language remote's sweet spot.
- `intensity({0..1})` — one master knob mapped across a saver's paramSpace
  (count, speed, glow) — the "volume dial" of an ambient scene.

### 5. Reactive — the channel runs itself (thermostat, not switch)
Rules that advance the head without a human. This is where ambient displays get
magical.
- `on({trigger, action})` where trigger ∈ time / weather / calendar / presence /
  now-playing-music / RSS. "When it starts raining outside, publish rain."
  "During my next meeting, go calm." "At sunset, start the dusk→night program."
- Triggers external to the DO push a `data` message (the reactive-binding wire
  protocol from `scene-format.md`); the ruleset maps data → action.

### 6. Multi-screen — one remote, many displays
- `group({channels})` + broadcast a verb to all: "all screens → night."
- `sync({channels})` — same seed + epoch across displays for a video-wall.
  (The Mac app already coordinates per-display; extend across machines.)

### 7. Access — who holds the remote
The token *is* the remote. Refine it:
- control token (write) vs **view token** (read-only share).
- `handoff` — grant another agent co-control (share the token, already possible).
- `rotate` / `revoke` (deferred in capability-auth.md).

## Two operators, one model

- **Agent (MCP):** the verbs above as tools. The agent's superpower is #4/#5 —
  turning "make it feel like a thunderstorm rolling in" into a program of
  publishes, param sweeps, and a weather trigger. No other remote has an operator
  that understands *intent*.
- **Human (companion view):** a phone-sized "now playing + remote" page —
  current scene, a history scrubber (the strip), transport buttons, an intensity
  dial, and the daypart program. The token in the URL = holding the remote.
  This is the artifact that makes the whole thing legible to non-agents.

## What we already have vs. what's missing

| Layer | Have | Missing |
|------|------|---------|
| Strip | `scene_history` writes every publish | read (`history`), recall |
| Head | live publish, `setParam`, pause (viewer) | rewind, scrub-to-`t`, speed |
| Program | `queueScene` + alarms (forward) | playlist, dayparts, loop |
| Mix | `setParam`, `applyTrack` | macros, master intensity |
| Reactive | (nothing) | trigger/rule engine + data wire |
| Multi | Mac per-display coordination | cross-machine groups/sync |
| Access | capability token, `protected` flag | view tokens, rotate/revoke |
| Operator UI | channel viewer (passive) | companion remote view |

We're ~60% in *primitives*; what's missing is the **model** (a playhead concept)
and the **surfaces** that compose primitives into a remote.

## Determinism is the unlock

Everything above is only *exact* because a scene is `{spec, seed, track}` with
seeded RNG. Rewind returns the identical scene; scrub hits the exact frame;
sync across screens is bit-identical; a recorded strip is lossless with no video
storage. A prerendered-video system (AVAL) can't rewind to an arbitrary moment
without storing frames; we get it for free from the format. **The remote is a
feature of the determinism, not bolted onto it.**

## Build order (slices, each shippable)

1. **See & recall the strip** —
   ✅ **See: shipped (July 2026).** Every mutation (publish / setParam /
   applyTrack / seed / sleep / wake / queue / scheduled) is now recorded in an
   `event_log` with timestamp + actor + human summary, linked to `scene_history`
   for recall. Read via the `getHistory` MCP tool and `GET /c/:id/history`
   (public, for the companion UI). Callers pass an optional `actor` label so a
   channel shows *who* steered it, and when.
   ▫︎ **Recall: next** — a `recall({historyId, token})` tool that re-publishes a
   stored scene (deterministic → returns identical). The `scene_id` links are
   already in the timeline.
2. **Transport + companion remote view** — `rewind`/`scrub`/`pause` + a
   phone-sized control page (history scrubber, transport, intensity). Makes it
   *feel* like a remote to a human. *~1–2 sessions.*
3. **Program** — `playlist` + `dayparts` on the existing alarm. The channel
   becomes a station that runs itself. *~1 session.*
4. **Intent mix** — `macro` + `intensity` mapped over paramSpace. The
   natural-language remote's signature. *~1 session.*
5. **Reactive** — trigger/rule engine + external data push (weather/calendar/
   music). The ambient-display magic. *bigger.*
6. **Multi-screen groups** — cross-machine sync. *bigger.*

## Friction log (dogfooded against production, July 2026)

Tested: createChannel → publish (valid + invalid) → setParam (real + bogus
path) → getState → getHistory → viewer as a human. Found, in order of pain:

1. **Server accepts invalid specs.** A spec that fails `validateSpec`
   (`color: "red"`) returns `ok: true`; the only signal is a *misleading*
   `confirmed: false, reason: "no viewers connected"`. The server never runs
   the validator it publishes. Agents get "success" for garbage.
2. **Bogus `setParam` paths return `ok: true` and pollute the track forever.**
   `layers.99.bogus.nonsense` → appended as a permanent delta. No validation
   against the live spec's shape; the strip accumulates garbage.
3. **No resolved state.** After N deltas, `getState` returns the original spec
   + raw delta list; the agent must replay interpolation mentally to know the
   current value. Need `resolvedSpec` (deltas applied server-side).
4. **Same-path deltas compound.** Steering one path repeatedly interpolates
   from in-between values (hit this steering dusk→night). Server could
   supersede prior deltas on the same path (last-wins) instead of stacking.
5. **Mount feedback conflates failure modes.** `confirmed:false` can mean "no
   viewers," "compile failed," or "timed out" — the viewer only reports
   success (`mounted`); it should also report `mount-error` with the message,
   so publish returns *the viewer's actual error*.
6. **Suspected: `layers.N.count` steering doesn't visibly apply** on compiled
   schema savers (viewer showed ~base count despite resolved 200) — verify
   whether the compiled runtime rebuilds entities on count deltas.
7. **No lifecycle:** no `deleteChannel` (test channels now litter prod
   forever), no `rotateToken`, no `recall` yet.
8. **Human dead end:** the viewer shows pixels and nothing else — no channel
   name, no "this is steerable," no path to the remote/timeline. Created
   channels also don't appear anywhere (gallery is a hardcoded list).
9. MCP `text` payloads are stringified-JSON-in-JSON — standard MCP, but worth
   adding `structuredContent` for agents that support it.

## Improvement plan — SHIPPED July 2026 (A1–A5, H1–H3, rate limit; verified 18/18 local + prod smoke)

Second dogfood round found and fixed one more: new channels defaulted to
`sleeping: true`, and once viewers started honoring sleep broadcasts they
rendered frozen — publish now clears sleeping + stale mount errors.

Round 3 (external-agent feedback + probe pass, shipped): thumbnail feedback
loop (viewers snapshot → /c/:id/thumb → publishScene returns thumbUrl — agents
SEE what they made), named presets (savePreset/recall-by-name + remote chips),
/version + `npm run smoke` (22 checks, deploy-propagation-aware), remote live
preview + density slider, gallery liveness badges, event-log cap. Fixes from
an independent agent's session: screen://channels reads the registry,
applyTrack validates paths, createChannel auto-mints memorable ids, scheduled
scenes clear sleeping, all non-2xx → MCP isError.

`applyTrack` glide landed in @idle-screens/schema (steer.ts, 9 unit tests):
compiled savers interpolate numbers/colours ease-in-out and rebuild entities
deterministically on structural change. The site feature-detects
instance.applyTrack (remount fallback until the next npm release ships it).

## Improvement plan (original, for reference)

**For agents (trust the tool's answers):**
- A1. Server-side `validateSpec` on publish/queue → typed SpecErrors in the
  MCP error response. *(bundle: idle-server already deps @idle-screens/schema)*
- A2. Validate `setParam` paths against the live spec; reject unknown paths;
  supersede same-path deltas (fixes 2 + 4, keeps the strip clean).
- A3. `getState` returns `resolvedSpec` + `effectiveValues` alongside the raw
  track.
- A4. Viewer reports `mount-error` over WS → publish confirmation carries the
  real reason (fixes 5).
- A5. Lifecycle tools: `recall`, `deleteChannel`, `rotateToken`.

**For humans (make it legible):**
- H1. **Companion remote view** `/channel/:id/remote` — Now Playing, the
  steering timeline (data is already live at `/c/:id/history`), recall
  buttons, transport. Token pasted/in-URL = holding the remote.
- H2. Viewer chrome on hover: channel name, protected badge, "open remote"
  link/QR.
- H3. Dynamic gallery: created channels registered + listed (the registry
  from capability-auth.md, deferred earlier).

**Shared:** rate limiting; actor auto-default from MCP `clientInfo.name`.

## The one-line thesis

**A channel is a deterministic timeline, and the remote is the set of verbs that
conduct it — transport, program, mix, recall, automate — driven by an agent that
understands intent and a human holding a token. Determinism makes every verb
exact; the token makes it yours.**
