---
'@idle-screens/core': minor
'@idle-screens/saver-catwalk': patch
'@idle-screens/saver-tide': patch
'@idle-screens/saver-limelight': patch
'@idle-screens/saver-slipstream': patch
---

**core:** new optional `SaverInstance.composition(): SaverLayer[]` — a mounted
instance can describe its practical composition stack, bottom-up: the `page`
deck a passthrough saver performs on (host-bound; the saver only borrows the
document), the `surface`(s) it owns, and the logical draw `pass`es inside
them. Deliberately distinct from the schema's declared sprite layers, and
deliberately small: multi-surface savers, per-pass toggles and cross-saver
scenes extend this model rather than replacing it.

All four deep passthrough savers (catwalk, tide, limelight, slipstream) now
describe their stacks. The playground's Layers panel renders the stack for
any mounted saver — compositor-style, top deck first, with eye toggles that
solo decks for inspection (hide the page, keep the performer; hide the
overlay, watch the pure page deformation).
