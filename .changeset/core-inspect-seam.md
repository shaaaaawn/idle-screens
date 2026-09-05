---
'@idle-screens/core': patch
---

`SaverInstance.inspect?()` — an optional synchronous state dump (plain JSON, a few KB) that says what a pixel capture cannot: which objects exist, where they are, what behaviour is in flight. Worker savers answer it over new `inspect`/`inspected` protocol verbs; the mounted `SaverInstance` the element hands out exposes `inspect()` (the last answer, null until one has arrived) and `inspectAsync()` (a round trip, 2 s timeout) — there is no `inspect()` on the `<idle-screen>` element itself; consumers read it off the instance.
