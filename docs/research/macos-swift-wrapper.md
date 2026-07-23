# macOS Swift Wrapper for idle-screens — Research & Path

## Status: Research complete, no implementation started (July 2026)

## The question

Can we ship a native macOS wrapper for idle-screens in pure Swift with **zero
third-party dependencies**? What are the paths, what breaks, and what's the
recommended route?

## TL;DR recommendation

**Build a standalone menu-bar app, not a `.saver` bundle.** The classic
screensaver plugin route is technically viable but sits on an abandoned,
sandboxed compatibility shim that Apple has broken in every release since
Sonoma and has explicitly declined to fix or replace. A standalone app:

- needs **zero TCC permissions** (no Accessibility, no Input Monitoring, no Screen Recording)
- uses only system frameworks (AppKit, WebKit, CoreGraphics, IOKit, ServiceManagement)
- controls its own lifecycle (no legacyScreenSaver instance-leak bugs)
- can ship via direct download with standard Developer ID notarization
- can update the web content independently of the native shell

The wrapper is a thin native shell: idle detection + fullscreen windows +
WKWebView pointed at the idle-screens engine (bundled or idlescreens.com).

---

## Path A (rejected): `.saver` bundle via ScreenSaverView

### How it works
Third-party `.saver` bundles are plugins loaded by `legacyScreenSaver.appex` —
a sandboxed compatibility shim Apple built in Catalina when it moved its own
screensavers to a private `.appex` format. You subclass `ScreenSaverView`,
embed a `WKWebView`, and inherit whatever sandbox entitlements the shim has.

### Why it's viable (barely)
WebViewScreenSaver (github.com/liquidx/webviewscreensaver) is a working
existence proof, maintained through macOS 26 Tahoe. Network access works.
WKWebView renders — **if** you apply four mandatory workarounds:

1. **Zero-bounds init** — host may hand you a 0×0 frame; force
   `setFrameSize(NSScreen.main!.frame.size)` or the viewport locks collapsed.
2. **Backing-pixel bounds** — host can pass pixel (2×) dimensions instead of
   points; clamp against `window?.screen?.frame.size`.
3. **`visibilityState` spoofing** — WebKit sees the saver context as
   `hidden` and throttles rAF to ~1Hz (Sonoma bug FB13094564, acknowledged by
   Apple, never fixed). Must inject a `WKUserScript` at document-start
   overriding `Document.prototype.visibilityState`. Without this, every
   rAF-driven idle-screens saver freezes.
4. **Instance leaks** — since Sonoma, `stopAnimation` doesn't fire on
   dismissal, so instances accumulate forever (reports of 15 GB RAM). Must
   self-`exit(0)` on the `com.apple.screensaver.willstop` distributed
   notification.

### Why it's rejected
- **Apple has abandoned the substrate.** The modern `.appex` screensaver API
  has been private since 10.15; requests to open it (FB6363533, FB19235887)
  were explicitly deferred beyond Tahoe by Apple DTS.
- **Every recent release broke something new.** Sonoma: lifecycle + WKWebView
  throttling. Sequoia: rendering regressions, savers demoted to a collapsed
  "Other" section. Tahoe: broken settings deep-link, duplicate instances with
  wrong `isPreview`, and **third-party savers fail on secondary monitors with
  no workaround**.
- **No entitlement control.** A `.saver` is a plugin — you get exactly the
  sandbox legacyScreenSaver has, no more.
- **Distribution friction.** Can't go in the Mac App Store at all; manual
  CLI signing + notarytool + staple-then-rezip (no Xcode support for saver
  targets).

Keep this path in the back pocket only if users demand integration with the
native screensaver settings pane. Reference implementations:
`liquidx/webviewscreensaver` (Obj-C) and `AerialScreensaver/ScreenSaverMinimal`
(Swift template with accumulated workarounds).

---

## Path B (recommended): standalone menu-bar app

### Architecture

