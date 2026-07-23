# Community Screensaver Wishlist

> Compiled from forum discussions (Reddit r/screensavers, VOGONS, Hacker News, NeoGAF, Ars Technica, Screensavers Planet, and nostalgia threads across the web). Descriptions are oriented toward what would make a satisfying implementation in this project.

---

## 1. Classic Windows Screensavers (Most Requested for Revival)

These shipped with Windows 3.1 through XP and are the ones people most often ask "where can I get this again?" or "someone should bring this back."

### 3D Maze (Windows 95/98)
- **What it is:** A first-person flythrough of a brick-walled maze with a brown stone floor and a cloudy sky backdrop. The camera randomly traverses, turns, and occasionally bumps into walls. Sometimes encounters a floating smiley face, a rat, or a rotating OpenGL teapot.
- **Why people love it:** The ultimate liminal-space aesthetic before "liminal space" was a term. It feels mysterious and exploratory — like something important is around the next corner but never reveals itself. The lo-fi 3D has an uncanny, dreamlike quality.
- **Demand signals:** Multiple browser remakes exist. Someone even turned it into a playable game. One of the top upvoted nostalgia posts on tech forums.
- **Implementation approach:** Wolfenstein-style raycasting or simple WebGL. Key details: brick texture, sky gradient, the occasional easter-egg objects (smiley, teapot), and the way the camera rotates before choosing a new direction. A modern take could render procedurally-generated maze geometry with nicer lighting but keep the brown brick / gray stone floor / blue-sky palette.

### 3D Pipes (Windows 95/98/NT)
- **What it is:** A network of 3D pipes grows across the screen, with elbows, T-junctions, and ball joints. Pipe surfaces can show a texture or remain solid-colored. The camera slowly rotates or tracks the growing pipe network.
- **Why people love it:** Mesmerizing, oddly satisfying to watch the structure build itself. The metallic pipe surfaces catch light nicely. Varied joint types keep it from getting samey.
- **Demand signals:** Gizmodo called it "the best screensaver of all time." Raymond Chen at Microsoft wrote about its origin as an OpenGL tech demo. Multiple web remakes exist with hundreds of GitHub stars.
- **Implementation approach:** Procedural pipe generation with 3D rendering. Key details: multiple joint styles (elbow, ball, T, cross), the metallic/specular surface, slow camera orbit, toggle between textured and solid pipes. A modern version could add neon/cyberpunk or copper/steampunk variants.

### Starfield Simulation (Windows 3.1+)
- **What it is:** White dots (stars) rush outward from center-screen toward the viewer at configurable speed and density, simulating space travel at warp speed.
- **Why people love it:** Hypnotic, simple, sci-fi. Maxing out the speed slider felt like lightspeed. Pairs well with synthwave music.
- **Demand signals:** Ubiquitous nostalgia mention. Often the first screensaver anyone remembers from childhood computing.
- **Implementation approach:** Simple 2D canvas with perspective projection of particles. Key detail: stars should accelerate smoothly from center outward. A modern take could add colorful nebulae, varying star colors/temperatures, optional spaceship silhouettes.

### Mystify Your Mind (Windows 3.1+)
- **What it is:** Two (or more) four-sided polygons bounce around the screen, continuously morphing their shape, leaving a fading trail of edges. Each side is rendered as multiple thin parallel lines that rotate, creating a subtle 3D ribbon effect.
- **Why people love it:** Hypnotic minimalism. Feels like a 90s music visualizer. The multi-line edges create an optical illusion of twisting ribbons.
- **Demand signals:** One of the few classic Windows screensavers still bundled with Windows 11. Frequently cited as "the best one."
- **Implementation approach:** Canvas 2D with fading trails. Key detail: each polygon edge is drawn as 5 thin parallel lines that rotate over time, creating the signature ribbon-twist look. Multi-line edge drawing is the defining visual trick.

### Flying Windows (Windows 3.1+)
- **What it is:** Same as Starfield but the stars are replaced with colorful Windows logos flying toward the viewer.
- **Why people love it:** Pure Microsoft nostalgia. The vintage 4-color Windows flag logo is a time capsule.
- **Demand signals:** Frequently requested alongside Starfield, often ranked above it in "best of" lists.
- **Implementation approach:** Same as Starfield but with sprite-based logos. Key detail: the 4-color waving Windows flag, properly distorted by perspective as it approaches.

