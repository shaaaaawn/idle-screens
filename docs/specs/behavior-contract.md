# idle-screens -- behavior contract

> **Status (July 2026):** this is the authoritative specification. All 97 items
> are implemented and tested (Vitest unit + Playwright e2e). This doc is current.

Everything the library **must** do, grouped by module. Each line is one requirement
that a test references by number. This is **intended behavior**, not a transcription of
the current code: if a test fails, the default is to fix the code, not soften the test.

Coverage legend: `[U]` Vitest unit (`packages/**/src/*.test.ts`), `[E]` Playwright e2e
(`apps/playground/e2e/*.spec.ts`).

---

## RNG — `rng.ts` (determinism foundation)
- R1 `[U]` Same seed → identical `next()` sequence, on repeated construction.
- R2 `[U]` Different seeds → different sequences (overwhelmingly).
- R3 `[U]` `next()` ∈ [0, 1).
- R4 `[U]` `range(min,max)` ∈ [min, max); respects order.
- R5 `[U]` `int(min,max)` ∈ [min, max] inclusive; covers both endpoints over many draws.
- R6 `[U]` `pick(arr)` returns an element of `arr`; deterministic for a seed.
- R7 `[U]` `fork(salt)` is deterministic (same seed+salt → same stream) and independent
  of the parent stream and of other salts.
- R8 `[U]` Seeds are coerced to uint32 (`seed` and `seed + 2^32` behave identically).

## Control track — `control-track.ts` (stream the program, not frames)
- C1 `[U]` `defaultParams(space)` returns each param's `default`.
- C2 `[U]` Empty track → defaults at any `t`.
- C3 `[U]` `sampleTrack` is pure: identical `(space, track, t)` → identical output.
- C4 `[U]` Before the first delta of a path → that path's default.
- C5 `[U]` After the last delta of a path → that delta's value (held).
- C6 `[U]` `linear` ease interpolates numbers proportionally between deltas.
- C7 `[U]` `smooth` ease uses smoothstep (0 and 1 at ends, eased in the middle).
- C8 `[U]` `step` ease holds the previous value until exactly the delta `t`.
- C9 `[U]` `dur` sets the ramp window: value ramps over `[k.t - dur, k.t]`, flat before.
- C10 `[U]` `color` params lerp per-channel in hex; clamp to #000000..#ffffff.
- C11 `[U]` `bool`/`enum` params switch at the delta (no blending).
- C12 `[U]` `loop` + `duration>0` wraps `t` modulo duration; no wrap without both.
- C13 `[U]` Deltas are applied per-path and sorted by `t` regardless of input order.

## Idle detector — `idle-detector.ts`
- I1 `[U]` `idle` starts false.
- I2 `[U]` After `start()`, no activity for `timeoutMs` → `idle` flips true (once).
- I3 `[U]` Any of the 6 activity events (pointerdown/pointermove/keydown/wheel/touchstart/
  scroll) resets the countdown.
- I4 `[U]` `markActive()` while idle flips `idle` back to false immediately.
- I5 `[U]` Reschedules are throttled to ≥500ms (rapid activity does not thrash the timer),
  but the throttle never prevents the eventual timeout from a genuine reset.
- I6 `[U]` `stop()` removes listeners and cancels the timer (no late fire after stop).
- I7 `[U]` `start()` is idempotent; constructing/using with no `window` (SSR) is a no-op.

## Engine — `engine.ts` (the state machine — the core contract)
- E1 `[U]` Constructs with no `window`/`document` without throwing (SSR/prerender safe).
- E2 `[U]` Initial active plugin = stored pick (if still registered) else `defaultPluginId`
  else first plugin.
- E3 `[U]` `state` starts `awake`; `isSleeping` derived.
- E4 `[U]` `sleep()` sets sleeping; `wake()` sets awake; `toggle()` flips.
- E5 `[U]` `sleep()` is suppressed when `suppress(url)` is true; `forceSleep()` ignores
  suppression.
- E6 `[U]` `disableOnLocalhost` suppresses on localhost/127./[::1] (via `sleep()`).
- E7 `[U]` `wake()` from sleeping marks idle-detector active (restarts the countdown).
- E8 `[U]` selection `fixed`: the active plugin is **kept** across sleeps (a `setPlugin`
  choice persists; `defaultPluginId` is the INITIAL pick only).
- E9 `[U]` selection `random`: picks via the seeded RNG (deterministic for a seed).
- E10 `[U]` selection `rotate`: advances to the next plugin each sleep, wrapping.
- E11 `[U]` `setPlugin(id)` sets active and persists to storage; unknown id is ignored.
- E12 `[U]` Reduced-motion mirrors `matchMedia('(prefers-reduced-motion: reduce)')` and
  reacts to its `change` events.
