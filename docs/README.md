# Documentation

## specs/

Design explorations for future format extensions.

- **[scene-format.md](specs/scene-format.md)** -- thought experiment extending SaverSpec with a Scene concept. Not implemented; see `packages/schema/FORMAT.md` for the authoritative spec.

## research/

Original thinking docs that motivated the project. Preserved for context and reference.

- **[roadmap.md](research/roadmap.md)** -- milestone roadmap and project priorities.
- **[macos-app-roadmap.md](research/macos-app-roadmap.md)** -- macOS menu-bar app feature plan.
- **[macos-swift-wrapper.md](research/macos-swift-wrapper.md)** -- Swift wrapper architecture and implementation notes.
- **[presence-and-channels.md](research/presence-and-channels.md)** -- channels, presence, and multi-viewer architecture.
- **[channel-remote-control.md](research/channel-remote-control.md)** -- companion remote control design.
- **[mcp-state-architecture.md](research/mcp-state-architecture.md)** -- MCP endpoint and server state management.
- **[cloudflare-durable-objects-spec.md](research/cloudflare-durable-objects-spec.md)** -- Durable Object design for channel state.
- **[cold-agent-authoring-prompt.md](research/cold-agent-authoring-prompt.md)** -- prompt engineering for agent-authored savers.
- **[implementation-guide.md](research/implementation-guide.md)** -- saver implementation patterns and guidelines.
- **[screensaver-ideas.md](research/screensaver-ideas.md)** -- brainstorming list for new saver concepts.
- **[aval-findings.md](research/aval-findings.md)** -- AVAL audit findings and build-in-public notes.
- **[omarchy-plugin-spec.md](research/omarchy-plugin-spec.md)** -- Omarchy's plugin system read from source: why we still fork the idle plugin, the 3s screensaver-window deadline, and the ranked options for stopping.
- **[linux-distro-targets.md](research/linux-distro-targets.md)** -- which distros clear the two gates (libraries, layer-shell compositor), measured per distro, plus what "smoke test" should mean at each level.
- **[tickets-omarchy-and-distros.md](research/tickets-omarchy-and-distros.md)** -- ready-to-file ticket drafts from the two docs above: outbound (first-class Omarchy support) and inbound (distro reach).