```
IdleScreens.app (LSUIElement, menu-bar only)
├── MenuBarExtra (SwiftUI, macOS 13+)     — status item, settings, quit
├── IdleMonitor                            — Timer polling CGEventSource
├── SaverController                        — per-screen overlay windows
│   └── NSWindow(.borderless) × NSScreen.screens
│       ├── level = .screenSaver (1000)    — above menu bar and Dock
│       ├── collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
│       └── WKWebView                      — idle-screens engine
├── PowerManager                           — IOPMAssertion (display wake)
└── LaunchAtLogin                          — SMAppService.mainApp
```

### Idle detection — no permissions needed

```swift
// The macOS analog of Windows GetLastInputInfo. Passive query — no TCC prompt.
let idle = CGEventSource.secondsSinceLastEventType(
  .combinedSessionState,
  eventType: CGEventType(rawValue: ~0)!   // kCGAnyInputEventType (no Swift constant)
)
```

Poll on a `Timer` every 1–5 s while waiting; 100–250 ms while the saver is
showing (the same call detects wake input — when idle drops near 0, dismiss).
This is App Store-safe and permissionless. Alternative: IOKit `HIDIdleTime`
from the IORegistry (Int64 nanoseconds) — works but sandbox behavior is
uncited; prefer CGEventSource.

### Fullscreen overlay

- One borderless `NSWindow` per `NSScreen`, framed to `screen.frame`,
  `level = .screenSaver`, black opaque background.
- `NSApp.presentationOptions = [.hideDock, .hideMenuBar]` while active
  (kiosk belt-and-suspenders), restore `.default` on wake.
- Observe `NSApplication.didChangeScreenParametersNotification` — rebuild
  windows when displays are added/removed/rearranged.
- Multi-display works natively here (unlike the Tahoe `.saver` bug), one
  WKWebView per screen, each with a different channel or the same scene.

### Wake handling — the zero-permission trick

Because our overlay window is **key and frontmost** when the saver is active,
ordinary local event monitors see all input with no TCC prompt:

```swift
NSEvent.addLocalMonitorForEvents(matching: [.mouseMoved, .keyDown, .leftMouseDown, .scrollWheel]) { _ in
  dismissSaver(); return nil
}
```

Plus `window.acceptsMouseMovedEvents = true`. WKWebView consumes events, so
either overlay a transparent event-catching view or rely on local monitors
(they see events before view dispatch). Fallback: the fast CGEventSource poll.