### 3D Flower Box (Windows 98)
- **What it is:** A 3D geometric object (default: a cube) continuously morphs — sprouting spikes, growing petals, collapsing into a sphere/volleyball shape, then returning to a cube. Floats and rotates against a black background.
- **Why people love it:** Mesmerizing shapeshifting. Feels organic despite being purely geometric. Great demo of early real-time 3D.
- **Implementation approach:** Procedural vertex displacement on a polyhedron. Key detail: the smooth interpolation between cube → spiky ball → smooth sphere → cube. Multiple selectable base shapes (tetrahedron, cylinder, spring).

### 3D Flying Objects (Windows 98/XP)
- **What it is:** A single 3D object (Windows flag, ribbon, explosion, splash, twist) flies around the screen. The XP version famously featured the Windows XP logo that would eventually center itself and resolve into the full logo.
- **Why people love it:** The XP logo version is pure 2000s nostalgia. The "explode" and "ribbon" variants are visually impressive.
- **Implementation approach:** 3D rendering of selectable objects. XP logo variant needs the flag wave animation + the final centering/expansion trick.

### 3D Text (Windows 95/98)
- **What it is:** User-configurable text rendered in 3D, spinning/floating across the screen with optional metallic or textured surface.
- **Why people love it:** Customizable — you could put your name or a message. The metallic 3D lettering looked "futuristic."
- **Implementation approach:** Text-to-3D extrusion with rotation. Key detail: the metallic/chrome surface option.

### Aquarium / Underwater (Windows 95 + Plus! XP)
- **What it is:** Fish swim among coral and sea plants with bubbles and light rays. Two distinct versions: the flat 2D Underwater from Win95, and the much more realistic 3D Aquarium from XP Plus!
- **Why people love it:** One of the few "realistic" screensavers. The XP version is genuinely pretty. SereneScreen Marine Aquarium (a third-party version) became a whole product line.
- **Demand signals:** The Marine Aquarium screensaver was so popular it spawned a fan forum with hundreds of threads and feature requests spanning years.
- **Implementation approach:** 2D sprite-based fish with smooth swimming AI, or 3D fish models with procedural animation. Key details: varied fish species, bubbles, swaying plants, light caustics on the floor, subtle background coral.

### Jungle / Space / Baseball / Dangerous Creatures (Microsoft Plus! themes)
- **What they are:** Theme-specific screensavers bundled with Microsoft Plus! packs. Jungle showed cartoon animals with startling sound effects. Space had astronauts. Baseball was a simple baseball diamond animation.
- **Why people love them:** Deep-cut nostalgia for the Plus! era. The Jungle one specifically is remembered for being weirdly scary.
- **Implementation approach:** Sprite-based animations with themed assets. Jungle is the most iconically bizarre one.

---

## 2. After Dark Modules (Berkeley Systems, 1989–1996)

The Holy Grail of screensaver collections. After Dark had dozens of official modules plus hundreds of third-party ones. People still actively search for ways to run these on modern systems.

### Flying Toasters
- **The icon.** Chrome 1940s-style toasters with bird wings fly across the screen carrying toast. A darkness slider controlled the toast's done-ness. Later versions added bagels, pastries, baby toasters, and music (Ride of the Valkyries or a karaoke toaster anthem).
- **Why people love it:** It's absurdist humor executed with genuine craft. The chrome rendering was impressive for the era. It became the face of screensavers as a cultural phenomenon.
- **Demand signals:** By far the most-searched-for After Dark module. Multiple remakes exist. Featured in lawsuits, merchandise, and a mobile game. The 51st Flying Toaster Squadron slogan was on T-shirts.
- **Implementation approach:** Sprite-based or 2D canvas. Key details: the chrome material look, the wing-flapping animation, the toast, adjustable darkness, optionally bagels and baby toasters. The humor is essential — don't make it too slick.

### Starry Night
- **What it is:** A nighttime cityscape with twinkling stars, occasionally punctuated by shooting stars or a UFO. Very atmospheric, very peaceful.
- **Why people love it:** Calm, beautiful, feels like a painting. The slow pace makes it ideal for actual idle-screen use.
- **Implementation approach:** 2D canvas painting of a city silhouette + animated star field + occasional events. Key detail: the Van Gogh-esque star swirls in some versions.

### Fish / Fish World
- **What it is:** An aquarium with cartoon-style fish. Fish World was a more elaborate version where fish interacted with each other and their environment.
- **Why people love it:** The aquarium screensaver before aquariums were everywhere. The fish had personality.
- **Implementation approach:** Sprite-based swimming fish with simple behaviors.

