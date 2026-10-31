---
'@idle-screens/saver-metaquarium': patch
---

The tank no longer loads its Draco decoder or a fish model from a host the page does not control. `dracoPath` must be on the page's own origin or under the decoder this package ships, since DRACOLoader runs the file as a worker script; any other value falls back to the shipped copy. `fishUrl` must be `ipfs://`, a bundled `mq-breed:` / minted `mq-minted:` model, `https://assets.idlescreens.com/`, a URL on the page's own origin, or a file inside this package; any other host swims the default fish instead. Both log once per refused value. Behaviour change for self-hosters: a `fishUrl` on a third-party https host is now refused; serve the GLB from your own origin.