The **only** capability that would require Accessibility permission is
swallowing the waking keystroke before it reaches the app underneath (a
`.defaultTap` CGEventTap). Real screensavers do this; most replacements
(including Aerial's fullscreen companion mode) accept the leak. Ship without
it; add later as an opt-in "strict wake" setting if users care.

### Sleep and the system screensaver

- Hold `IOPMAssertionCreateWithName(kIOPMAssertionTypePreventUserIdleDisplaySleep, ...)`
  while showing (the `caffeinate -d` primitive); release on dismiss.
- **Gotcha:** power assertions do NOT prevent macOS's own screensaver.
  The user should set the system saver to "Never" — read
  `defaults -currentHost read com.apple.screensaver idleTime` at launch and
  show a one-time conflict warning if it's non-zero.
- Tear down immediately on `NSWorkspace.willSleepNotification` and the
  (undocumented but decade-stable) distributed notifications
  `"com.apple.screenIsLocked"` / `"com.apple.screensaver.didstart"`.

### Content strategy — what the WKWebView loads

Three options, in order of preference:

1. **Bundled local build** (true zero-dependency, works offline): build the
   playground-style host page + all saver packages into a static bundle,
   ship in `Resources/`, load via `loadFileURL(_:allowingReadAccessTo:)`.
   A minimal host page that imports `@idle-screens/core` + savers and mounts
   a fullscreen engine is ~50 lines; esbuild output is self-contained.
2. **idlescreens.com channel viewer** (live MCP steering for free): point at
   `https://idlescreens.com/channel/<id>`. The Mac becomes a physical display
   for a channel — publishScene from any MCP client changes what the Mac
   shows. Requires network.
3. **Hybrid**: bundled build as the offline default, optional channel URL in
   settings. This is the best product but adds a settings surface.

Start with (1) for v1; the channel mode is the killer feature for v2.

### Native-web bridge (later)

`WKScriptMessageHandler` + `evaluateJavaScript` gives a two-way bridge with
no dependencies. Candidates: pass `reducedMotion` from
`NSWorkspace.accessibilityDisplayShouldReduceMotion`, pass display refresh
rate, expose battery state to pick cheaper savers on battery
(`costTier` gating via `@idle-screens/capabilities`).

### Launch at login

`SMAppService.mainApp.register()` (macOS 13+, no helper bundle, no deprecated
API). Check `.status` rather than caching — users can toggle it in System
Settings. Default off; macOS shows a notification when registered.

### Distribution

Standard Developer ID app flow: archive in Xcode, sign with hardened runtime,
notarize with `notarytool`, staple, ship as DMG/zip. Optionally Homebrew cask.
(Mac App Store is possible for an app — unlike a `.saver` — but sandbox rules
would need checking for `.screenSaver` window level; not worth it for v1.)

---

## Implementation plan

| Phase | Work | Est. size |
|-------|------|-----------|
| 1 | Xcode project: LSUIElement app, MenuBarExtra, settings window | small |
| 2 | IdleMonitor (CGEventSource poll) + SaverController (per-screen windows) | small |
| 3 | WKWebView + bundled static build of the idle-screens host page | medium |
| 4 | Wake handling (local monitors + fast poll), power assertion, lock/sleep teardown | small |
| 5 | Settings: idle threshold, saver selection, launch-at-login (SMAppService) | small |
| 6 | Display topology handling, conflict warning for system saver | small |
| 7 | Sign + notarize + DMG; Homebrew cask | small |
| 8 | v2: channel-viewer mode (idlescreens.com URL), native bridge (reducedMotion, battery) | medium |

The native shell is genuinely small — roughly 500–800 lines of Swift. All
complexity stays in the web engine where it already lives.

## Risks

| Risk | Mitigation |
|------|-----------|
| WKWebView throttles rAF when window judged "hidden" | Unlikely at `.screenSaver` level with a key window (unlike the `.saver` context), but keep the visibilityState-spoof user script ready |
| User's system screensaver/lock fights ours | Conflict detection at launch; teardown on lock notifications |
| Undocumented distributed notification names change | They've been stable ~15 years; failure mode is graceful (saver just also shows over lock briefly) |
| Global mouse monitor behavior changes | We rely on local monitors + polling, not global monitors |
| Apple sherlocks or restricts `.screenSaver` window level | No signal of this; Plash/Aerial-companion pattern is established |

## Prior art

- **Aerial Companion** (github.com/AerialScreensaver/AerialCompanion) — menu-bar app with experimental fullscreen-saver mode; closest architectural model
- **Plash** (sindresorhus/Plash) — WKWebView in a borderless window at *desktop* level (inverse of ours); repo no longer open source but the pattern is documented
- **WebViewScreenSaver** (liquidx/webviewscreensaver) — the `.saver` route existence proof; reference if we ever do Path A
- **ScreenSaverMinimal** (AerialScreensaver/ScreenSaverMinimal) — Swift `.saver` template with all known workarounds

## Sources

Key citations from the research (July 2026):

- Sonoma WKWebView throttling bug FB13094564: developer.apple.com/forums/thread/736716
- Saver instance leaks: developer.apple.com/forums/thread/738547
- Tahoe third-party saver breakage roundup: developer.apple.com/forums/thread/787444, mjtsai.com/blog/2025/12/10
- macOS 26 WebView saver guide: ytyng.com/en/blog/macos-26-screensaver-webview-without-xcode
- Wade Tregaskis saver guide: wadetregaskis.com/how-to-make-a-macos-screen-saver
- CGEventSource idle: developer.apple.com/documentation/coregraphics/cgeventsource/secondssincelasteventtype(_:eventtype:)
- Event monitor permission split: developer.apple.com/forums/thread/707680
- Power assertions don't stop the screensaver: forums.developer.apple.com/forums/thread/26776
- SMAppService: developer.apple.com/documentation/servicemanagement/smappservice
- Notarization: developer.apple.com/documentation/security/notarizing-macos-software-before-distribution
