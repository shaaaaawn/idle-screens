---
'@idle-screens/schema': patch
---

Advisories stop flagging correct work, and name two real risks they missed.

- `text-overlap` recognises the four-corner outline: copies of one string at (±d, ±d) are one caption, judged per axis rather than by diagonal distance (X611).
- `text-legibility` judges the solid chip painted under a `role: "read"` label when it covers the whole box, not only the background (X562).
- `overlap-seams` stays off tilings whose only seam is a palette: rows or tiles that overlap by a hairline bury their outlines but almost none of their area (new `buriedAreaOf`, X574). Translucent tilings still warn.
- New `motion-intensity-mismatch`: a `motionIntensity: "calm"` scene whose shapes spin faster than 90°/s on average.
- New `flash-near-limit`: a timeline that flickers at least 2 times a second over a quarter of the frame, such as a full-frame step at the 200 ms key floor, which the publish-time gate (more than 3) allows (X589).
