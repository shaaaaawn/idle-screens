---
"@idle-screens/saver-metaquarium": patch
---

`describeMetaquarium(params)` reads a scene back as parts: cast rows (count, breed, how it moves, which slots it fills), Room · World · Stage · Camera · Motion · Look sections holding only what the author set, the palette on screen (the author's colours, else the room's own), choreographed changes, and the params that do nothing. `metaquariumParamsFromTrack(deltas)` folds a control track into the params in force at mount, treating live steers (`liveAt`) as already arrived. Both are zero-dep and exported through `./manifest`, so a viewer's scene card or a channel's state can explain a classic scene the way a SaverSpec's layers explain themselves.
