---
'@idle-screens/schema': patch
---

FORMAT.md: the timeline-steering note no longer calls `sync: 'epoch'` unwired on the site. Inside an epoch-synced sequence every viewer shares the channel clock (the idlescreens.com viewer passes `sequenceBaseT` since idle-server PR 247); a standalone timed scene or a `mount` sequence still runs on each screen's own clock.
