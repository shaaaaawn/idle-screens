# macOS App — Feature Roadmap

Living backlog for the standalone menu-bar app (`apps/mac`). See
`macos-swift-wrapper.md` for the architecture rationale.

## Shipped

- Menu-bar app (`LSUIElement`), idle detection via `CGEventSource`
- Per-display overlay windows at `.screenSaver` level, WKWebView engine
- Fade in/out transitions
- Saver picker submenu (Cycle All + 21 savers), generated `SaverCatalog`
- Coordinated saver + seed across displays; Swift-driven cycling via JS bridge
- Display-sleep-vs-threshold warning; system-saver conflict warning
- Battery awareness + "Only on Power" toggle
- Channel mode (`idlescreens.com/channel/<id>`) with offline fallback
- Launch at login (`SMAppService`)
- Release pipeline: `notarize.sh`, `mac-release.yml`, Homebrew cask
- Process-activity keep-alive assertion (prevents App Nap dropping the status item)
- **Preview thumbnails in the Saver menu** — offscreen WKWebView renders each
  saver, `takeSnapshot` → PNG cached under Application Support (keyed by app
  version), set as the menu item's image. `ThumbnailRenderer.swift`.
- **Hot-corner + global hotkey** — ⌃⌥⌘S (Carbon `RegisterEventHotKey`) and a
  configurable hot corner (permissionless global mouse monitor + dwell).
  `Trigger.swift`.
- **Per-display saver assignment** — "Per Display" menu; each display can Follow
  Global or pin its own saver. Cycling only advances the follow-global displays.
- **Respect fullscreen apps** — `SystemInfo.fullscreenAppPresent` (CGWindowList
  geometry heuristic, no Screen Recording perm); "Pause During Fullscreen"
  toggle, default on. (DND/Focus detection deferred — fragile to read.)
- **First-run onboarding** — `Onboarding.swift` welcome window with one-click
  launch-at-login and the system-saver hint.
- **Scheduling** — "Active Hours" presets (with midnight wrap) and "Dim at
  Night" (dims via a `brightness` query param when the system is in Dark mode).

## Shipped (batch 3)

- **"Cast this Mac"** — `ChannelClient.swift` posts a JSON-RPC `publishScene` to
  `idlescreens.com/mcp`; "Cast to Channel…" menu item publishes the current
  saver so other screens mirror it. (Untested against the live endpoint — it's
  an outward publish; verified request shape + compile only.)
- **Bundle refresh from the site** — `BundleManager.swift`: `webRoot` resolves
  to a cached update or the shipped bundle (offline-first); "Check for Saver
  Updates" fetches `<baseURL>/manifest.json` and downloads to a staged cache.
  ⚠︎ Requires the site to host `/mac/manifest.json` + bundle (not yet deployed);
  until then it gracefully reports "no update" and uses the shipped bundle.
- **Web-content crash watchdog** — `webViewWebContentProcessDidTerminate`
  reloads the affected overlay (re-resolving its saver, or the channel).
- **Diagnostics** — `Diagnostics.swift`; menu item + `--diagnostics` flag.
  Reports displays, idle, power, display-sleep, fullscreen, system-saver
  conflict, GPU (Metal), thumbnail cache size, bundle source. Verified live.
- **Thumbnail cache re-key** — `ThumbnailRenderer` keys the cache on a SHA-256
  prefix of `savers.json`, so a bundle refresh / saver-list change regenerates.
  Verified (regenerated under a hash-named folder).
- **Browse while showing** — ←/→ arrow keys flip savers instead of dismissing
  (the wake monitor special-cases keycodes 123/124 and the fast-poll suppresses
  dismiss for 1s after a browse). Uses `setSaver` so it cross-fades.
- **Cross-fade on cycle** — the web host page dips `#host` opacity around each
  saver swap (`opacity 0.22s`), respecting reduced-motion. Verified CSS + swap.

## Shipped (batch 4)