### Mowing Man
- **What it is:** A little man pushes a lawnmower across the screen, leaving a trail of mowed grass behind him. He methodically covers the entire screen area.
- **Why people love it:** Satisfying completionism — watching him finish the whole lawn. The grass-mowing pattern is oddly meditative.
- **Demand signals:** One of only three After Dark modules officially remade for modern macOS.
- **Implementation approach:** Grid-based coverage algorithm. Key detail: the mowed-vs-unmowed grass texture, the little man sprite, the systematic mowing pattern (usually back-and-forth rows).

### Boris the Cat
- **What it is:** A cartoon cat that prowls the screen, batting at the mouse cursor, pawing at windows, and generally causing mischief.
- **Why people love it:** Interactive — Boris reacts to the mouse. Feels like a virtual pet. One of the most character-driven screen savers.
- **Demand signals:** One of the three officially remade for modern macOS.
- **Implementation approach:** Sprite-based cat with a simple behavior tree. Key detail: Boris must notice and bat at the cursor, and occasionally just curl up to sleep.

### Bad Dog
- **What it is:** A cartoon dog that runs around the screen being destructive — digging up the desktop, chewing on windows, leaving messes. Later spawned a TV cartoon series.
- **Why people love it:** Chaotic energy. Interactive. The humor of watching a dog wreck your virtual desktop.
- **Implementation approach:** Sprite-based dog with destructive animation sequences. Key detail: the "damage" effects on screen elements, the dog's expressions.

### Warp / Hyperspace
- **What it is:** A first-person tunnel effect — you fly through a 3D grid/wireframe tunnel at high speed, similar to the hyperspace sequences in Star Wars.
- **Why people love it:** Sci-fi, fast, disorienting in a good way. Early 3D that still looks cool.
- **Implementation approach:** Perspective-projected wireframe or textured tunnel. Key detail: the acceleration feel, optional color cycling.

### Lunatic Fringe
- **What it is:** A psychedelic grid of colored squares that pulse and shift in complex patterns. Very trippy, very colorful.
- **Why people love it:** Pure visual overload. Great for parties. The patterns feel organic despite being grid-based.
- **Implementation approach:** Grid of colored cells with a cellular-automata-style update rule. Key detail: the pulsing, the color palette transitions, the way patterns propagate.

### Rain
- **What it is:** Rain falls on a window pane, with droplets running down and occasional thunder/lightning. Cozy, atmospheric.
- **Why people love it:** The coziest screensaver. Rain-on-window is a whole ASMR/ambient genre now.
- **Implementation approach:** Particle-based rain + glass simulation. Key details: droplet trails, occasional lightning flash, maybe a subtle window frame silhouette.

### Other Noteworthy After Dark Modules
- **Daredevil Dan** — a stuntman on a motorcycle jumping ramps across the screen
- **Hula Twins** — two hula dancers swaying on either side of the screen
- **Message** — scrolling marquee text, often used for pranks ("YOUR COMPUTER HAS A VIRUS")
- **Satori** — abstract geometric patterns with a Zen aesthetic
- **You Bet Your Head** — trivia questions displayed as a screensaver (odd but memorable)
- **Zot** — sparks/lightning bolts arcing across the screen
- **Fractal Forest** — procedurally generated tree-like fractal shapes
- **Gravity** — particles attracted to moving gravity wells
- **Rose** — a blooming 3D rose
- **Confetti** — colorful confetti falling

---

## 3. Third-Party Cult Classics

### Johnny Castaway (Sierra, 1992)
- **What it is:** A tiny castaway on a tiny island. Johnny goes about his day — fishing, building sandcastles, napping in a hammock, trying to signal passing ships — all in real-time, following a day/night cycle. It's essentially a screensaver sitcom.
- **Why people love it:** It's a STORY. You check in on Johnny and see what he's up to. He remembers your birthday. He celebrates holidays. There are rare events (a mermaid, a UFO). No other screensaver has this much character.
- **Demand signals:** People have been asking for a modern Johnny Castaway for decades. It's the third most-downloaded screensaver on Screensavers Planet. An XDA thread from 2010 begged for an Android live wallpaper port.
- **Implementation approach:** This is ambitious — it needs a state machine for Johnny's daily routine, a time system, a large library of animation sequences, and event rarity. A simplified version could focus on a smaller set of charming animations with time-of-day variation.

