---
"@idle-screens/saver-metaquarium": patch
---

The tank says how many fish it is filling toward. Beside `data-mq-fish` (fish spawned so far), the host now carries `data-mq-want`, the size of the population being loaded, so an embedding app can reveal the tank the moment its whole cast is in instead of waiting for the count to go quiet.
