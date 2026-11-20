---
"@idle-screens/validator": patch
"@idle-screens/schema": patch
---

Flash safety: `analyzeFlashes` no longer misses a strobe whose first frame sits between its two levels. Before the first transition it measured every move from the first sample alone, so a 10 Hz 0.21 ↔ 0.39 square wave starting at 0.30 never moved a full 0.10 from it and read as 0 flashes (passing); starting on a peak it read 10. The first move is now measured from the lowest and highest levels seen so far. `timelineFlashReport` (the publish-time timeline check) anchors each chunk of frames on its own first sample, so it inherits the fix.
