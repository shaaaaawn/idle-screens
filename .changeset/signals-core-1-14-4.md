---
'@idle-screens/core': patch
---

Raise the `@preact/signals-core` floor from `^1.8.0` to `^1.14.4`.

It is a real runtime dependency of this package, so the floor is what consumers
actually install — worth stating rather than letting it drift silently in the
lockfile. No API change; `^1.8.0` and `^1.14.4` resolve to the same major.