- E13 `[U]` `sleepOnBlur`: a window `blur` sleeps (respects suppression); off → no blur sleep.
- E14 `[U]` Idle-detector firing triggers `sleep()`.
- E15 `[U]` Clock (`now`) ticks ~1Hz **only** while sleeping AND not hidden; stops otherwise.
- E16 `[U]` `hidden` mirrors `document.visibilityState`.
- E17 `[U]` `activeIsPassthrough` = active plugin manifest `passthrough`.
- E18 `[U]` Config-menu API: `configMenuOpen` starts false; `open/close/toggleConfigMenu`
  drive it; independent of sleep/wake (waking does not close the menu; the menu may open
  while asleep).
- E19 `[U]` `configMenu` resolves to null when `false`/`{enabled:false}`, else filled.
- E20 `[U]` `init()` installs `window.__idleScreens` with
  `{sleep,wake,toggle,setPlugin,openMenu,closeMenu,toggleMenu,state,menuOpen,active,plugins}`.
- E21 `[U]` `init()` is idempotent; `destroy()` removes all listeners + stops the clock and
  leaves no late timers.
- E22 `[U]` `pluginList` = `{id,label}[]` in registration order.

## `<idle-screen>` element — `idle-screen.element.ts` (DOM truth)
- L1 `[E]` Registers via `defineIdleScreen()` (idempotent); importable in Node without
  constructing (Node-safe `HostBase`).
- L2 `[E]` On sleep, opens a top-layer modal `<dialog>` and mounts the active saver into
  `.surface`; on wake, closes it.
- L3 `[E]` 450ms wake arm-guard: input within the guard does NOT wake; after it, input wakes.
- L4 `[E]` Escape/`cancel` on the saver dialog wakes (does not just close).
- L5 `[E]` Passthrough saver → dialog + backdrop transparent; non-passthrough → opaque
  backdrop.
- L6 `[E]` Clock is shown only while asleep, `showClock` true, and non-passthrough.
- L7 `[E]` Reduced-motion → no fade animation; instance mounted paused.
- L8 `[E]` `setPlugin` while asleep remounts the newly-active saver into the host.
- L9 `[E]` On dispose/close the host `.surface` is emptied (no canvas/DOM leak); superseded
  async mounts are discarded.
- L10 `[E]` External-engine handoff: setting `.engine` uses that engine (does not create or
  destroy it); config+plugins path creates & owns one.
- L11 `[E]` Built-in config menu: only present when `configMenu` enabled; hotkey toggles it;
  picking a saver sets it (and previews when `previewOnPick`); Close/Escape/backdrop close;
  `configMenu:false` → no menu, no hotkey.
- L12 `[E]` Window resize while asleep forwards `resize(w, h, dpr)` to the active instance
  (debounced 150ms). DPR changes from browser zoom are included. Works for both
  main-thread and Worker instances.
- L13 `[E]` Worker-ready savers (`manifest.workerReady`) render via OffscreenCanvas in a Web
  Worker when `config.workerUrl` is set and the browser supports `transferControlToOffscreen`
  + module workers. Automatic fallback to main-thread on Worker failure.
- L14 `[E]` Worker pixel verification: `sampleWorkerPixels()` confirms the Worker is rendering
  visible content via a 10×10 grid pixel sample.
- L15 `[E]` Worker reuse: on wake the Worker is cached (not terminated); on the next sleep
  with the same `workerUrl` it is reused. Terminated only on teardown or URL change.
- L16 `[E]` Post-mount Worker crash recovery: a Worker `error` or `messageerror` after
  successful mount terminates the Worker and remounts the saver on the main thread.

## Savers — all 20 must honor the `SaverInstance` interface
- S1 `[E]` Every registered saver `mount()`s and renders into the host (child count > 0).
- S2 `[E]` `resize(w, h, dpr?)` and `setPaused(true/false)` never throw.
- S3 `[E]` `dispose()` empties the host and produces no console errors.
- S4 `[E]` Mounting/disposing every saver in sequence logs zero page errors.
- S5 `[E]` Passthrough **black-hole only**: mutates matching page victims while running and
  **restores** their inline `transform/opacity/willChange/transition` on dispose. The 13
  non-passthrough savers must NOT mutate anything outside their host.
- S6 `[E]` black-hole `renderFrame(t,seed)` is pixel-deterministic across loads; different
  seed → different pixels; `applyTrack` changes the output.
- S7 `[E]` Content sanity: Flying Toasters renders the original Berkeley Systems TOASTER
  sprite (a GIF wing-flap sheet embedded as a `data:` URI, animated via background-position;
  no external URL), that flies — never the airplane glyph (U+2708) a port once used.

## Manifests — self-describing without executing
- M1 `[U]` Every saver manifest has a unique `id` and a non-empty `label`.
- M2 `[U]` `SAVERS`/`CLASSIC_SAVERS` exports contain the expected ids; ids are unique across
  the combined set.

