---
'@idle-screens/schema': patch
---

Validator, JSON Schema and FORMAT.md agree (F128, F74):

- `layout: { type: 'list', gap: { x?, y? } }` validates as documented (X615); `gap.x` on a one-column list warns `no-effect`.
- drift `bob` / rise `sway` are documented in min(w,h) units (not px), and an amplitude above 0.25 warns `motion-amplitude` (X575). A warning, not an error, so stored scenes with px-sized values still recall.
- A timeline key whose path collapses to nothing (an eye blinking shut) draws nothing at that moment instead of rejecting the scene; a live steer on that layer is accepted too (X583). A base path must still draw something.
- `fillRule: 'auto'` treats a subpath touching its container's edge as inside it, so a notch cut from the rim is a hole on every edge, not only some (X585).
- A `color` key on a part or path sprite with a `gradient` warns `timeline-key-no-effect` (X588).
- FORMAT.md: a per-motion-type field table (checked against the validator's allowlist and the JSON Schema by a test), the keyable path-drawing fields, and the layer transform's order (rotate/scale about the origin, then translate in screen space) (F74, X588, X563).
