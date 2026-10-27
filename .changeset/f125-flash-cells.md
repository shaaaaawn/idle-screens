---
'@idle-screens/schema': patch
---

Timeline flash gate: no false refusal for a busy wave of small things (F125 regression). `timelineFlashReport` now counts paint-key boundaries per cell of its 16 × 9 grid, from the keys on the layers that can paint each cell, and skips a dense window where too few cells could flash for a quarter of the frame to. A staggered wave of 28 small static dots, refused on 3.14.0 with "0 flashes a second over 0%", passes without a frame resolved; the full-frame three-path strobe still fails at 5 flashes a second. Moving, emitting and linked layers, and layers whose geometry is keyed, count as reaching every cell. When a dense window is still past the 512-frame budget, the report keeps failing closed and adds `boundariesPerSecond`, so a gate can say the timeline is too dense to verify instead of quoting zeros as a strobe. New export from perception: `layerCellFootprints`.
