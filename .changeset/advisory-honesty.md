---
'@idle-screens/schema': patch
---

Advisories no longer contradict the perception returned beside them. Each case was reproduced on idlescreens.com before the fix, and each one only removes false warnings.
- **`low-contrast-layer`** compares a layer against the solid, static layer underneath it, not only the page background. A near-black key plate on an opaque yellow panel is content (X388).
- **`off-center`** needs two things to agree. The entity head count must be off-centre, and so must the ink, measured on the same luminance grid perception reports. Two dozen overlapping slivers no longer outweigh one full-height stripe (X384).
- **`text-overlap`** stays quiet for the outline / drop-shadow idiom: the same string at the same size, nudged within 15% of its glyph height (X416).
- **Sequences:** a timed segment is judged at one moment inside it, and the message says which. Coverage now sizes text from its px `font` and scales with layer and group transforms, so one word is no longer both "empty" and "33 000 px off-screen" (X418).
- **`perceiveScene` motion** measures layers moved only by `timeline` keys. They read 0 px/s because the timeline was resolved before motion was sampled (X437).
- **`overlap-seams`** on a soft or feathered layer says what is true. Overlaps pool into soft lumps, which suit clouds and haze, but can never form one solid shape. It no longer claims every overlap paints a visible edge (X423, checked in pixels against a hard-edged control).
