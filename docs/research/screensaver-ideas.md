# Screensaver Research & Implementation Guide

This document compiles historical and modern screensaver concepts that could be adapted into web-based idle screens. It breaks down the implementation feasibility, legal/copyright considerations, technical approaches (WebGL vs. Canvas vs. CSS), and references existing open-source GitHub repositories.

All entries have been validated to exist and are free from AI hallucinations.

## 1. Modern WebGL / CSS Ambient Displays

*   **WebGL Fluid Simulation (PavelDoGreat)**
    *   **Description:** Real-time computational fluid dynamics creating vibrant, viscous waves of color.
    *   **Should I?** Yes. It's a visually stunning, highly performant ambient display.
    *   **Can I?** Yes, it is explicitly MIT licensed.
    *   **How would I?** Vanilla JS and native WebGL (custom vertex/fragment shaders).
    *   **Reference Repo:** `PavelDoGreat/WebGL-Fluid-Simulation`

*   **Three.js GPGPU Particles**
    *   **Description:** Millions of individual points computed on the GPU forming cosmic flow fields.
    *   **Should I?** Yes. Ideal for rendering millions of fluid, dynamic particles efficiently.
    *   **Can I?** Yes, Three.js and its examples are MIT licensed.
    *   **How would I?** Three.js using the `GPUComputationRenderer` (FBO ping-pong technique).
    *   **Reference Repo:** `mrdoob/three.js` (see `examples/jsm/misc/GPUComputationRenderer.js`)

*   **WebGL Water (Evan Wallace)**
    *   **Description:** Photorealistic water physics with ray-traced reflections and caustics.
    *   **Should I?** Yes. A classic caustic water simulation that is deeply relaxing.
    *   **Can I?** Yes, explicitly MIT licensed.
    *   **How would I?** Plain JS, HTML5 Canvas, and native WebGL for raytraced reflections and refractions.
    *   **Reference Repo:** `evanw/webgl-water`

*   **css-doodle (Yuan Chuan)**
    *   **Description:** Abstract, highly structured grid-based geometric patterns using pure CSS properties.
    *   **Should I?** Yes. Powerful for generating grid-based algorithmic art without the overhead of WebGL.
    *   **Can I?** Yes, the library is MIT licensed.
    *   **How would I?** Web Components (`<css-doodle>`) and specialized CSS syntax.
    *   **Reference Repo:** `yuanchuan/css-doodle`

*   **Pure CSS 3D Geometry**
    *   **Description:** Complex, rotating 3D wireframes built without JavaScript.
    *   **Should I?** Yes. Exceptionally lightweight and performant.
    *   **Can I?** Yes. Public CodePens (e.g., from Amit Sheen, Ana Tudor) are MIT licensed by default.
    *   **How would I?** Pure HTML/CSS using `transform-style: preserve-3d` and `@keyframes`.
    *   **Reference:** CodePen (search for CSS 3D geometry).

## 2. Linux / X11 (xscreensaver)

*General Note:* Original xscreensaver logic is X11 licensed (functionally identical to MIT). The aesthetic concepts are not copyrighted.

*   **BSOD**
    *   **Description:** Cycles through fake diagnostic error screens (Blue Screen of Death, kernel panics) from various platforms.
    *   **Should I?** Yes. High nostalgia and humor value.
    *   **Can I?** Yes. Error screen aesthetics aren't copyrightable.
    *   **How would I?** HTML/CSS/DOM (full-screen divs, system fonts).
    *   **Reference Repos:** `tholman/bsod.js`, `karhuton/bluescreen`

