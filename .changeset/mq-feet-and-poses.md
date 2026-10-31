---
"@idle-screens/saver-metaquarium": minor
---

Film a dance the way a camera operator would, and transcribe it pose by pose:
- **`followHeight`** stands the chase camera that many body lengths above the followed fish's feet, aimed at them. **`followLens`** gives it its own lens: degrees of view, 0 keeps 55. With `followHeight: 0.2` and `followLens: 15` you get a close-up of a walker's feet, with the floor behind them. Before, no camera could frame below a dancer's middle: the orbit camera keeps at least 6° above the cast, and the chase camera rode over the fish looking down.
- **A choreographed dancer's chase camera holds the stage's front.** `followAngle` now turns round from the class's facing, not the dancer's. A spin, or a turn to walk off, turns the dancer and leaves the shot where it is.
- **Travelling walks and crawls plant their feet.** A `walk` or `crawl` cue with a `>to` now runs its clip on the ground covered since the cue began, so the feet stop skating. In place, it keeps its own pace.
- **`xN` speed:** a cue's clip plays N times as fast (0.25–4). `march x2.3` is footwork in double time, steps every 0.2 s at 128 BPM; `kick x0.25` raises one leg slowly into a balance.
- **`=f` pose:** a cue holds the move's clip at f of its cycle. `rise =0.4` sits up, `curl =0.5` hugs the knees, `jacks =0.25` holds the arms up with the legs wide. Each held pose gives a still to hit, and the dancer moves into it over the end of the cue before.
