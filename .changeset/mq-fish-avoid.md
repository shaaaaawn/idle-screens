---
'@idle-screens/saver-metaquarium': minor
---

Fish make way for each other. A pair about to meet sees it coming up to 1.6 s ahead and parts across its line of travel, over or under before round. The smaller fish gives more, and each fish turns its nose into the dodge so it never slides sideways. Nothing is simulated: the dodge is a pure function of where every fish's route puts it at t, so the same spec, seed and t still give the same frame on every screen.

New param `fishAvoid` (0..1, smooth). **It defaults to 1, which changes how existing channels look**: this is the one param whose default does not keep the old look, because fish swimming through fish was a bug. Set `fishAvoid: 0` for the old pass-through. Measured on a 17-fish reef, frames with a fish inside another fell from 79% to 1%; on 8 fish, from 44% to 0%.

`inspect()` gains `crowding`, which counts the pairs touching now, lists the worst three as `[slot, slot, overlap]`, and gives `without`, the count that would be touching with it off. `perceiveChannel` returns it in `frame.state`.

Two cases fall outside the dodge. Floor creatures and vignette actors hold their ground and the others go round them. A pair passing exactly nose to nose has no side to part to, and the dodge fades there rather than flicking.
