---
'@idle-screens/core': patch
---

`SaverInstance.inspect?()` — an optional synchronous state dump (plain JSON, a few KB) that says what a pixel capture cannot: which objects exist, where they are, what behaviour is in flight. Worker savers answer it over new `inspect`/`inspected` protocol verbs; the mounted `SaverInstance` the element hands out exposes `inspect()` (the last answer, null until one has arrived) and `inspectAsync()` (a round trip, 2 s timeout), and `<idle-screen>` itself carries the same two as conveniences that forward to whatever is mounted (null when nothing is).
