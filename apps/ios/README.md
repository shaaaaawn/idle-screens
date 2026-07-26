# IdleScreens iOS

Native iOS client for [idle-screens](https://idlescreens.com) — watch ambient-art
screensaver channels, and VJ them live from your phone.

Two roles:

- **Watch** — browse the public channel gallery with live thumbnails, tap a channel
  to view it full-screen in a WKWebView (`/channel/:id`).
- **VJ** — create/claim a channel, hold its capability token (Keychain), and steer it:
  publish savers, shuffle the seed, sleep/wake, flash overlay text.

## Setup

Requires Xcode 16+ and XcodeGen.

```bash
brew install xcodegen
cd apps/ios
xcodegen generate
open IdleScreens.xcodeproj
```

`project.yml` is the source of truth — regenerate after touching it. The generated
`.xcodeproj` is committed (only `xcuserdata/` is gitignored).

Build & test from the CLI:

```bash
xcodebuild -project IdleScreens.xcodeproj -scheme IdleScreens \
  -destination 'platform=iOS Simulator,name=iPhone 17' build
xcodebuild -project IdleScreens.xcodeproj -scheme IdleScreens \
  -destination 'platform=iOS Simulator,name=iPhone 17' test
```

## Architecture

- SwiftUI, iOS 17, Swift 6 with complete strict concurrency. Zero third-party
  dependencies (Foundation + SwiftUI + WebKit + Security only).
- Single `@MainActor @Observable final class AppState` injected via `.environment()`.
  Feature slices live in `AppState+Gallery.swift` (Watch) and `AppState+VJ.swift` (VJ).
- Networking actors over URLSession async/await, all behind an `HTTPTransport`
  protocol so tests can mock:
  - `GalleryClient` — `GET /api/channels`, `GET /c/:id/state`, `POST /c/:id/verify`,
    thumb/viewer URLs.
  - `MCPClient` — stateless JSON-RPC `POST /mcp` (`tools/call`) for `createChannel`,
    `listSavers`, `publishScene`, `setSeed`, `sleep`, `wake`, `overlay`.
- Channel credentials: metadata (`channelId`, `label`, `createdAt`) as JSON in
  UserDefaults; capability tokens (`isk_…`) in the Keychain, keyed by channelId.
- Backend base URL defaults to `https://idlescreens.com`; override via the
  `IDLE_SCREENS_BASE_URL` environment variable (wired into the scheme).

## Manual smoke path

1. Launch on a simulator. The Watch tab lists public channels with thumbnails.
2. Tap a channel — the hosted viewer page loads full-screen.
3. VJ tab → **+** → **New channel** → enter a label → **Create**. The capability
   token is shown once; copy it somewhere safe (it is also stored in the Keychain).
4. Tap the new channel → the deck loads the saver list. Tap a saver to publish it,
   **Shuffle seed** to re-roll, **Sleep/Wake** to toggle, and send overlay text to
   flash it on every viewer.
5. Open `https://idlescreens.com/channel/<your-channel-id>` in a browser to watch
   your steering live.
