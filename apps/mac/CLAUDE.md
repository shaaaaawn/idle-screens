# apps/mac — agent rules

This is the **macOS menu-bar app** (SwiftPM, ships via `mac-v*` tag). It is
not an iOS app and has no simulator story.

## Never use the built-in iOS Simulator tooling here

Claude Code's iOS Simulator integration (the `mcp__Claude_Code_iOS_Simulator__*`
tools — attach/launch/live panel) is for **iOS apps in the Simulator**. This
app runs natively on the Mac itself; pointing the simulator tooling at it
wastes the session and proves nothing. (The Apple TV target has the same rule
for a different reason — see "Testing tvOS" in the mono CLAUDE.md.)

## Verify with the MCPs and native tools instead

- **Web layer** (`apps/mac/web` — the saver surface the app hosts): use the
  **Browser-pane MCP** (`preview_start`/`navigate`/`take_screenshot`/console
  tools) against the playground or a local server, exactly like any web saver.
- **Channel behaviour**: drive the **idle-screens MCP** (`idle-local` /
  `idle-prod`) — publish/steer scenes and judge results there; the app renders
  the same engine.
- **The native app itself**: build and run it directly
  (`swift build` / `swift run`, or the scripts in `apps/mac/scripts/`), and
  when on-screen verification is needed use the **computer-use MCP** to
  screenshot/drive the real app window — after `request_access`.
- Unit tests: `swift test` from `apps/mac`.
