# Screensaver Implementation & Legal Guide

This document breaks down the implementation feasibility, legal/copyright considerations, and technical approaches (WebGL vs. Canvas vs. CSS) for reproducing classic and modern screensavers in a web environment. It also references existing open-source GitHub repositories you can use for inspiration or code.

---

## 1. Modern WebGL / CSS Ambient Displays

*   **WebGL Fluid Simulation (PavelDoGreat)**
    *   **Should I?** Yes. It's a visually stunning, highly performant ambient display.
    *   **Can I?** Yes, it is explicitly MIT licensed.
    *   **How would I?** Vanilla JS and native WebGL (custom vertex/fragment shaders).
    *   **Reference Repo:** `PavelDoGreat/WebGL-Fluid-Simulation`

*   **Three.js GPGPU Particles**
    *   **Should I?** Yes. Ideal for rendering millions of fluid, dynamic particles efficiently.
    *   **Can I?** Yes, Three.js and its examples are MIT licensed.
    *   **How would I?** Three.js using the `GPUComputationRenderer` (FBO ping-pong technique).
    *   **Reference Repo:** `mrdoob/three.js` (see `examples/jsm/misc/GPUComputationRenderer.js`)

*   **WebGL Water (Evan Wallace)**
    *   **Should I?** Yes. A classic caustic water simulation that is deeply relaxing.
    *   **Can I?** Yes, explicitly MIT licensed.
    *   **How would I?** Plain JS, HTML5 Canvas, and native WebGL for raytraced reflections and refractions.
    *   **Reference Repo:** `evanw/webgl-water`

*   **css-doodle (Yuan Chuan)**
    *   **Should I?** Yes. Powerful for generating grid-based algorithmic art without the overhead of WebGL.
    *   **Can I?** Yes, the library is MIT licensed.
    *   **How would I?** Web Components (`<css-doodle>`) and specialized CSS syntax.
    *   **Reference Repo:** `yuanchuan/css-doodle`

*   **Pure CSS 3D Geometry**
    *   **Should I?** Yes. Exceptionally lightweight and performant.
    *   **Can I?** Yes. Public CodePens (e.g., from Amit Sheen, Ana Tudor) are MIT licensed by default.
    *   **How would I?** Pure HTML/CSS using `transform-style: preserve-3d` and `@keyframes`.
    *   **Reference:** CodePen (search for CSS 3D geometry).

---

## 2. Linux / X11 (xscreensaver)

*General Note:* Original xscreensaver logic is X11 licensed (functionally identical to MIT). The aesthetic concepts are not copyrighted.

*   **BSOD**
    *   **Should I?** Yes. High nostalgia and humor value.
    *   **Can I?** Yes. Error screen aesthetics aren't copyrightable.
    *   **How would I?** HTML/CSS/DOM (full-screen divs, system fonts).
    *   **Reference Repos:** `tholman/bsod.js`, `karhuton/bluescreen`

