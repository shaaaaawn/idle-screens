---
'@idle-screens/schema': minor
---

Scenes can now declare live data. A new optional top-level `inputs` block lets a SaverSpec say what data it takes and how that data paints it. A `roster` input is a list of `{slot, state, label?, count?, level?}` members, and each slot takes the look of its state. The states are the scene's own. Bindings are paint-only steering deltas: `{i}` stands for the slot in paths, and `{label}`, `{verb}` and `{count}` are allowed in values. An `alert` block covers whole-scene changes, such as a beacon when anyone needs attention.

A host feeds a scene locally, with no server: `instance.applyTrack(inputTrack(spec, 'crew', roster))`. This is the same path a channel uses for steering. New exports: `inputTrack`, `applyInput` (the fed spec, for previews and perception), `rosterDeltas`, `normalizeRoster`, `checkInputs`, `validateInputs` and `INPUT_LIMITS`.

`validateSpec` checks the shape of `inputs`. Unknown template tokens and undeclared `default`/`alert` states are errors. `compileSaver` also proves that every state, for every slot, resolves on the scene, leaves its structural signature untouched and yields a valid scene, so a feed can never be dropped silently. Runtimes that predate `inputs` ignore it, and the JSON Schema accepts it.

New example `outpost` (`OUTPOST_SPEC`): a space station in cross-section with eight crew pods, declaring a `crew` roster. Working crew sit at lit screens, resting crew go to the observation deck, and a member who needs you raises a hand in an amber pod while the roof beacon turns amber. It has no advisories at 16:9 or 16:10, and none when fed.
