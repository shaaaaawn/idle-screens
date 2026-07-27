# Credits and Attribution

## After Dark screensavers

Several savers in `@idle-screens/savers-classic` are ports of screensavers
originally created by **Berkeley Systems** for the _After Dark_ series
(1989-1998). The HTML/CSS implementations this library ports from are by
**Bryan Braun** ([after-dark-css](https://github.com/bryanbraun/after-dark-css),
MIT license).

The following savers carry this lineage:

| Saver | Original | Notes |
| --- | --- | --- |
| Flying Toasters | After Dark (1989) | Toaster/toast GIF sprites are the original Berkeley Systems artwork, embedded as data URIs. 4-frame wing-flap via CSS background-position. |
| Fish Aquarium | After Dark "Fish!" (1990) | 9 PNG fish sprites + seafloor/bubbles are the original Berkeley Systems artwork, embedded as data URIs. |
| Spotlight | After Dark "Spotlight" | Passthrough canvas overlay; concept from Berkeley Systems. |
| Rainstorm | After Dark "Rainstorm" | Canvas2d raindrop/splash animation; concept from Berkeley Systems. |
| Hard Rain | After Dark "Hard Rain" | Dense rain variant; concept from Berkeley Systems. |
| Globe | After Dark "Globe" | Wireframe globe bounce; concept from Berkeley Systems. |
| Messages | After Dark "Messages" | Both classic behaviours ("Out to Lunch" marquee and the "Macintosh" corner-to-corner drift) consolidated into one modern canvas saver with typed params (`mode`, `phrase`, `speed`, `ink`, `glow`, `trail`); concepts from Berkeley Systems. |
| Bouncing Ball | After Dark "Bouncing Ball" | CSS-animated ball; concept from Berkeley Systems. |
| Bouncing Logo (`dvd`) | After Dark logo bounce + DVD player idle screen | Both bouncing-mark savers consolidated into one modern canvas saver (`mark` enum, analytic wall-hit hue steps, corner celebration). Generic marks only — no trademarked DVD logo. |
| Fade Out | After Dark "Fade Away" | Rebuilt as a deterministic canvas dissolve (seeded per-cell thresholds; dissolve/scan/blinds patterns); concept from Berkeley Systems. |

**Artwork copyright**: the embedded GIF/PNG sprite assets (toasters, fish) are
copyrighted by Berkeley Systems. They are included here under fair use for
nostalgic/educational purposes in this open-source screensaver engine. If you
are a rights holder and object to their inclusion, please open an issue.

**Code license**: the HTML/CSS implementations by Bryan Braun are MIT-licensed.
This library's ports are original TypeScript/canvas2d reimplementations, also MIT.

## Original savers

The following savers are original to this project:

| Saver | Notes |
| --- | --- |
| Black Hole | Passthrough gravitational-lensing saver. Original. |
| Tide | Passthrough water saver: a rising wave field whose analytic Jacobian is handed to each page block as a real affine transform, so live content shears and refracts rather than merely translating. Buoyant blocks raft on the surface; heavy ones sink out of focus. Original. |
| Limelight | Passthrough theatre-light saver. A roaming key light gives each page block a height, stands it off the page with parallax, and casts its silhouette across the stage — and blocks dim each other by standing in the way, so the content occludes itself. Original. |
| Catwalk | Passthrough cat saver. A silhouette cat parkours across the page's blocks on a seeded itinerary — perches dip and ring under its landings, sag while it sits, and it naps on the ones it likes. Original. |
| Slipstream | Passthrough wind saver: the page's blocks are obstacles in an analytic potential-flow field — streamlines thread between the content and part around it, and blocks lean with the local deflected wind, hinged at their base like grass. The page is the boundary condition. Original. |
| Warp | Starfield warp effect. Original canvas2d implementation. |
| Pipes | 3D pipe growth. Original canvas2d implementation. |
| BSOD | Blue screen of death. Original DOM/CSS implementation. |
| Flurry | Particle flurry. Original canvas2d implementation. |
| Snowfall | Snowfall particles. Original, authored as a declarative `SaverSpec` and compiled by `@idle-screens/schema`. |
| Night Lanterns | Yi Peng festival lantern sky. Original, authored as a declarative `SaverSpec` and compiled by `@idle-screens/schema`. |
| Sakura Drift | Cherry blossom petals. Original, authored as a declarative `SaverSpec` and compiled by `@idle-screens/schema`. |
| Dev Dashboard | Developer dashboard. Original, authored as a declarative `SaverSpec` and compiled by `@idle-screens/schema`. |
| Orrery | Solar system orrery. Original, authored as a declarative `SaverSpec` and compiled by `@idle-screens/schema`. |
| Constellation | Star constellation map. Original, authored as a declarative `SaverSpec` and compiled by `@idle-screens/schema`. |
| Comet Shower | Comet trails. Original, authored as a declarative `SaverSpec` and compiled by `@idle-screens/schema`. |
| Aurora | Aurora borealis curtains. Original, authored as a declarative `SaverSpec` and compiled by `@idle-screens/schema`. |
| Warp Tunnel | Hyperspace warp tunnel. Original, authored as a declarative `SaverSpec` and compiled by `@idle-screens/schema`. |
| Polygons | Drifting polygon shapes. Original, authored as a declarative `SaverSpec` and compiled by `@idle-screens/schema`. |
| Matrix Rain | Matrix-style falling code. Original, authored as a declarative `SaverSpec` and compiled by `@idle-screens/schema`. |
| Night Procession | Festival lantern procession. Original, authored as a declarative `SaverSpec` and compiled by `@idle-screens/schema`. |
| Fluid | Navier-Stokes fluid simulation. Original canvas2d + WebGPU compute implementation. |
| Reaction Diffusion | Gray-Scott reaction-diffusion. Original canvas2d + WebGPU compute implementation. Clean-room math — no code from external sources. |
| Mystify | Bouncing morphing polygon trails. Original canvas2d implementation. Inspired by the Windows XP "Mystify" screensaver concept (clean-room). |