*   **XMatrix / GLMatrix**
    *   **Description:** 2D and 3D simulations of the Matrix digital rain.
    *   **Should I?** Yes. The Matrix digital rain is the most iconic hacker aesthetic.
    *   **Can I?** Yes. (Movie logos shouldn't be used, but the falling green text is safe).
    *   **How would I?** 2D Canvas for XMatrix (fading alpha trails). Three.js for GLMatrix.
    *   **Reference Repos:** `Rezmason/matrix` (Highly polished, supports both 2D/3D), `abishekvashok/cmatrix`

*   **Phosphor**
    *   **Description:** Renders text in a pixelated font that mimics the long-sustain phosphor of vintage CRT terminals.
    *   **Should I?** Yes. Simulates a vintage green/amber CRT terminal.
    *   **Can I?** Yes. CRT aesthetics are generic.
    *   **How would I?** Canvas (for drawing text with fading trails) + CSS (blur filters/scanline SVGs).
    *   **Reference Repos:** Many exist on GitHub under `canvas crt terminal`.

*   **Apple2**
    *   **Description:** Simulates an Apple II computer outputting to a cheap color television set.
    *   **Should I?** Yes. Simulating a booting Apple ][ is fantastic retro flair.
    *   **Can I?** Yes. Simulating text output is legal (do not bundle actual copyrighted ROMs).
    *   **How would I?** HTML/CSS/DOM with a vintage pixel font and JS text-typing logic.
    *   **Reference Repos:** General `apple2-emulator` repos on GitHub.

*   **WebCollage**
    *   **Description:** Performs random web searches and creates a continuously updating collage of images.
    *   **Should I?** Approach with caution. Client-side scraping hits CORS issues, and uncurated images risk NSFW content.
    *   **Can I?** Recreating the layout logic is legal, but scraping random images risks API/TOS violations.
    *   **How would I?** CSS Grid or Canvas connected to a curated API (like Unsplash).

## 3. Mac OS Classic & OS X

*   **Flurry**
    *   **Description:** Built-in OS X. Mesmerizing, brightly colored ribbons of glowing light that organically swirl.
    *   **Should I?** Yes! A beautiful, classic particle system.
    *   **Can I?** Yes, original authors permitted derivatives.
    *   **How would I?** WebGL/Canvas via Three.js.
    *   **Reference Repo:** `RoyCurtis/Flurry-WebGL` (MIT)

*   **Arabesque & Shell**
    *   **Description:** Built-in OS X (Quartz Composer). Intricate, geometric lines that draw in 3D space, and spiraling shell-like structures.
    *   **Should I?** Yes. Excellent mathematical/procedural generation challenges.
    *   **Can I?** Yes, as long as it's a "clean room" clone of the math. Apple owns the original code/trademarks.
    *   **How would I?** WebGL (Three.js) for parametric curves and wireframes.
    *   **Reference Repo:** None available (original was proprietary Quartz Composer).

*   **Word of the Day**
    *   **Description:** Built-in OS X. A clean, typographic display featuring a random word and its definition.
    *   **Should I?** Yes. Clean and functional.
    *   **Can I?** Yes. Displaying words/definitions is not copyrightable. Use a free API instead of Apple's dictionaries.
    *   **How would I?** Vanilla HTML/CSS/JS with a dictionary API.
    *   **Reference Repos:** `morenoh149/screensaver_spanish` (MPL-2.0)

*   **Flying Toasters (After Dark)**
    *   **Description:** Classic Mac OS. Retro, 1940s-style chrome toasters with wings flapping.
    *   **Should I?** Yes. The most iconic screensaver in history.
    *   **Can I?** Writing the code is legal. Distributing exact pixel art sprites technically infringes on Berkeley Systems' copyright, though often tolerated. Draw your own sprites to be 100% safe.
    *   **How would I?** CSS animations or HTML5 Canvas.
    *   **Reference Repo:** `bryanbraun/after-dark-css` (MIT)

*   **Lunatic Fringe (After Dark)**
    *   **Description:** Classic Mac OS. A fully playable top-down space shooter game in the vein of Asteroids that triggered on idle.
    *   **Should I?** Yes, if you want a complex game-dev challenge.
    *   **Can I?** Game mechanics aren't copyrighted, but the name/art is.
    *   **How would I?** Canvas + Phaser.js or Matter.js.
    *   **Reference Repo:** `jackinloadup/lunatic-fringe` (AGPL-3.0)

*   **Marine Aquarium (SereneScreen)**
    *   **Description:** Classic Mac OS. A highly detailed virtual fish tank with realistically swimming 3D fish.
    *   **Should I?** Only if you want a massive 3D challenge.
    *   **Can I?** Do not rip or reuse the 3D models/textures. It is strictly enforced commercial software.
    *   **How would I?** Three.js/Babylon.js with custom caustics, skeletal animations, and flocking algorithms.

## 4. Windows 95/98/XP Classics

*   **3D Pipes & 3D Flying Objects**
    *   **Description:** Built-in Windows. Randomly generates and connects metallic 3D pipes, or bounces 3D geometric shapes around the screen.
    *   **Should I?** Yes. Massive nostalgia value.
    *   **Can I?** Yes, via clean-room recreation. Microsoft owns the original C/OpenGL code.
    *   **How would I?** WebGL / Three.js.
    *   **Reference Repos:** `1j01/pipes`, `ecumber/winnt4sdk-screensavers` (archive of original C code)

*   **3D Maze**
    *   **Description:** Built-in Windows. A first-person automated crawl through a brick-textured maze.
    *   **Should I?** Yes. 
    *   **Can I?** Yes (clean-room). Using Microsoft's exact brick/rat textures is technical infringement. Use custom textures.
    *   **How would I?** WebGL / Three.js.
    *   **Reference Repos:** `ibid-11962/Windows-95-3D-Maze-Screensaver`, `jobbojobson/WebGLMaze`

*   **Mystify & Starfield**
    *   **Description:** Built-in Windows. Bouncing polygon outlines leaving fading trails, or accelerating white pixels simulating warp speed.
    *   **Should I?** Yes. Very lightweight and easy to build.
    *   **Can I?** Yes, concepts are generic.
    *   **How would I?** HTML5 2D Canvas (lines and points with fading trails).
    *   **Reference Repos:** `swharden/Mystify`, `tdous/star-field-canvas`

*   **Johnny Castaway (Sierra)**
    *   **Description:** A story-driven screensaver featuring a marooned man on a desert island performing activities.
    *   **Should I?** Maybe. It's beloved but incredibly complex (state machines + thousands of sprites).
    *   **Can I?** Distributing the original assets is illegal (Sierra/Dynamix copyright).
    *   **How would I?** HTML5 Canvas / PixiJS + custom state machine engine.
    *   **Reference Repos:** `jno6809/jc_reborn` (C/SDL2 port), `deckarep/Johnny-Castaway-2026-Public` (Go)

*   **Bad Dog & Mowin' Man (After Dark)**
    *   **Description:** A mischievous dog tears up the desktop, or a man mows the screen.
    *   **Should I?** Maybe. Fun concept but relies heavily on sprite assets.
    *   **Can I?** Same as Flying Toasters—distributing the original art is illegal.
    *   **How would I?** Canvas or CSS layered transparently over DOM elements.

## 5. Console & Arcade Idle Screens

*General Note:* Rebuilding visual layouts/effects from scratch is legal. Ripping BIOS ROMs, exact 3D meshes, trademarked logos (Nintendo, PS, Xbox), or audio is copyright infringement.

*   **PS2 Boot Screen**
    *   **Description:** A dark expanse filled with shifting, transparent glass-like towers emerging from fog.
    *   **Should I?** Yes. Procedural crystal towers in an ambient void.
    *   **Can I?** Yes. Don't use the PlayStation logo or startup sound.
    *   **How would I?** Three.js for box geometries or GLSL Raymarching shaders.
    *   **Reference Repos:** `Kevin-Do/Playstation2Intro`

*   **GameCube Menu Idle**
    *   **Description:** A translucent, glassy 3D cube slowly rotating within a larger skeletal cube framework.
    *   **Should I?** Yes. Ambient 3D cube rolling.
    *   **Can I?** Yes, but Nintendo is highly litigious. Avoid the GameCube logo, font, and audio completely.
    *   **How would I?** Three.js for the cube, overlaid with HTML/CSS.
    *   **Reference Repos:** `vaexenc/gcintro`

*   **Original Xbox Dashboard**
    *   **Description:** A pulsating green orb surrounded by high-tech, industrial metallic framing.
    *   **Should I?** Yes. The glowing "alien" orb and sliding blades are iconic.
    *   **Can I?** Yes, using your own assets.
    *   **How would I?** React/GSAP for sliding menus, Canvas with CSS blur for the glowing background blob.

*   **DVD Video Bouncing Logo**
    *   **Description:** The classic logo floating and bouncing off the edges, changing color.
    *   **Should I?** Yes. It's a rite of passage.
    *   **Can I?** The logo is trademarked. Bouncing a generic shape/name is 100% legal.
    *   **How would I?** Canvas `requestAnimationFrame` or CSS Keyframes.
    *   **Reference Repos:** `NipunRathore/DVDLogoBounceUI`, `RyanRasi/DVD-Bouncing-Logo`

*   **Arcade Attract Modes (Street Fighter II, Daytona USA, Metal Slug X)**
    *   **Description:** Cinematic pans of skyscrapers (SFII), zooming 3D racing cars (Daytona), or frantic pixel-art action (Metal Slug).
    *   **Should I?** Yes (Street Fighter/Metal Slug for 2D sprites; Daytona for low-poly WebGL).
    *   **Can I?** Hosting ripped arcade sprites/music is infringement. Best to build the engine and swap in custom art.
    *   **How would I?** Phaser.js or raw HTML5 Canvas for 2D parallax/sprites. Three.js for low-poly 3D.
    *   **Reference Repos:** `alfredang/street-fighter-game`, `html5-slug`

## 6. Cult Classics & Community Favorites (New Additions)

*   **Neko (The Screen Chasing Cat)**
    *   **Description:** A classic digital pet from the late 80s/early 90s. A cat chases your mouse cursor around the screen when active, or wanders/sleeps during idle mode.
    *   **Should I?** Yes. Highly nostalgic and character-driven.
    *   **Can I?** Yes. Recreating the logic and drawing new pixel art is completely fine.
    *   **How would I (Best Format)?** **DOM/CSS** (moving a sprite-sheet DIV) or **Canvas2D**.

*   **Boids / Flocking Birds**
    *   **Description:** Craig Reynolds' classic artificial life program simulating the flocking behavior of birds.
    *   **Should I?** Yes. Deeply relaxing and mathematically elegant.
    *   **Can I?** Yes. The algorithm is academic and open.
    *   **How would I (Best Format)?** **Canvas2D** (for thousands of 2D triangles) or **WebGL** (for 3D flocks).

*   **Conway's Game of Life**
    *   **Description:** The famous cellular automaton zero-player game. Popular as an algorithmic idle screen.
    *   **Should I?** Yes. Simple rules, complex emergent behavior.
    *   **Can I?** Yes. Public domain mathematical concept.
    *   **How would I (Best Format)?** **Canvas2D** (ImageData manipulation) or **WebGPU** (for rendering massive 4K grids instantly).

*   **Electric Sheep / Fractal Flames**
    *   **Description:** Evolving, deeply complex fractal animations originally generated via distributed computing.
    *   **Should I?** Yes, if feasible. It's the pinnacle of abstract mathematical art.
    *   **Can I?** Yes. The algorithm is open-source.
    *   **How would I (Best Format)?** **WebGPU** (for real-time computation) or **HTML5 Video** (for playing back pre-rendered high-quality loops).

*   **MilkDrop (Winamp Visualizer)**
    *   **Description:** The quintessential late-90s/2000s music visualizer adapted for ambient screens.
    *   **Should I?** Yes. Massive visual variety.
    *   **Can I?** Yes, via ports like Butterchurn (open source).
    *   **How would I (Best Format)?** **WebGL** (Butterchurn port uses WebGL to run original MilkDrop presets).

*   **Fliqlo (Flip Clock)**
    *   **Description:** A beloved minimalist screensaver that simply shows a retro mechanical flip clock.
    *   **Should I?** Yes. It's practical and stylish.
    *   **Can I?** Yes. A flip clock is a generic mechanical design.
    *   **How would I (Best Format)?** **HTML/CSS** using 3D transforms (`rotateX`) for the card flip animation.

*   **Falling Sand / Powder Game**
    *   **Description:** Pixel physics simulation where different elements (sand, water, fire) interact in a grid.
    *   **Should I?** Yes. Very engaging interactive idle screen.
    *   **Can I?** Yes. Standard cellular automata physics.
    *   **How would I (Best Format)?** **WebGPU** (Compute shaders are ideal for sand physics logic) or **Canvas2D** fallback.

*   **3D Flower Box**
    *   **Description:** Windows classic morphing 3D geometric shape (cube to sphere to star) that bounces around.
    *   **Should I?** Yes. A perfect counterpart to 3D Pipes and 3D Maze.
    *   **Can I?** Yes. Generic geometric shapes.
    *   **How would I (Best Format)?** **WebGL** (Three.js) for morph target interpolation.

## 7. Implementation Prioritization

To build out the idle-screens ecosystem efficiently, we should prioritize savers that provide maximum visual impact with minimum complexity, progressively tackling the harder ones.

*(Note: Several classic screensavers have already been successfully implemented in the `savers-classic` package, including BSOD, DVD Logo, Flying Toasters, Mystify, Starfield (Warp), 3D Pipes, Fluid, Flurry, and a 2D Fish Aquarium.)*

### Tier 1: High Impact, Quick Wins (Do First)
*   **Fliqlo (Flip Clock):** Pure CSS/DOM. Minimalist, widely desired.
*   ~~**Mystify / Starfield:**~~ ✅ IMPLEMENTED (`mystify.ts`, `warp.ts`)
*   ~~**DVD Bouncing Logo:**~~ ✅ IMPLEMENTED (`dvd.ts`)
*   ~~**BSOD:**~~ ✅ IMPLEMENTED (`bsod.ts`)

### Tier 2: The Nostalgia Core (Medium Complexity)
*   ~~**Flying Toasters:**~~ ✅ IMPLEMENTED (`toasters.ts`)
*   **XMatrix / Digital Rain:** Canvas2D. Needs text-trail logic, but well documented.
*   **Neko (Cat):** DOM/Canvas2D. Requires basic state machine (sleep, run, wake).
*   **Game of Life / Boids:** Canvas2D/WebGPU. Great algorithm showcases.
*   **3D Flower Box:** WebGL (Three.js). Good intro to 3D morphing before tackling Pipes.
*   ~~**Fish Aquarium (2D):**~~ ✅ IMPLEMENTED (`fish.ts`)

### Tier 3: Advanced Visuals & 3D (High Complexity)
*   ~~**3D Pipes:**~~ ✅ IMPLEMENTED (`pipes.ts`)
*   **3D Maze:** WebGL (Three.js). Requires first-person camera pathfinding.
*   ~~**WebGL Fluid / Flurry:**~~ ✅ IMPLEMENTED (`fluid.ts`, `flurry.ts`)
*   **Falling Sand:** WebGPU. Compute shader cellular automata.

### Tier 4: Grand Challenges (Massive Scope)
*   **Johnny Castaway:** Full 2D game engine / state machine.
*   **MilkDrop / Electric Sheep:** Massive shader compilation or parser requirements.
*   **Marine Aquarium (3D):** Expensive 3D modeling and animation requirements. (Note: A 2D retro variant is already implemented).
