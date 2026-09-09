# Documentation

Cross-cutting design docs for `idle-screens`. Repo mechanics live in
[`CLAUDE.md`](../CLAUDE.md); the authoritative SaverSpec format is
[`packages/schema/FORMAT.md`](../packages/schema/FORMAT.md).

`ls docs/` is the truth if this index drifts.

## specs/

Buildable specs and format explorations.

- **[scene-format.md](specs/scene-format.md)** — thought experiment extending SaverSpec with a Scene concept. Not implemented; `packages/schema/FORMAT.md` remains the authoritative spec.
- **[linux-app-plan.md](specs/linux-app-plan.md)** — options analysis for Linux support (overlay vs kiosk vs compositor integration).
- **[linux-app-spec.md](specs/linux-app-spec.md)** — the buildable spec for `apps/linux/` (Rust + WebKitGTK 6, layer-shell). Implemented; `apps/linux/README.md` is the operating doc.

## Runbooks

- **[ios-release.md](ios-release.md)** — TestFlight / App Store runbook for `apps/ios` (CLI-only uploads, build numbering, ASC gotchas).

## Design notes and roadmaps

- **[roadmap-scene-expressiveness.md](roadmap-scene-expressiveness.md)** — what the declarative schema can and cannot express, and the ordered plan for widening it.
- **[v2-simulation-schema-notes.md](v2-simulation-schema-notes.md)** — the simulation schema family; companion to the expressiveness roadmap.
- **[future-ideas.md](future-ideas.md)** — schema, core and MCP research backlog (problem → proposal → where it lives). Not a commitment.
- **[passthrough-stagecraft.md](passthrough-stagecraft.md)** — design notes on the deep passthrough savers (black hole → tide → limelight → slipstream → catwalk): what each couples to the page, and why.
- **[catalog-audit-2026-07.md](catalog-audit-2026-07.md)** — saver-by-saver review of the catalog: consistency, consolidation, params, `renderFrame`, demo tracks.
- **[artist-workshop-2026-07.md](artist-workshop-2026-07.md)** — the July 2026 authoring batch, saver by saver.

## Authoring source material

- **[saver-art-ideas.md](saver-art-ideas.md)** — ten self-contained briefs, each expandable into a full SaverSpec by an agent.
- **[saver-benchmark-prompts.md](saver-benchmark-prompts.md)** — prompts for evaluating LLM creative output against the schema (MCP and standalone variants).
- **[saver-deep-research.md](saver-deep-research.md)** — long-form research on generative/ambient screen art and the systems behind it.

## research/

Original thinking docs that motivated the project. Preserved for context — historical, **not** implementation guidance.

- **[roadmap.md](research/roadmap.md)** — milestone roadmap and project priorities.
- **[macos-app-roadmap.md](research/macos-app-roadmap.md)** — macOS menu-bar app feature plan.
- **[macos-swift-wrapper.md](research/macos-swift-wrapper.md)** — Swift wrapper architecture and implementation notes.
- **[presence-and-channels.md](research/presence-and-channels.md)** — channels, presence, and multi-viewer architecture.
- **[channel-remote-control.md](research/channel-remote-control.md)** — companion remote control design.
- **[mcp-state-architecture.md](research/mcp-state-architecture.md)** — MCP endpoint and server state management.
- **[cloudflare-durable-objects-spec.md](research/cloudflare-durable-objects-spec.md)** — Durable Object design for channel state.
- **[cold-agent-authoring-prompt.md](research/cold-agent-authoring-prompt.md)** — prompt engineering for agent-authored savers.
- **[implementation-guide.md](research/implementation-guide.md)** — saver implementation patterns and guidelines.
- **[screensaver-ideas.md](research/screensaver-ideas.md)** — brainstorming list for new saver concepts.
- **[community-screensaver-wishlist.md](research/community-screensaver-wishlist.md)** — what people ask for in screensaver threads, framed as implementable briefs.
- **[aval-findings.md](research/aval-findings.md)** — AVAL audit findings and build-in-public notes.
