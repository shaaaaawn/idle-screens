---
'@idle-screens/core': patch
---

`SaverInstance.inspect?()` — an optional synchronous state dump (plain JSON, a few KB) that says what a pixel capture cannot: which objects exist, where they are, what behaviour is in flight. Worker savers answer it over new `inspect`/`inspected` protocol verbs; the element proxy exposes `inspect()` (last answer) and `inspectAsync()` (round trip, 2 s timeout).
