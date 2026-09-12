---
"@idle-screens/schema": minor
---

Examples go comprehensive: five specs and the first bundled sequence.

Every feature that had **no example** now has one:

- **`signal-board`** — `layout: { type: 'table' }`: nine bars and nine labels
  as two layers instead of eighteen positioned blocks. `values` are paint, so
  one `setParam` glides the whole readout.
- **`phase-duet`** — `clock`: three layers (a `pulse.wave` dot field, swelling
  rings, a breathing heart) sharing one clock so they stay in step instead of
  drifting on seeded phases.
- **`web-work`** — `links.mode: 'random'` + `links.falloff`: a web that crosses
  itself with edges that fade toward the cutoff, plus `stroke.orient` marks
  that turn along their heading.
- **`shard-fall`** — `rotate` (static per-entity tilt, which `spin: [0, 0]`
  cannot express) over `blend: 'multiply'` shadows on a pale plate.
- **`murmur`** — `density: 'dense'` doing real work: 620 entities, past the
  500-entity line where `adviseSpec` raises `dense-scene`, so the declaration
  is the thing withholding it.
- **`three-movements`** — the first sequence example anywhere: a `bed` that
  survives every boundary, a `morph` with `text: 'crossfade'` between
  structural twins, a `fade` between unlike segments, and a sequence-level
  `finish`.

New exports `EXAMPLE_SEQUENCES` and `SequenceExample`. A sequence is a
different top-level format, so it gets its own catalog rather than widening
`SCHEMA_EXAMPLES`'s `SaverSpec[]` contract — existing consumers are untouched.

Tests pin the properties the examples teach rather than the prose: every
example validates with zero warnings and zero (non-informational) advisories,
the `three-movements` morph pair is structurally identical so the morph is
real, and `murmur` stays above the threshold its declaration describes.

`three-movements` carries one **deliberate** informational advisory —
`fade-degrades-on-low-tier` — because a fade is the honest transition between
segments with nothing structurally in common, and the lowest capability tier
degrading it to a cut is a fact the piece accepts.
