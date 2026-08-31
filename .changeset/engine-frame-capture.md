---
'@idle-screens/core': patch
'@idle-screens/saver-metaquarium': patch
---

Engine-side frame capture: `SaverInstance.capture()` snapshots the current frame as an ImageBitmap, covering the two cases page JS cannot read — worker-transferred canvases (new `capture`/`captured` verbs in the worker protocol, correlated by id, with the element's worker proxy implementing `capture()` end to end) and WebGL canvases in hidden tabs (metaquarium renders a fresh frame and reads it in the same task, before the non-preserveDrawingBuffer buffer is cleared by presentation). Hosts that upload viewer thumbnails or answer on-demand capture requests should prefer `instance.capture()` when present.
