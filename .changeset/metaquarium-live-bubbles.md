---
'@idle-screens/saver-metaquarium': minor
---

Living bubbles, all opt-in (defaults unchanged). `bubbleStyle: 'live'` puts the vents on a real bubble life: each bubble grows at the mouth, lets go, rises in a widening helix, sits at the water surface (when the environment has one) and pops. A vent coughs, and goes quiet for a minute or two now and then. `pearling` grows oxygen beads on the flora's leaves over half a minute or more; they ride the leaf as it sways, then let go. It needs `floraDensity`. `co2Mist` adds a fine haze of tiny bubbles and soft puffs drifting from the vents on a slow current. Distant bubbles dim instead of fattening into 3-px dots, and bubbles under ~3 px draw as soft beads. Everything is closed-form in one draw call. Periods divide a 20-minute window, so long uptime stays exact.
