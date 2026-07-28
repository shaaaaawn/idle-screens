---
'@idle-screens/core': patch
'@idle-screens/savers-classic': patch
---

Add optional `SaverManifest.description` and fill it on every classic saver so hosts (e.g. MCP `listSavers`) can catalog from the package instead of a hand-maintained id list.
