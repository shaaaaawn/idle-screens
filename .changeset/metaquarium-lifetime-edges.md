---
'@idle-screens/saver-metaquarium': patch
---

Tank lifetime: skip rendering after dispose, scope Draco workers to in-flight
decodes, keep the logical clock running across pause/resume, and apply camera
rotation from the steered azimuth. Paired with the size-ladder schema patch
in the same develop train (#144).