### Electric Sheep (Scott Draves, 1999–present)
- **What it is:** A distributed computing art project. Thousands of computers render "sheep" (fractal flame animations) and vote on the best ones. The result is an endless stream of evolving, never-repeating psychedelic abstract animations. Still active.
- **Why people love it:** It's genuinely alive — no two moments are the same. The crowd-sourced evolution means the visuals improve over time. The aesthetic is uniquely recognizable: glowing, organic, fractal forms morphing in slow motion.
- **Demand signals:** Ongoing active project. People specifically ask "is there anything like Electric Sheep?" when looking for modern alternatives.
- **Implementation approach:** Fractal flame rendering. This is computationally heavy. A lightweight alternative could pre-compute a set of interpolation paths through fractal flame parameter space and cycle through them.

### Flurry (Calum Robinson, macOS 10.2–10.14 default)
- **What it is:** Streaming jets of colorful particles that swirl, flare, and spiral against a dark background. It glows. Multiple WebGL ports exist.
- **Why people love it:** The quintessential "modern" abstract screensaver. Beautiful, high-contrast, colorful. Feels both chaotic and harmonious.
- **Demand signals:** Multiple JS/WebGL ports. People specifically miss it after Apple removed it in macOS 10.15.
- **Implementation approach:** Particle system with flow fields, glow/bloom post-processing. Key detail: the color palette (deep blues, magentas, cyan), the way streams intersect and flare up.

### Matrix / GLMatrix (XScreenSaver / Jamie Zawinski)
- **What it is:** The Matrix "digital rain" — green katakana characters falling in 3D perspective with depth fog. The gold standard of Matrix screensavers.
- **Why people love it:** The Matrix aesthetic never died. The 3D depth makes it more immersive than flat rain. The green-on-black is iconic.
- **Demand signals:** Multiple modern ports (Swift+Metal, KDE Plasma wallpaper). Someone recently built a full modern C version with native macOS and Windows renderers.
- **Implementation approach:** Columns of falling characters with 3D perspective. Key details: katakana character set (not just random glyphs), the bright "lead" character, the fade-to-black trail, depth fog, optional reflections.

### SereneScreen Marine Aquarium (Jim Sachs, 2000–2014)
- **What it is:** The most famous third-party aquarium screensaver. Photo-realistic 3D fish (especially the Achilles Tang and Clown Triggerfish) swimming in a detailed coral reef tank with light caustics, bubbles, and swaying plants. Think "Pixar-quality aquarium."
- **Why people love it:** It looked shockingly real for its time and still holds up. People bought entire PCs just to run it. The fish behavior was carefully modeled on real species.
- **Demand signals:** Dedicated fan forum with years of feature requests (people wanted: more fish species, multiple tanks, breeding behavior, ambient sound). The developer passed away and the community still hopes for a revival.
- **Implementation approach:** 3D fish models with species-accurate swimming and behavior. Key details: light caustics, realistic fin movement, appropriate reef backdrop, the wow factor of the detailed fish textures.

### Kaos (Tom Dowdy, 1991 — "Dark Side of the Mac")
- **What it is:** A slow-building geometric artwork. It starts with a few colored dots and over 10–30 seconds iteratively grows them into complex webs-within-webs patterns, resolving into highly detailed mandala-like images, then vanishes and starts again.
- **Why people love it:** It feels like watching an artist draw. The reveal is earned — you wait and watch the image emerge, then it's gone. Multiple people have independently described it as "the most beautiful screensaver ever written."
- **Demand signals:** A 2025 Hacker News Show HN post (homage/remake) got significant attention. People still remember it vividly 30+ years later.
- **Implementation approach:** Iterative geometric growth with symmetry constraints. A deterministic algorithm that starts from a few seed points and applies expansion/refinement rules. Key detail: the deliberate pacing — the slow buildup is the point.

---

## 4. Modern & Artistic Screensavers

### XScreenSaver Collection (Jamie Zawinski, ongoing)
- **What it is:** The definitive open-source screensaver collection with 200+ savers. Everything from classic reimplementations to wild Shadertoy ports. Includes GLMatrix, Flurry, Atlantis (a 3D whale/dolphin underwater scene), BSOD (fake blue screens), WebCollage (collages from web images), and many more.
- **Why people love it:** Sheer variety. Something for every taste. JWZ's curatorial eye means the collection has personality. Recent versions pull in Shadertoy shaders.
- **Demand signals:** New releases get Hacker News front page. People specifically ask for XScreenSaver ports to other platforms.
- **Notable modules:** Atlantis (3D underwater with whale and dolphin), GLMatrix, Flurry, BSOD, WebCollage, Apple2 (emulated Apple II), BouncingCow, CCurse (ncurses-style terminal), Deluxe (Amiga bouncing ball tribute), Endgame (3D chess), Flow, Fluid (fluid dynamics sim), Geodesic, Hilbert, Interference, Jigsaw, Kaleidoscope, Lament (optical illusion), Moire, NoseGuy, Petal, Piecewise, Polyhedra, Pong, Rocks, Rubik, Slidescreen, Spotlight, Substrate, Tangram, Twang, Vfeedback, Voronoi, Wormhole, XAnalogTV, XMatrix, Zoom.

