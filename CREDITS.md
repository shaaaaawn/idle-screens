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
| Messages (Out to Lunch) | After Dark "Messages" | Scrolling text; concept from Berkeley Systems. |
| Messages (Macintosh) | After Dark "Messages" | Corner-to-corner text variant; concept from Berkeley Systems. |
| Bouncing Ball | After Dark "Bouncing Ball" | CSS-animated ball; concept from Berkeley Systems. |
| Logo | After Dark | Bouncing logo mark; concept from Berkeley Systems. |
| Fade Out | After Dark "Fade Away" | Progressive pixel fade; concept from Berkeley Systems. |

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
| DVD Bouncing Logo | Inspired by the DVD player idle screen. Original implementation. |
| Warp | Starfield warp effect. Original canvas2d implementation. |
| Pipes | 3D pipe growth. Original canvas2d implementation. |
| BSOD | Blue screen of death. Original DOM/CSS implementation. |
| Flurry | Particle flurry. Original canvas2d implementation. |
| Snowfall | Snowfall particles. Original canvas2d implementation. |
| Fluid | Navier-Stokes fluid simulation. Original canvas2d + WebGPU compute implementation. |
| Reaction Diffusion | Gray-Scott reaction-diffusion. Original canvas2d + WebGPU compute implementation. Clean-room math — no code from external sources. |