*   **XMatrix / GLMatrix**
    *   **Should I?** Yes. The Matrix digital rain is the most iconic hacker aesthetic.
    *   **Can I?** Yes. (Movie logos shouldn't be used, but the falling green text is safe).
    *   **How would I?** 2D Canvas for XMatrix (fading alpha trails). Three.js for GLMatrix.
    *   **Reference Repos:** `Rezmason/matrix` (Highly polished, supports both 2D/3D), `abishekvashok/cmatrix`

*   **Phosphor**
    *   **Should I?** Yes. Simulates a vintage green/amber CRT terminal.
    *   **Can I?** Yes. CRT aesthetics are generic.
    *   **How would I?** Canvas (for drawing text with fading trails) + CSS (blur filters/scanline SVGs).
    *   **Reference Repos:** Many exist on GitHub under `canvas crt terminal`.

*   **Apple2**
    *   **Should I?** Yes. Simulating a booting Apple ][ is fantastic retro flair.
    *   **Can I?** Yes. Simulating text output is legal (do not bundle actual copyrighted ROMs).
    *   **How would I?** HTML/CSS/DOM with a vintage pixel font and JS text-typing logic.
    *   **Reference Repos:** General `apple2-emulator` repos on GitHub.

*   **WebCollage**
    *   **Should I?** Approach with caution. Client-side scraping hits CORS issues, and uncurated images risk NSFW content.
    *   **Can I?** Recreating the layout logic is legal, but scraping random images risks API/TOS violations.
    *   **How would I?** CSS Grid or Canvas connected to a curated API (like Unsplash).

---

## 3. Mac OS Classic & OS X

*   **Flurry**
    *   **Should I?** Yes! A beautiful, classic particle system.
    *   **Can I?** Yes, original authors permitted derivatives.
    *   **How would I?** WebGL/Canvas via Three.js.
    *   **Reference Repo:** `RoyCurtis/Flurry-WebGL` (MIT)

*   **Arabesque & Shell**
    *   **Should I?** Yes. Excellent mathematical/procedural generation challenges.
    *   **Can I?** Yes, as long as it's a "clean room" clone of the math. Apple owns the original code/trademarks.
    *   **How would I?** WebGL (Three.js) for parametric curves and wireframes.
    *   **Reference Repo:** None available (original was proprietary Quartz Composer).

*   **Word of the Day**
    *   **Should I?** Yes. Clean and functional.
    *   **Can I?** Yes. Displaying words/definitions is not copyrightable. Use a free API instead of Apple's dictionaries.
    *   **How would I?** Vanilla HTML/CSS/JS with a dictionary API.
    *   **Reference Repos:** `morenoh149/screensaver_spanish` (MPL-2.0)

*   **Flying Toasters (After Dark)**
    *   **Should I?** Yes. The most iconic screensaver in history.
    *   **Can I?** Writing the code is legal. Distributing exact pixel art sprites technically infringes on Berkeley Systems' copyright, though often tolerated. Draw your own sprites to be 100% safe.
    *   **How would I?** CSS animations or HTML5 Canvas.
    *   **Reference Repo:** `bryanbraun/after-dark-css` (MIT)

*   **Lunatic Fringe (After Dark)**
    *   **Should I?** Yes, if you want a complex game-dev challenge.
    *   **Can I?** Game mechanics aren't copyrighted, but the name/art is.
    *   **How would I?** Canvas + Phaser.js or Matter.js.
    *   **Reference Repo:** `jackinloadup/lunatic-fringe` (AGPL-3.0)

*   **Marine Aquarium (SereneScreen)**
    *   **Should I?** Only if you want a massive 3D challenge.
    *   **Can I?** Do not rip or reuse the 3D models/textures. It is strictly enforced commercial software.
    *   **How would I?** Three.js/Babylon.js with custom caustics, skeletal animations, and flocking algorithms.

---

## 4. Windows 95/98/XP Classics

*   **3D Pipes & 3D Flying Objects**
    *   **Should I?** Yes. Massive nostalgia value.
    *   **Can I?** Yes, via clean-room recreation. Microsoft owns the original C/OpenGL code.
    *   **How would I?** WebGL / Three.js.
    *   **Reference Repos:** `1j01/pipes`, `ecumber/winnt4sdk-screensavers` (archive of original C code)

*   **3D Maze**
    *   **Should I?** Yes. 
    *   **Can I?** Yes (clean-room). Using Microsoft's exact brick/rat textures is technical infringement. Use custom textures.
    *   **How would I?** WebGL / Three.js.
    *   **Reference Repos:** `ibid-11962/Windows-95-3D-Maze-Screensaver`, `jobbojobson/WebGLMaze`

*   **Mystify & Starfield**
    *   **Should I?** Yes. Very lightweight and easy to build.
    *   **Can I?** Yes, concepts are generic.
    *   **How would I?** HTML5 2D Canvas (lines and points with fading trails).
    *   **Reference Repos:** `swharden/Mystify`, `tdous/star-field-canvas`

*   **Johnny Castaway (Sierra)**
    *   **Should I?** Maybe. It's beloved but incredibly complex (state machines + thousands of sprites).
    *   **Can I?** Distributing the original assets is illegal (Sierra/Dynamix copyright).
    *   **How would I?** HTML5 Canvas / PixiJS + custom state machine engine.
    *   **Reference Repos:** `jno6809/jc_reborn` (C/SDL2 port), `deckarep/Johnny-Castaway-2026-Public` (Go)

*   **Bad Dog & Mowin' Man (After Dark)**
    *   **Should I?** Maybe. Fun concept but relies heavily on sprite assets.
    *   **Can I?** Same as Flying Toasters—distributing the original art is illegal.
    *   **How would I?** Canvas or CSS layered transparently over DOM elements.

---

## 5. Console & Arcade Idle Screens

*General Note:* Rebuilding visual layouts/effects from scratch is legal. Ripping BIOS ROMs, exact 3D meshes, trademarked logos (Nintendo, PS, Xbox), or audio is copyright infringement.

*   **PS2 Boot Screen**
    *   **Should I?** Yes. Procedural crystal towers in an ambient void.
    *   **Can I?** Yes. Don't use the PlayStation logo or startup sound.
    *   **How would I?** Three.js for box geometries or GLSL Raymarching shaders.
    *   **Reference Repos:** `Kevin-Do/Playstation2Intro`

*   **GameCube Menu Idle**
    *   **Should I?** Yes. Ambient 3D cube rolling.
    *   **Can I?** Yes, but Nintendo is highly litigious. Avoid the GameCube logo, font, and audio completely.
    *   **How would I?** Three.js for the cube, overlaid with HTML/CSS.
    *   **Reference Repos:** `vaexenc/gcintro`

*   **Original Xbox Dashboard**
    *   **Should I?** Yes. The glowing "alien" orb and sliding blades are iconic.
    *   **Can I?** Yes, using your own assets.
    *   **How would I?** React/GSAP for sliding menus, Canvas with CSS blur for the glowing background blob.

*   **DVD Video Bouncing Logo**
    *   **Should I?** Yes. It's a rite of passage.
    *   **Can I?** The logo is trademarked. Bouncing a generic shape/name is 100% legal.
    *   **How would I?** Canvas `requestAnimationFrame` or CSS Keyframes.
    *   **Reference Repos:** `NipunRathore/DVDLogoBounceUI`, `RyanRasi/DVD-Bouncing-Logo`

*   **Arcade Attract Modes (Street Fighter II, Daytona USA, Metal Slug X)**
    *   **Should I?** Yes (Street Fighter/Metal Slug for 2D sprites; Daytona for low-poly WebGL).
    *   **Can I?** Hosting ripped arcade sprites/music is infringement. Best to build the engine and swap in custom art.
    *   **How would I?** Phaser.js or raw HTML5 Canvas for 2D parallax/sprites. Three.js for low-poly 3D.
    *   **Reference Repos:** `alfredang/street-fighter-game`, `html5-slug`
