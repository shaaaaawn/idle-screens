# Saver Idea Registry

Canonical, sourced backlog for saver discovery and authoring. The index is regenerated from the entries; lifecycle history inside entries is append-only.

## Lifecycle

```
candidate ──triage──▶ triaged ──picked up──▶ in-progress ──▶ shipped
              │              │                      │
              │              │                      └──▶ rejected: <reason>
              │              └──▶ parked: <reason> (e.g. blocked on schema
              │                    feature — cross-post to spec-feature-pipeline)
              └──▶ rejected: <reason> (duplicate / license / not-a-screensaver)
```

- Every entry has a **route**, decided at triage:
  - `spec` — authorable as a SaverSpec with today's FORMAT.md (sprite kinds,
    motion types, overlays)
  - `native` — needs a code `SaverPlugin` (fluid sim, GPGPU particles, video,
    per-pixel feedback — anything declarative sprite fields can't do)
  - `spec-blocked` — ONE named schema feature away; name the feature (it
    becomes a candidate for the spec-feature-pipeline backlog)
- Every entry has a **bucket**: `fine-art-homage`, `nature-atmosphere`,
  `geometric-op-art`, `minimal-ambient`, `flow-particle`, `organic-simulation`,
  `data-typographic`, `canonical-retro` — or, for a candidate that fits none
  of these, a new bucket name proposed at candidate time rather than forced
  into the closest existing fit. A new bucket is appended to this list once
  the entry is triaged and the name is confirmed.
- Entry format (canonical):

```markdown
### <slug>
- title: <name>
- brief: <2-3 sentences — mood, palette, motion; agent-consumable>
- source: <URL or file ref — REQUIRED, no unsourced ideas>
- bucket: <one of the buckets above, or a new name proposed at candidate time>
- route: spec | native | spec-blocked: <feature-name>
- status:
  - 2026-07-25 candidate — found via <source>
  - 2026-07-26 triaged — route: spec; clears hard filters
```

- Slug is the dedup key: lowercase, hyphenated, stripped of artist honorifics
  ("the", "a"). Re-encounter → merge (append source, add dated line), NEVER a
  second entry.

## Index

| slug | title | bucket | route | latest status |
| --- | --- | --- | --- | --- |
| `klimt-der-kuss` | Klimt — Der Kuss | fine-art-homage | spec | shipped |
| `hokusai-great-wave` | Hokusai — The Great Wave, deconstructed | nature-atmosphere | spec | shipped |
| `hilma-af-klint-ten-largest` | Hilma af Klint — The Ten Largest | geometric-op-art | spec | shipped |
| `nostalghia-candle` | Tarkovsky — Nostalghia's candle | minimal-ambient | spec | shipped |
| `deep-sea-bioluminescence` | Deep-sea bioluminescence | nature-atmosphere | spec | shipped |
| `mondrian-broadway-boogie-woogie` | Mondrian — Broadway Boogie Woogie | geometric-op-art | spec | shipped |
| `turner-fighting-temeraire` | Turner — The Fighting Temeraire | nature-atmosphere | spec | shipped |
| `kusama-infinity-nets` | Kusama — Infinity Nets | geometric-op-art | spec | shipped |
| `okeeffe-flower-at-night` | O'Keeffe — a flower at night | fine-art-homage | spec | shipped |
| `voyager-pale-blue-dot` | Voyager — the Pale Blue Dot | minimal-ambient | spec | shipped |
| `gpgpu-particle-flow` | GPGPU Particle Flow | flow-particle | native | candidate |
| `webgl-water-caustics` | WebGL Water Caustics | organic-simulation | native | candidate |
| `css-doodle-grid-art` | CSS Doodle Grid Art | geometric-op-art | spec | shipped |
| `css-3d-wireframes` | CSS 3D Wireframes | geometric-op-art | native | candidate |
| `phosphor-terminal` | Phosphor Terminal | data-typographic | spec | shipped |
| `apple-ii-television` | Apple II Television | canonical-retro | spec-blocked: crt-scanline-color-bleed-overlay | triaged |
| `arabesque-shell` | Arabesque & Shell | geometric-op-art | native | candidate |
| `three-d-maze` | 3D Maze | canonical-retro | native | triaged |
| `johnny-castaway-inspired` | Story-driven Castaway | canonical-retro | native | triaged |
| `bad-dog-mowin-man` | Desktop Mischief Vignettes | canonical-retro | native | triaged |
| `ps2-glass-towers` | Fogbound Glass Towers | minimal-ambient | native | candidate |
| `gamecube-glass-cube` | Glass Cube Menu Idle | minimal-ambient | native | candidate |
| `xbox-alien-orb` | Industrial Alien Orb | minimal-ambient | native | candidate |
| `arcade-attract-mode` | Original Arcade Attract Mode | canonical-retro | native | triaged |
| `boids-flocking-birds` | Boids / Flocking Birds | organic-simulation | native | candidate |
| `conway-game-of-life` | Conway's Game of Life | organic-simulation | native | candidate |
| `fractal-flames` | Fractal Flames | flow-particle | native | candidate |
| `milkdrop-ambient` | MilkDrop-inspired Ambient Visualizer | flow-particle | native | candidate |
| `falling-sand` | Falling Sand | organic-simulation | native | candidate |
| `three-d-flower-box` | 3D Flower Box | canonical-retro | native | triaged |

## Entries

### klimt-der-kuss
- title: Klimt — Der Kuss
- brief: A gilded meadow dissolves into ornament on an umber-black ground. Soft gold circles cluster like an embrace while bronze, malachite, and ivory geometry rises through drifting gold-leaf sparks.
- source: `docs/saver-art-ideas.md#1-klimt--der-kuss-golden-phase`
- bucket: fine-art-homage
- route: spec
- status:
  - 2026-08-31 triaged — route: spec; imported from saver-art-ideas and clears hard filters
  - 2026-09-11 shipped — shipped as spec klimt-der-kuss (Der Kuss, Gilded) — field bg + finish grain showcase; premiered on prod default in the 6h docs-ideas arc (glm-5.3). Spec: greenroom/specs/klimt-der-kuss.json

### hokusai-great-wave
- title: Hokusai — The Great Wave, deconstructed
- brief: Indigo rhythm sweeps left to right as foam-white circles arc into a claw above blue spray and faint boats. A small pale Fuji holds the horizon while the rest of the composition moves asymmetrically.
- source: `docs/saver-art-ideas.md#2-hokusai--the-great-wave-deconstructed`
- bucket: nature-atmosphere
- route: spec
- status:
  - 2026-08-31 triaged — route: spec; imported from saver-art-ideas and clears hard filters
  - 2026-09-11 shipped — shipped as spec hokusai-great-wave — posterised field sea + stroke claw marks; premiered on prod default in the 6h docs-ideas arc (glm-5.3). Spec: greenroom/specs/hokusai-great-wave.json

### hilma-af-klint-ten-largest
- title: Hilma af Klint — The Ten Largest
- brief: Dusty rose, ochre, and pale-blue spiritual diagrams breathe against dark plum. Fine white points orbit the large discs while sparse sacred glyphs turn on long, calm periods.
- source: `docs/saver-art-ideas.md#3-hilma-af-klint--the-ten-largest`
- bucket: geometric-op-art
- route: spec
- status:
  - 2026-08-31 shipped — imported from saver-art-ideas; existing shipped homage noted by the source

### nostalghia-candle
- title: Tarkovsky — Nostalghia's candle
- brief: A single warm-white flame holds a near-black field, surrounded by an almost invisible breathing halo. Smoke-grey circles and rare amber embers rise slowly; darkness supplies the tension.
- source: `docs/saver-art-ideas.md#4-tarkovsky--nostalghias-candle`
- bucket: minimal-ambient
- route: spec
- status:
  - 2026-08-31 shipped — imported from saver-art-ideas; ships as schema example `nostalghia-candle`

### deep-sea-bioluminescence
- title: Deep-sea bioluminescence
- brief: True black holds rare cyan, violet, and green miracles: a few pulsing jellyfish glows, marine-snow sparks, and slow orbiting lights. The scene stays overwhelmingly dark and spacious.
- source: `docs/saver-art-ideas.md#5-deep-sea-bioluminescence--the-midnight-zone`
- bucket: nature-atmosphere
- route: spec
- status:
  - 2026-08-31 triaged — route: spec; imported from saver-art-ideas and clears hard filters
  - 2026-08-31 shipped — corroborated by `docs/future-ideas.md:72-74` (second non-vision authoring session, round 3: "Midnight Zone" is this brief, one of four savers shipped via MCP + live-canvas pixel-read)

### mondrian-broadway-boogie-woogie
- title: Mondrian — Broadway Boogie Woogie
- brief: Red, yellow, and blue squares bounce along horizontal and vertical lanes over warm cream. Short grey-white trails imply the grid while syncopated speeds turn city traffic into daytime jazz.
- source: `docs/saver-art-ideas.md#6-mondrian--broadway-boogie-woogie`
- bucket: geometric-op-art
- route: spec
- status:
  - 2026-08-31 triaged — route: spec; imported from saver-art-ideas and clears hard filters
  - 2026-09-11 shipped — shipped as spec mondrian-broadway — lane traffic on implied grid; premiered on prod default in the 6h docs-ideas arc (glm-5.3). Spec: greenroom/specs/mondrian-broadway.json

### turner-fighting-temeraire
- title: Turner — The Fighting Temeraire
- brief: Bruised orange, gold, and violet atmosphere consumes a nearly vanished ship. A low pale sun and quiet water glints drift through a mournful composition built from translucency and near-stillness.
- source: `docs/saver-art-ideas.md#7-turner--the-fighting-temeraire`
- bucket: nature-atmosphere
- route: spec
- status:
  - 2026-08-31 triaged — route: spec; imported from saver-art-ideas and clears hard filters
  - 2026-09-11 shipped — shipped as spec turner-temeraire — smooth field atmosphere + finish; premiered on prod default in the 6h docs-ideas arc (glm-5.3). Spec: greenroom/specs/turner-temeraire.json

### kusama-infinity-nets
- title: Kusama — Infinity Nets
- brief: Hundreds of near-uniform dots breathe out of phase across deep red or violet. A handful of larger orbs drift through the field, making repetition rather than velocity the source of trance.
- source: `docs/saver-art-ideas.md#8-kusama--infinity-nets--obliteration-room`
- bucket: geometric-op-art
- route: spec
- status:
  - 2026-08-31 triaged — route: spec; imported from saver-art-ideas and clears hard filters
  - 2026-08-31 shipped — corroborated by `docs/future-ideas.md:72-74` (second non-vision authoring session, round 3: "Infinity Net" is this brief, one of four savers shipped via MCP + live-canvas pixel-read)

### okeeffe-flower-at-night
- title: O'Keeffe — a flower at night
- brief: Monumental magenta, coral, and rose circles overlap on indigo to form a single nocturnal bloom. The petals open over long grow cycles while tiny dew sparks stay close to the flower.
- source: `docs/saver-art-ideas.md#9-okeeffe--a-flower-at-night`
- bucket: fine-art-homage
- route: spec
- status:
  - 2026-08-31 triaged — route: spec; imported from saver-art-ideas and clears hard filters
  - 2026-09-11 shipped — shipped as spec okeeffe-flower-night — stroke petals + parented-orbit dew; premiered on prod default in the 6h docs-ideas arc (glm-5.3). Spec: greenroom/specs/okeeffe-flower-night.json

### voyager-pale-blue-dot
- title: Voyager — the Pale Blue Dot
- brief: One pale-blue disc and its faint halo persist within an immense black star field. Barely moving dust traces the sunbeam artifact, keeping the mood still, remote, and humbling.
- source: `docs/saver-art-ideas.md#10-voyager--the-pale-blue-dot`
- bucket: minimal-ambient
- route: spec
- status:
  - 2026-08-31 triaged — route: spec; imported from saver-art-ideas and clears hard filters
  - 2026-09-11 shipped — shipped as spec voyager-pale-blue-dot — first live density sparse declaration + emit glint; premiered on prod default in the 6h docs-ideas arc (glm-5.3). Spec: greenroom/specs/voyager-pale-blue-dot.json

### gpgpu-particle-flow
- title: GPGPU Particle Flow
- brief: A cosmic field of hundreds of thousands of luminous points folds through GPU-computed currents. Slow coherent turbulence and a restricted cool palette make scale, not speed, the spectacle.
- source: `docs/research/screensaver-ideas.md#1-modern-webgl--css-ambient-displays` (`mrdoob/three.js`, `GPUComputationRenderer`)
- bucket: flow-particle
- route: native
- status:
  - 2026-08-31 candidate — imported from screensaver research; preliminary native route

### webgl-water-caustics
- title: WebGL Water Caustics
- brief: A quiet pool bends reflected light into drifting caustic lattices, with restrained ripples disturbing an otherwise meditative surface. Refraction and per-pixel lighting supply the depth.
- source: `docs/research/screensaver-ideas.md#1-modern-webgl--css-ambient-displays` (`evanw/webgl-water`)
- bucket: organic-simulation
- route: native
- status:
  - 2026-08-31 candidate — imported from screensaver research; preliminary native route

### css-doodle-grid-art
- title: CSS Doodle Grid Art
- brief: Seeded geometric cells repeat, interrupt, and phase-shift across a strict grid. A limited palette and slow parameter cycles turn procedural structure into an op-art wall.
- source: `docs/research/screensaver-ideas.md#1-modern-webgl--css-ambient-displays` (`yuanchuan/css-doodle`)
- bucket: geometric-op-art
- route: spec
- status:
  - 2026-08-31 candidate — imported from screensaver research; concept only, no library code
  - 2026-09-11 shipped — shipped as spec doodle-grid-riso (Doodle Wall, Riso) — grid layout + polygon rotate + pulse.wave ripple + finish; premiered on prod default in the 6h docs-ideas arc (glm-5.3). Spec: greenroom/specs/doodle-grid-riso.json

### css-3d-wireframes
- title: CSS 3D Wireframes
- brief: Lightweight wireframe solids rotate through a dark void, exposing nested edges and impossible depth. Clean geometry, long periods, and a two-color palette keep the field architectural.
- source: `docs/research/screensaver-ideas.md#1-modern-webgl--css-ambient-displays`
- bucket: geometric-op-art
- route: native
- status:
  - 2026-08-31 candidate — imported from screensaver research; preliminary native route

### phosphor-terminal
- title: Phosphor Terminal
- brief: Green or amber glyphs type and decay with long CRT persistence beneath soft scanlines. A fixed seeded text corpus avoids runtime network access while preserving the feeling of an old terminal dreaming.
- source: `docs/research/screensaver-ideas.md#2-linux--x11-xscreensaver`
- bucket: data-typographic
- route: spec
- status:
  - 2026-08-31 candidate — imported from screensaver research; deterministic corpus required
  - 2026-08-31 triaged — route: spec confirmed; `sprite.kind: "text"` + `trail`/`ghosting` gives the typing-and-decay mechanic that is this idea's whole identity (FORMAT.md `## layers[]`, `## Determinism contract`) — no live network needed, corpus is fixed at author time. Soft scanlines are a nice-to-have finish, not core to the brief, so they don't block the route.
  - 2026-09-11 shipped — shipped as spec phosphor-terminal — textBlock reveal typewriter + anchor/font/opacity + ghosting; premiered on prod default in the 6h docs-ideas arc (glm-5.3). Spec: greenroom/specs/phosphor-terminal.json

### apple-ii-television
- title: Apple II Television
- brief: A clean-room boot-like text sequence glows through color bleed, scanlines, and cheap-television distortion. Original text and graphics evoke the era without ROMs or proprietary assets.
- source: `docs/research/screensaver-ideas.md#2-linux--x11-xscreensaver`
- bucket: canonical-retro
- route: spec-blocked: crt-scanline-color-bleed-overlay
- status:
  - 2026-08-31 candidate — imported from screensaver research; clean-room assets required
  - 2026-08-31 triaged — route corrected native → spec-blocked; the boot-text typing itself is already `spec` (textBlock `reveal: {mode: "typewriter"}`, tracked as G6 in `docs/future-ideas.md`, still Open cross-platform), but this brief's identity is centered on the CRT distortion — color bleed, scanlines, cheap-TV warp — and FORMAT.md has no screen-space post-process/overlay concept (background is solid/gradient+band+drift only). Naming the missing feature: a screen-space scanline/color-bleed overlay filter, for the spec-feature-pipeline backlog.

### arabesque-shell
- title: Arabesque & Shell
- brief: Fine luminous curves draw intricate parametric shells in three-dimensional space. Slow rotation and restrained color let mathematics accumulate into a delicate floating sculpture.
- source: `docs/research/screensaver-ideas.md#3-mac-os-classic--os-x`
- bucket: geometric-op-art
- route: native
- status:
  - 2026-08-31 candidate — imported from screensaver research; clean-room math required

### three-d-maze
- title: 3D Maze
- brief: A first-person camera wanders an original brick-and-fog labyrinth with no player input. Seeded generation and pathfinding make every route reproducible while preserving Windows-era unease.
- source: `docs/research/screensaver-ideas.md#4-windows-9598xp-classics` (`jobbojobson/WebGLMaze`)
- bucket: canonical-retro
- route: native
- status:
  - 2026-08-31 candidate — imported from screensaver research; clean-room textures required
  - 2026-08-31 triaged — route: native confirmed; a first-person camera crawling 3D brick-and-fog geometry has no analogue in FORMAT.md, whose motion vocabulary is 2D-sprite-plane (`drift`/`rise`/`bounce`/`orbit`/`wander`/`warp`/`path`) with only pseudo-depth via `warp`'s z-scaling — a true walked 3D corridor needs a mesh-and-camera `SaverPlugin` like `saver-metaquarium`.

### johnny-castaway-inspired
- title: Story-driven Castaway
- brief: An original marooned character performs small deterministic island vignettes across a long seeded itinerary. Custom art and scenarios capture the pleasure of discovering rare events without copying Sierra assets or story beats.
- source: `docs/research/screensaver-ideas.md#4-windows-9598xp-classics`
- bucket: canonical-retro
- route: native
- status:
  - 2026-08-31 candidate — imported as a non-interactive clean-room ambient adaptation
  - 2026-08-31 triaged — route: native confirmed; a recognizable character performing distinct scripted vignettes needs custom illustrated/animated character art and a branching state machine, neither of which today's primitive sprite kinds (emoji/text/circle/ring/streak/rect/textBlock) can express — this is a code `SaverPlugin`, not a declarative spec.

### bad-dog-mowin-man
- title: Desktop Mischief Vignettes
- brief: Original tiny characters perform slapstick chores across a simulated desktop surface. A seeded scene schedule and wholly new sprites retain the playful After Dark structure without reusing protected art.
- source: `docs/research/screensaver-ideas.md#4-windows-9598xp-classics`
- bucket: canonical-retro
- route: native
- status:
  - 2026-08-31 candidate — imported from screensaver research; original assets required
  - 2026-08-31 triaged — route: native confirmed; same gap as Story-driven Castaway — original character sprite animation and chore/state scripting are outside the declarative sprite-field vocabulary.

### ps2-glass-towers
- title: Fogbound Glass Towers
- brief: Translucent towers rise and recede inside a dark, fog-heavy expanse. Slow camera drift and cold blue-grey light evoke a console-era dream without logos, sounds, or copied geometry.
- source: `docs/research/screensaver-ideas.md#5-console--arcade-idle-screens` (`Kevin-Do/Playstation2Intro`)
- bucket: minimal-ambient
- route: native
- status:
  - 2026-08-31 candidate — imported from screensaver research; original clean-room composition required

### gamecube-glass-cube
- title: Glass Cube Menu Idle
- brief: A translucent inner cube rolls within a sparse skeletal frame. Long easing, violet-grey light, and original geometry create a quiet machine-like totem without Nintendo marks or audio.
- source: `docs/research/screensaver-ideas.md#5-console--arcade-idle-screens` (`vaexenc/gcintro`)
- bucket: minimal-ambient
- route: native
- status:
  - 2026-08-31 candidate — imported from screensaver research; original clean-room composition required

### xbox-alien-orb
- title: Industrial Alien Orb
- brief: A green energy mass pulses behind slow metallic shutters in a near-black chamber. Organic glow against hard framing provides the tension; all branding and dashboard UI are omitted.
- source: `docs/research/screensaver-ideas.md#5-console--arcade-idle-screens`
- bucket: minimal-ambient
- route: native
- status:
  - 2026-08-31 candidate — imported from screensaver research; original clean-room composition required

### arcade-attract-mode
- title: Original Arcade Attract Mode
- brief: A deterministic sequence of original pixel-art or low-poly vignettes advertises an imaginary arcade game. Cinematic pans and brief action loops supply energy without requiring interaction or copied franchise assets.
- source: `docs/research/screensaver-ideas.md#5-console--arcade-idle-screens`
- bucket: canonical-retro
- route: native
- status:
  - 2026-08-31 candidate — imported as an original non-interactive adaptation
  - 2026-08-31 triaged — route: native confirmed; distinct pixel-art/low-poly vignettes with cinematic camera pans need custom art assets and scripted camera choreography beyond sprite layers and the fixed motion types in FORMAT.md.

### boids-flocking-birds
- title: Boids / Flocking Birds
- brief: A large flock coheres, separates, and wheels through an open dusk sky. Seeded initial conditions and fixed-step simulation turn Reynolds-style rules into reproducible murmuration-like motion.
- source: `docs/research/screensaver-ideas.md#6-cult-classics--community-favorites-new-additions`
- bucket: organic-simulation
- route: native
- status:
  - 2026-08-31 candidate — imported from screensaver research; preliminary native route

### conway-game-of-life
- title: Conway's Game of Life
- brief: A seeded cellular field blooms into oscillators, collisions, and long-lived debris. Restrained phosphor color and a slow camera scale make emergence readable rather than frantic.
- source: `docs/research/screensaver-ideas.md#6-cult-classics--community-favorites-new-additions`
- bucket: organic-simulation
- route: native
- status:
  - 2026-08-31 candidate — imported from screensaver research; preliminary native route

### fractal-flames
- title: Fractal Flames
- brief: Iterated color-density transforms form slowly evolving, feathery cosmic structures. The renderer uses a fixed seed and analytic time controls rather than distributed or live inputs.
- source: `docs/research/screensaver-ideas.md#6-cult-classics--community-favorites-new-additions`
- bucket: flow-particle
- route: native
- status:
  - 2026-08-31 candidate — imported from screensaver research; deterministic native implementation required

### milkdrop-ambient
- title: MilkDrop-inspired Ambient Visualizer
- brief: Feedback textures fold a small restricted palette into tunnels, blooms, and liquid symmetries. A seeded synthetic control track replaces microphones and live audio so every frame remains reproducible.
- source: `docs/research/screensaver-ideas.md#6-cult-classics--community-favorites-new-additions` (Butterchurn lineage)
- bucket: flow-particle
- route: native
- status:
  - 2026-08-31 candidate — imported as a deterministic ambient adaptation; no preset copying

### falling-sand
- title: Falling Sand
- brief: Grains, water, and embers settle through a cellular world under simple material rules. Seeded initial conditions and fixed-step updates keep the quiet geological motion deterministic and non-interactive.
- source: `docs/research/screensaver-ideas.md#6-cult-classics--community-favorites-new-additions`
- bucket: organic-simulation
- route: native
- status:
  - 2026-08-31 candidate — imported as a non-interactive deterministic adaptation

### three-d-flower-box
- title: 3D Flower Box
- brief: A faceted solid morphs between cube, sphere, and star-like forms while drifting through a dark field. Original geometry and slow interpolation preserve the Windows-classic appeal without copied assets.
- source: `docs/research/screensaver-ideas.md#6-cult-classics--community-favorites-new-additions`
- bucket: canonical-retro
- route: native
- status:
  - 2026-08-31 candidate — imported from screensaver research; preliminary native route
  - 2026-08-31 triaged — route: native confirmed; morph-target interpolation between distinct 3D solids (cube/sphere/star) has no representation in FORMAT.md's 2D sprite-plus-motion model.