## Validator — `@idle-screens/validator` (photosensitivity + perf gate)
- W1 `[U]` Relative luminance = linearized-sRGB · Rec.709 weights (white=1, black=0, green
  weighted highest); `redness` is an APPROXIMATE saturated-red signal, labelled as such.
- W2 `[U]` Flash analysis is PER TILE (grid), not whole-frame average, so a localized strobe
  cannot be masked.
- W3 `[U]` A flash = a pair of opposing luminance transitions ≥ 0.10 where the darker level
  is < 0.80; in any 1-s window, flashes = floor(transitions / 2).
- W4 `[U]` Boundary: a full-field square wave at **3 Hz passes** (exactly 3 flashes/sec),
  **4 Hz fails**; a bright flash whose darker level ≥ 0.80, or a swing < 0.10, never counts.
- W5 `[U]` Area threshold: content fails only when the flashing area ≥ 25% of the frame
  (a sub-threshold sparkle passes even though its tiles strobe > 3/sec).
- W6 `[U]` Perf: reports mean/median/p95/max + cost tier + jank ratio; a lone spike does NOT
  fail; only a pathological p95 (> 100 ms) hard-fails. Perf is separate from the flash gate.
- W7 `[E]` End-to-end (canvas sampling, stepping `renderFrame(t)`): the black hole PASSES
  the flash gate (by the area exemption) and the frame budget; a 15 Hz full-screen strobe
  FAILS; a 3 Hz strobe PASSES; a saver's declared `a11y.flashSafe` matches the measured
  verdict (manifest honesty).

## Capabilities — `@idle-screens/capabilities` (device tiering + eligibility)
- D1 `[U]` `Capabilities.backends` is always probed; every other field is OPTIONAL
  (deviceMemory/saveData/connection are Chromium-only) — absence must not gate.
- D2 `[U]` `computeTier` base = best available backend (webgpu→high, webgl2→standard,
  canvas2d→basic, css→minimal). Optional signals (save-data, <4GB, ≤2 cores, small coarse
  screen) only LOWER the tier; they never raise it and their absence never lowers it.
- D3 `[U]` Backend availability and tier are SEPARATE axes (`backendSupported` reads the
  detected booleans; a higher backend implies the lower ones).
- D4 `[U]` `costBudget`: minimal→idle, basic→low, standard→medium, high→high.
- D5 `[U]` `evaluateSaver`: **blocked** if the backend is missing or cost > budget;
  under reduced-motion, **blocked** only when `reducedMotionFallback: 'hide'`, else a
  moderate/energetic saver is **degraded** (runs in fallback) and a calm saver stays **ok**.
- D6 `[E]` `detectCapabilities()` reports `backends.css=true`, `canvas2d` probed true in a
  browser; webgl2/webgpu are booleans (not asserted true — often off headless); WebGPU is
  resolved by awaiting the adapter; SSR (no DOM) returns a css-only snapshot without throwing.
- D7 `[E]` The playground panel re-evaluates on simulated capabilities: a minimal (CSS-only)
  device blocks the canvas2d + costly savers (not a silent "14/14 eligible" no-op).

## Declarative schema — `@idle-screens/schema` (agent-authorable savers)
- SC1 `[U]` `validateSpec(unknown)` never throws; returns typed `{path,message}` errors.
  Enforces structure, non-empty id/label, hex colours, and safety/perf CAPS (per-layer,
  total-entity, and max-speed ceilings).
- SC2 `[U]` The entity simulation is PURE and seeded (`buildEntities` uses `ctx.rng`, not
  Math.random) — same seed → identical entities; `positionAt(entity,t)` is analytic and
  deterministic (drift/rise/bounce with correct wrapping/reflection bounds).
- SC3 `[U]` The example specs validate; the AQUARIUM spec demonstrates a two-layer aquarium
  (drift+flip fish over a gradient+seafloor band, rising bubbles) — proving the schema can
  express the shape of a real saver. (The shipped `fish` saver is the exact After Dark sprite
  original; this is the declarative analogue.)
- SC4 `[U]` `compileSaver` derives a manifest (`minBackend:'canvas2d'`, `costTier` from
  entity count, `motionIntensity`) so a compiled spec composes with capabilities; it throws
  on an invalid spec (a spec is validated before it can run).
- SC5 `[E]` A compiled saver renders into the host and is `renderFrame(t,seed)`-addressable.
- SC6 `[E]` **Safety loop:** a compiled spec, sampled through `@idle-screens/validator`,
  PASSES the WCAG 2.3.1 flash gate and the frame budget — "flash-safe by construction" is a
  checked property, not a claim. Design invariant: the schema has NO full-field strobe
  primitive (static background + bounded sprites).
- SC7 `[E]` The playground panel compiles + previews a spec live and surfaces validation
  errors as you edit.