### Apple TV Aerial Screensavers
- **What it is:** Slow, cinematic drone flyovers of cities, landscapes, and underwater scenes. Shot in 4K HDR. Apple updates them periodically.
- **Why people love it:** Genuinely gorgeous. Makes any screen look like a window into somewhere beautiful. The underwater ones with jellyfish are especially popular.
- **Implementation approach:** This is video-based, which is outside the scope of generative screensavers — but the concept (slow pans over beautiful scenes) could inspire procedural landscapes.

### Wallpaper Engine (Steam) — Top Themes
- **What it does:** A Steam app that lets people create and share animated wallpapers. The most popular ones cluster around: anime scenes with particle effects, cyberpunk cityscapes with rain, minimalist audio visualizers, nature scenes with moving water/clouds, and pixel art loops.
- **Why this matters:** Shows what modern audiences actively choose (vs. what was pre-installed). Cyberpunk rain, audio-reactive visuals, and cozy loops dominate.

### Fluid Dynamics / Particle Simulations
- **What people want:** Cursor-interactive fluid simulations (like the classic "smoke under glass" demos), flowing particles that react to music, colorful ink-in-water effects.
- **Why:** Satisfying, beautiful, interactive. The WebGL fluid sim is a whole subgenre now.
- **Implementation approach:** Navier-Stokes fluid sim on GPU. Lightweight versions can use particle systems with curl noise.

### Vaporwave / Synthwave Aesthetic
- **What people want:** Neon grid sunsets, palm trees, chrome wireframes, glowing geometric shapes, 80s grid landscapes with a setting sun. Essentially "what if the 3D Maze screensaver had a neon makeover."
- **Why:** Huge cultural trend. The retro-computing aesthetic is now its own art movement.
- **Implementation approach:** Outrun-style grid landscape with a gradient sky (sun + stars simultaneously), optionally with a chrome/neon object cruising across the scene.

---

## 5. Recurring Request Themes

Based on patterns across hundreds of forum posts, these are the _kinds_ of screensavers people keep asking for:

### "I want a realistic aquarium"
- The most enduring request across decades. People want: real fish behavior, varied species, plant/coral environments, light effects, ambient bubbles. Started with After Dark Fish, peaked with Marine Aquarium 3, still actively requested. Right now idle-screens doesn't have an aquarium saver — this is a high-demand gap.

### "I want a rainy window / cozy atmosphere"
- Rain-on-glass, fireplace, snowy cabin window, coffee shop interior. The "cozy ambient" genre. Very popular on YouTube (10-hour rain videos). Crosses over with the lofi/chill aesthetic.

### "I want something that reacts to my music"
- Audio visualization (MilkDrop-style) is perennially popular. People want: waveforms, spectrum bars, particles that pulse to the beat. MilkDrop remains the gold standard.

### "I want the Matrix digital rain"
- Specifically the 3D perspective version (GLMatrix), not flat rain. The green katakana, the depth fog, the lead-character brightness.

### "I want my screen to look like a window into space"
- Starfields, nebula flythroughs, orbiting planets, solar system models. The Starfield screensaver but evolved — people want colorful nebulae, not just white dots.

