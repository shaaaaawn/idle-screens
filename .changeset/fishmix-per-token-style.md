---
'@idle-screens/saver-metaquarium': minor
---

`fishMix` tokens can carry their own swim style — `id[:count]@style` (`457:3@hover,257:6@school,497:1@surface`) — so one tank holds several behaviours instead of a monoculture. Untagged tokens follow `swimStyle`; an unknown style is reported as a problem and the fish swims on the scene's style. Formation seats are allotted over the fish whose effective style forms, so a `@school` trio in a hovering tank is a school of three. New `expandFishMixSlots` carries the per-slot style; `expandFishMix` is unchanged.
