---
"@idle-screens/schema": minor
---

Trails, background drift, and authoring improvements

- **Trails** (`trail: { length, fade? }` on layers): afterglow behind moving entities, sampled analytically from past positions with wrap-seam break. Zero impact on RNG streams.
- **Background drift** (`drift: { period, amount? }` on gradient backgrounds): slow sinusoidal oscillation of gradient stop positions with per-stop phase offsets.
- **Comets example**: new spec showcasing trails + drift with 3 layers (stars, comets, fireflies).
- **Density scaling**: `describeScene` and `adviseSpec` improvements for coverage-based advisories.
- **Steer export**: `steerablePaths()` now exported for MCP/server consumption.
- **Validation warnings**: `validateSpec` now returns non-blocking `warnings[]` for unknown properties, misplaced properties (e.g. `blend` inside sprite → "move it up one level"), common renames (`id` → `key`), and near-zero speeds. Helps MCP/server surface actionable feedback to LLM authors.
- **Security**: esbuild override to 0.28.1, top-level permissions on release workflow.
