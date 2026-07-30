---
'@idle-screens/schema': patch
---

Fix idle-sequence black canvas — SequenceInstance now self-drives via rAF

Sequences mounted but never painted in live viewers: SpecInstance runs its own
requestAnimationFrame loop, SequenceInstance did not. Add the same
start/stop/loop clock, keep child SpecInstances parent-driven (never forward
pause=false to children — that double-scheduled rAF), and prefer seq.seed for
the outer clock seed.
