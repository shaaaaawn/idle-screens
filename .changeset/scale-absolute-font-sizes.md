---
'@idle-screens/schema': minor
---

Scale absolute `px` font sizes with the viewport in normalized specs.

A spec using the default `units: 'viewport'` expresses every dimension as a
fraction of `min(w, h)`, but a `sprite.font` carrying an explicit px size was
used verbatim — so `bold 26px monospace` rendered at 26px whether the canvas was
1920 or 320 wide. In a small viewport the text stayed full size and overlapped
itself, which is what made `DASHBOARD_SPEC` unreadable as a thumbnail.

Explicit px sizes in such specs are now scaled by
`min(w, h) / referenceViewport`, matching how the rest of the spec adapts.
Measured on `DASHBOARD_SPEC`, thumbnail-vs-fullsize ink coverage moved from
6.5× to 0.93× (1.0 = proportional).

Specs that opt into `units: 'px'` are asking for absolute sizes and are
unaffected. No bundled example uses `units: 'px'`, so nothing in the shipped
catalogue changes except the dashboard rendering correctly at small sizes.
