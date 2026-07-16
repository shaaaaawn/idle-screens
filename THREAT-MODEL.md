# Threat Model

What idle-screens trusts, what it doesn't, and where the security boundaries
are. The core claim — "declarative savers are safe by construction" — is only
worth something if it's written down precisely.

## Assets to protect

1. **The embedding page.** A site that adds `<idle-screen>` must not have its
   DOM, cookies, or network trust exposed to saver content.
2. **Viewers of idlescreens.com channels.** A channel viewer renders content
   published by others; that content must not be able to run arbitrary code.
3. **macOS app users.** The app auto-updates its web bundle from the network;
   that path must not become a code-injection channel.

## Trust levels

| Content | Trust | Why |
|---|---|---|
| `SaverSpec` JSON (schema package) | **Untrusted** | Agent- or user-authored data; validated then compiled |
| Imperative `SaverPlugin`s (classic savers, black hole) | **Trusted** | First-party reviewed JS shipped in npm packages |
| Control tracks / `setParam` values | **Untrusted** | Steering data from channels/MCP; interpolates validated spec fields only |
| Channel scene messages (WebSocket) | **Untrusted** | Resolved to a spec (validated) or a classic saver **id** (allowlist lookup) — never code |
| Mac app web bundle from idlescreens.com | **Verified** | SHA-256 per file pinned by the manifest, checked before install |

## Boundary 1 — the declarative format

A `SaverSpec` is pure data. The expressiveness ceiling of the format **is** the
security boundary:

- **No code execution.** No scripting primitive exists; `compileSaver` maps
  fields to a fixed canvas-drawing interpreter.
- **No I/O.** No URL-typed field exists (sprites are emoji/text/shape — no
  image URLs), so a spec cannot trigger network fetches, exfiltration beacons,
  or file access.
- **No DOM access.** Compiled savers draw into a canvas the runtime creates.
- **Bounded resources.** ≤ 36 layers / ≤ 800 entities / speed ≤ 4000 px/s,
  enforced by `validateSpec` (which never throws and rejects before compile).
- **No photosensitive flashing.** There is no full-field strobe primitive;
  pulse amplitude/frequency are capped below WCAG thresholds with per-entity
  seeded phase. Verifiable per-saver via `@idle-screens/validator`.
- Text sprites render via `fillText` — displayed as glyphs, never parsed as
  HTML/JS.

**Residual risk:** content-level abuse (offensive text/emoji in a spec) is not
a code-safety issue and is handled at the channel layer (below).

## Boundary 2 — imperative savers and passthrough

Imperative plugins are ordinary JavaScript and are **not** sandboxed; they are
first-party code. Two rules limit blast radius:

- **Passthrough savers** (`manifest.passthrough`, e.g. black hole) may read and
  mutate the live page via `ctx.page.victims()`. The contract requires saving
  and restoring inline styles on `dispose()`; the e2e suite asserts restoration.
  Third-party plugin authors get the same powers — embedding a plugin you didn't
  review is equivalent to running its code on your page.
- **Worker-ready savers** run in a dedicated Worker with an OffscreenCanvas and
  no DOM; a host stub throws on any `host.*` access, making DOM reads fail
  loudly rather than silently.

## Boundary 3 — channels and MCP (idlescreens.com)

- Publishing resolves to either a validated `SaverSpec` or a classic saver id
  looked up in a fixed registry. Viewers never execute published code.
- **Write authorization: capability tokens.** `createChannel` claims a channel
  and returns an `isk_…` token once; the server stores only its SHA-256. Mutating
  ops (`publishScene`, `setParam`, `applyTrack`, `setSeed`, `sleep`, `wake`,
  `queueScene`) on a claimed channel require a matching `X-Idle-Token`; a wrong
  or missing token is rejected (403), and claiming a taken name is rejected
  (409). The token *is* the authorization — no accounts. Sharing it grants
  co-authoring; losing it is like losing a password (rotation is future work).
- **The demo channels (`default`, `lobby`, `studio`) are intentionally open** —
  no token, anyone may write. Don't point a permanent display at them.
- Channel state and history (including the `protected` flag, never the token)
  are public reads by design.
- **Residual:** no per-token rate limiting yet (abuse of the open demo channels
  or token brute-force — 128-bit tokens make guessing infeasible, but a flood
  is possible). Rate limiting is future work.

## Boundary 4 — the macOS app update chain

- The app is zero-third-party-dependency Swift; the only remote code path is
  the web bundle refresh from `idlescreens.com/mac/`.
- `manifest.json` pins a **SHA-256 per file**; the app hashes every download
  and rejects the whole update on any mismatch (verified by test: a swapped
  `main.js` is refused and nothing is installed).
- The manifest itself is trusted-on-fetch over TLS from the first-party origin.
  Mitigations for a compromised origin: hash pinning localizes tampering to
  "attacker must also rewrite the manifest"; the fewer-savers guard blocks
  silent downgrades; "Reset to Built-in Savers" and the shipped-bundle fallback
  bound the damage window. Signing the manifest (offline key) is future work if
  distribution widens.
- Bundle content runs inside WKWebView on `file://` with no added entitlements;
  casting is outbound-only (`publishScene` POST).
- The saver overlay never captures credentials: it does not (and cannot,
  without Accessibility permission) intercept the password field of the real
  lock screen — locking remains macOS's.

## Non-goals

- **DRM / content secrecy** — specs and channels are public by design.
- **Sandboxing imperative plugins** — they are trusted first-party code; the
  declarative format is the offering for untrusted authors.
- **Multi-tenant channel isolation** — until capability auth ships, channels
  are cooperatively shared.

## Reporting

Security issues: open a GitHub issue marked `[security]`, or email the
maintainer (see `package.json` author) before public disclosure for anything
exploitable.
