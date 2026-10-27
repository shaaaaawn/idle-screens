---
'@idle-screens/schema': patch
---

Live-render fixes (F129). A `curve: "linear"` stroke now samples every authored vertex, so a path of a few long segments keeps its corners instead of being chamfered by the 24-sample resampler (X566). The textBlock width table counts full-width glyphs (CJK ideographs, kana, Hangul, fullwidth forms) as a whole em instead of 0.55, so a centre-anchored CJK line is centred on screen, and `text-off-screen` and perception see its real extent (X614).
