---
'@idle-screens/schema': minor
---

Layer groups, `transform.origin`, and advisories that honour paint opacity. All three are opt-in, and a spec without them renders exactly as before.

- `groups: {name: {transform?, opacity?}}` on a SaverSpec, joined by a layer's `group`. A member paints through its group: the group's transform, about the viewport centre, wraps the layer's own, and the group's opacity multiplies the layer's. It's paint, so `setParam("groups.moon.opacity", …)`, a timeline key or a morph moves a multi-layer subject as one thing.
- `transform.origin: 'anchor'` scales and rotates a layer about its own `position` point instead of the viewport centre, so a word punches in place on every aspect.
- `adviseSpec` skips layers whose paint opacity is 0 across the whole scene (checked at every timeline key boundary). Their entities no longer count toward `dense-scene`, and coverage is weighed by paint opacity.
- `steerablePaths` no longer advertises `timeline.*`, which `setParam` can't reach, or the `group`/`origin` enums. It does list `groups.*`.

Native clients ignore groups and origin (identity).
