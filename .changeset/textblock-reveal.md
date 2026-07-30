---
'@idle-screens/schema': minor
---

Add `textBlock.reveal` — animated typing/deleting via one steerable paint param

Optional `reveal` on textBlock sprites: `{ progress, mode: "typewriter", speed, caret }`.
Layout always runs on the full text; reveal only masks which glyphs are painted, so
alignment stays stable as text types. Steer `reveal.progress` (and optionally `speed`)
live via setParam — agents can glide to 0, swap `text` while invisible, then reveal again.
---
