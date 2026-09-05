---
'@idle-screens/schema': patch
---

FORMAT.md: the `trail` row now states that `length` is **milliseconds** (max
5000) and `fade` is a **number 0..1** — not a boolean. `links.falloff` two rows
down *is* a boolean, so `{"length": 1600, "fade": true}` was the natural guess
and the validator's `must be 0..1` was the only place that said otherwise
(mcp_feedback F16, and F9 for the millisecond half). Documentation only — the
JSON Schema and the runtime validator already carried the type.