### "I want something that slowly builds / evolves"
- Watching something grow (3D Pipes, Kaos, fractal trees, Conway's Game of Life, cellular automata). The satisfaction of watching a structure emerge from nothing.

### "I want something trippy"
- Psychedelic patterns, fractal zooms, color cycling, optical illusions. After Dark's Lunatic Fringe, Electric Sheep, and Winamp's MilkDrop are the reference points.

### "I want my own photos but animated"
- Slideshow savers are boring — people want photo slideshows with Ken Burns effects, smooth transitions, maybe particle overlays. Apple's tvOS aerial screensavers set a high bar.

### "I want a virtual pet"
- Boris the Cat, Bad Dog, Johnny Castaway — character-driven savers where something with personality lives on your screen. The Neko cat (chases cursor) is another example. People still love these.

---

## 6. What idle-screens Already Covers

Mapping the current `@idle-screens/savers-classic` collection against these community requests:

| Community Want | Already in idle-screens? | Notes |
|---|---|---|
| Flying Toasters | ✅ Yes | Good coverage |
| Starfield | ✅ Yes | Good coverage |
| 3D Maze | ❌ No | **High priority gap** |
| 3D Pipes | ❌ No | **High priority gap** |
| Mystify | ✅ Yes (as Bounce / Mystify-like) | Verify exact behavior |
| Matrix rain | ❌ No | **High demand** |
| Rain / cozy window | ❌ No | Medium demand |
| Aquarium | ❌ No | **High demand** |
| Flurry | ❌ No | Medium demand |
| Electric Sheep | ❌ No | High complexity, medium demand |
| Johnny Castaway | ❌ No | High complexity, cult demand |
| Boris / virtual pet | ❌ No | Medium demand |
| Warp / hyperspace tunnel | ✅ Yes (Warp saver) | |
| Fluid sim | ❌ No | Medium demand |
| Vaporwave / Outrun | ❌ No | Medium demand |
| Fractal / geometric | ❌ No | Medium demand |
| Fireplace / cozy | ❌ No | Low-medium demand |
| Audio visualizer | ❌ No | Medium demand |

---

## 7. Quick Wins vs. Moonshots

### Quick Wins (feasible in a few sessions each, high impact)

1. **3D Maze** — Raycasting is well-understood. The iconic brick maze with sky backdrop is essentially a fixed aesthetic. Could be done as a 2D canvas raycasting saver.

2. **Matrix Rain** — Green katakana columns with 3D perspective. The base effect is simple; depth fog and bloom are the polish.

3. **Rain on Window** — Particle rain + droplet trail system. Very achievable with canvas. Optional: add lightning flash, window frame silhouette, subtle thunder.

4. **Mystify polish** — If the existing "Bounce" saver doesn't have the multi-line ribbon edges and shape-morphing, those are small additions that make it recognizable.

### Medium Effort (worth planning)

5. **3D Pipes** — Procedural pipe generation + 3D rendering. Need a pipe-placement algorithm and surface rendering. Multiple joint types add complexity.

6. **Flurry-like** — Particle system + flow fields + bloom. WebGL-based. Could share rendering infrastructure with other particle-heavy savers.

7. **Aquarium** — 2D sprite-based version is achievable. 3D version with caustics and realistic fish behavior is a larger project.

8. **Vaporwave/Outrun** — Grid landscape + gradient sky + optional driving car. Very achievable on canvas, highly Instagrammable.

### Moonshots (build later, build reputation)

9. **Johnny Castaway clone** — Requires a large animation library, a time system, and a behavior state machine. Would be the flagship saver that gets press coverage.

10. **Electric Sheep-like** — Fractal flame rendering is mathematically intense. Could potentially pre-compute paths.

11. **Kaos** — The algorithm itself is the challenge — iterative geometric refinement rules that produce beautiful results. Close collaboration with reference material needed.

---

## Sources

- How-To Geek: "The 10 Best Classic Windows Screensavers, Ranked" (2025)
- Screensavers Planet: 37 Classic Screensavers collection + download counts
- Wikipedia: After Dark (software) — module list and history
- Gizmodo: "I Miss the Dreamy, Lo-Fi Mystery of the Windows 95 Maze Screensaver" (2021)
- Microsoft DevBlogs: "The origin story of the Windows 3D Pipes screen saver" (Raymond Chen, 2024)
- Digital Trends: "Pixel party like it's 1999 with the best screen savers from last millennium" (2017)
- Hacker News: Kaos homage thread (Feb 2025), XScreenSaver release threads (2025–2026)
- retrowave.com: "The Ultimate Guide To Windows 95 Screensavers" (2026), "Flying Toasters And Neon Nostalgia" (2026)
- BuzzFeed: "The Windows 98 Screensavers Ranked From Worst To Best" (2015)
- VOGONS forum: Screensaver identification/request threads (2011–present)
- FeldonCentral: Marine Aquarium fan forum — feature request threads (2000–2014)
- YouTube: "The History Of Nostalgic Screensavers" (Polygon Donut, 3M views, 2023)
- jwz.org: XScreenSaver release notes and screenshots
- GitHub: Modern Matrix Screensaver, Flurry JS ports, 3D Pipes web remakes