- **Menu-bar icon reflects state** — `display` idle → `display.fill` while
  showing; a 2s `antenna.radiowaves.left.and.right` flash after a successful
  cast. (Update badge dropped: "Check for Saver Updates" auto-installs, so
  there's no "available but not installed" state to badge.)
- **On-screen name + browse hint** — the web host shows an auto-fading
  "‹Saver› · ← → to browse" pill on each saver start/change (3.5s), plus a top
  toast bridge (`__idleScreensMac.toast`) for action feedback. Verified.
- **Favorite / skip from the overlay** — while showing: **F** favorites, **⌫**
  hides from cycle, **Return** pins the one you're viewing. Cycle/browse draw
  from a pool (catalog − hidden, narrowed to favorites when any exist). The
  Saver menu marks ★ favorites / (hidden) and offers "Reset Favorites & Hidden".
- **Server: Mac bundle hosted at `/mac/`** — idle-server's `build-site.mjs`
  builds a parity host (`site/mac/`) from its own `@idle-screens` deps into
  `dist/site/mac/` (index.html + assets/main.js + savers.json + manifest.json).
  Cloudflare Assets serves it; the app's bundle-refresh pulls from
  `idlescreens.com/mac/`. Verified locally (files 200, bundle renders 21 savers).
  ⚠︎ Requires an idle-server redeploy (`npm run deploy`) to go live.

## Shipped (batch 5)

- **Menu + cycle from the live bundle** — `BundleManager.saverCatalog()` reads
  the active bundle's `savers.json`; `SaverController.catalogIds` and the menu
  are injected from it (compiled `SaverCatalog` as fallback). Verified end-to-end
  against the deployed server: refreshing to `/mac/` switched the catalog to the
  server's 21 savers.
- **Weekly auto-check** — `maybeAutoCheckForUpdates` runs on launch if >7 days
  since `lastUpdateCheck`; silent install, deferred toast on next saver show.
  Manual "Check for Saver Updates" still available. Verified live (update
  installed → "cached update", idempotent on re-check).
- **Stop casting** — a successful cast persists `activeCastChannel` and reveals
  "Stop Casting (‹channel›)"; the icon stays as the antenna until stopped.
- **Server deployed** — `idlescreens.com/mac/` is LIVE (manifest v…676797, 21
  savers, main.js 200).

## Quality pass (batch 6)

- **Wake-on-input rewrite** — the saver was dismissing instantly because a ~2px
  trackpad drift counted as a wake (and a manual start dismissed under the hand
  that clicked). Now: keys/clicks wake immediately; mouse movement wakes only
  after the machine settles (idle a beat) AND only when the pointer moves >8pt
  within a poll tick (the origin re-baselines while resting, so slow drift never
  accumulates). Dropped the idle-poll dismiss (couldn't tell drift from a move).
  Verified: saver stays up through drift, keys/clicks still dismiss.
- **Cached bundle: no silent regression + self-heal** — `usingCachedBundle` now
  requires the cached saver set to be ≥ the shipped one, so a server bundle
  that's *behind* the app never downgrades what you see (verified: the live
  server's 21 savers are refused while shipped has 22). A cached bundle that
  fails to load reverts to shipped automatically; "Reset to Built-in Savers"
  menu item for manual recovery.
- **Pure-logic extraction + tests** — `SaverSelection` (pool/index/wrap/resolve)
  and `SaverCatalogLoader` (savers.json decode) are the single source of truth,
  used by `SaverController`/`BundleManager` and covered by 12 XCTest cases.
- **Launch docs** — README troubleshooting: it's menu-bar-only (no window),
  Gatekeeper right-click→Open, black-screen/`--probe`, drift, idle gates.

## Hardening from the AVAL review (batch 7 — see aval-findings.md)

- **SHA-256 bundle integrity** — hashed manifest served from `/mac/` (deployed);
  the app rejects any file whose hash mismatches (tamper-tested).
- **SaverSpec JSON Schema + FORMAT.md** — published with `@idle-screens/schema`;
  schema/runtime agreement is test-enforced.
- **THREAT-MODEL.md** at the repo root.
- **`<idle-screen>` fallback slot** — host-owned `slot="fallback"` shown on
  mount failure (e2e-tested).

## Future ideas (not yet started)

### Bundle refresh, remaining
- **GitHub-releases fallback source** — so bundle-refresh works if
  idlescreens.com is unreachable.
- **Publish `mystify`** so the server's `/mac/` reaches 22 savers (today an
  "update" from the shipped bundle gives *fewer* savers — 21 vs 22 — until it's
  on npm and idle-server redeploys).

### Cast, deeper
- **Cast on a schedule** — reuse Active Hours to auto-cast a spare Mac to a
  channel during set hours (kiosk/gallery mode).
- **Truly clear a channel** — "Stop Casting" is local-only today (the channel
  keeps the last scene); add a server concept to blank a channel.

### Overlay affordances
- **On-screen mini picker** — hold a key to show a thumbnail strip of savers and
  arrow to one (uses the thumbnails we already render).
- **"Why isn't it starting?" nudge** — if the saver hasn't shown in a while and
  a gate is active (fullscreen/battery/active-hours), surface a subtle reason in
  the menu (e.g. "Paused: fullscreen app").

### Cast / channel depth
- **Two-way channel sync** — when casting, also *subscribe* so the menu shows
  "Casting to default (2 viewers)"; use the existing `/c/:id/state` endpoint.
- **Auto-cast on idle** — a "Broadcast this Mac when idle" toggle that casts the
  chosen saver to a channel every time the saver starts (turns a spare Mac into
  a always-on channel source).
- **Cast schema savers with live params** — extend `ChannelClient` to publish a
  full `SaverSpec` + a control track, not just `{id}`, so casting can steer.

### System polish
- **Menu-bar icon reflects state** — dim/animate the status icon while the saver
  is showing or casting; a badge when an update is available.
- **Preferences window** — graduate the growing menu into a real Settings window
  (General / Savers / Displays / Schedule / Advanced) once it passes ~12 items.
- **Multi-monitor "primary only"** — a per-display Off state (infra exists) so
  the saver covers just one screen.

### Reliability / distribution
- **Signed Sparkle-free auto-update for the app itself** (distinct from bundle
  refresh) — daily GitHub-releases check, "Update available" menu item opening
  the DMG. ~40 lines, no dependency.
- **Login-item health nudge** — if launch-at-login is on but `SMAppService`
  reports `.requiresApproval`, surface a one-time nudge to approve it.
- **Thumbnail regen throttle** — today a bundle refresh regenerates all 22
  thumbnails; only regen ids whose spec actually changed (per-saver hash).

## New ideas (from the earlier review, not yet started)

### Interaction & feel
- **Click-to-cycle / arrow-key browse while showing** — tap or press →/← during
  the saver to flip to the next saver instead of dismissing. Turns the overlay
  into a live gallery. (Needs the wake monitor to distinguish "browse" keys from
  "wake" keys.)
- **Fade *between* savers on cycle** — currently the swap is instant; cross-fade
  the WKWebView content on `setSaver` for a smoother cycle.
- **Per-saver dwell weighting** — some savers are more thumbnail-worthy than
  watch-worthy; let cycle favor the good ones (or a "favorites" subset).

### Content & the channel story
- **"Cast this Mac" menu item** — one click publishes the Mac's current bundled
  saver *to* a channel (reverse of channel mode), so other screens mirror it.
- **QR / short code on the overlay** — show a small channel join code so someone
  can steer the display from their phone via the MCP/site.
- **Bundle refresh from the site** — optionally pull the latest `savers.json` +
  bundle from idlescreens.com so new savers arrive without an app update
  (still offline-first; cache locally).

### System integration
- **Wallpaper mode** — same WKWebView at `kCGDesktopWindowLevel` (the Plash
  trick) as a live desktop background, not just idle. Big feature; own toggle.
- **Now-playing / calendar awareness** — pause or switch to a calm saver during
  a scheduled meeting (EventKit, read-only) or while media is playing.
- **Multiple monitors, one "primary only" option** — some users want the saver
  on just the main display; add a per-display "off" state (infra already there).

### Robustness / ops
- **Health self-check menu item** — "Diagnostics": reports display count, idle
  seconds, whether the system saver conflicts, GPU tier, thumbnail cache size.
- **Crash-safe overlay watchdog** — if a WKWebView goes blank (web content
  crash), detect via `webViewWebContentProcessDidTerminate` and reload.
- **Thumbnail regen on saver-list change** — today thumbnails key on app version;
  also invalidate when `savers.json` hash changes so a bundle refresh regenerates.

## Backlog (not lost — future batches)

### Selection & interaction
- **Idle-aware saver escalation** — cheap CSS savers for the first minutes,
  escalate to GPU savers (fluid, reaction-diffusion) after longer idle to save
  power on brief away-from-keyboard moments.
- **Menu-bar live mini-preview** — the status-item icon animates a tiny preview
  of the current saver.

### Rendering & export
- **`renderFrame` still/loop export** — reuse deterministic frame-addressable
  rendering to export a still or short loop as wallpaper.

### Distribution & updates
- **Daily update check without Sparkle** — once-a-day `URLSession` hit on the
  GitHub releases API; menu shows "Update available…" opening the download page.
  (Sparkle itself is out — breaks the zero-dependency rule.)

### Deliberately excluded
- **Password-on-wake** — needs private APIs / hacky `CGSession` calls.
- **Swallowing the wake keystroke** — needs Accessibility permission; not worth
  the prompt. Most replacements let the wake event leak through.
- **Sparkle auto-update** — third-party dependency.

## Notes / constraints

- Zero third-party dependencies is a hard rule. System frameworks only.
- No TCC permission prompts in the core flow (idle detect, overlay, wake all work
  permissionlessly). Any feature that would require Accessibility/Input
  Monitoring/Screen Recording must be opt-in and clearly justified.
- Single source of truth for the saver list is `web/src/savers.ts`; the Swift
  `SaverCatalog` is generated. Never hand-edit the generated file.
