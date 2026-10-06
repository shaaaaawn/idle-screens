# Aesthetic brief seeds — consumer aesthetics as saver briefs

Companion to [saver-art-ideas.md](saver-art-ideas.md), which holds fine-art
briefs. This one holds **consumer** aesthetics: the design languages of malls,
software, packaging and daytime television rather than of galleries.

Same contract as its companion. Each brief is self-contained and can be handed
to an agent to expand into a full SaverSpec: one idea, a restricted palette,
motion that serves the mood. What differs is the material.

## Source and credit

The taxonomy comes from the **Consumer Aesthetics Research Institute**
(<https://cari.institute/aesthetics>), a research project that identifies,
names and documents these aesthetics. Several of the names below are CARI
coinages — *Frutiger Aero* was named by Froyo Tam and Sofi Xian — and the
catalogue records a "Name Coiner" per aesthetic wherever one is known. Using a
coined name is citing specific people's research, not borrowing a generic
label, so credit CARI wherever these briefs are surfaced.

**Use it as inspiration and analysis, never as assets.** That is the use CARI
names as intended, and it is the only use this pipeline can make: a SaverSpec
contains no images at all — it is a background plus layers of moving sprites,
compiled by a seeded renderer — so no artifact from their galleries can be
embedded even by accident. Do not download, embed, or extract palettes from
their gallery images; those are third-party works CARI does not own and cannot
license. Write our own reading of an aesthetic, never a restatement of their
page. If a brief cannot be written without paraphrasing them, it is not ready.

## Why these and not more painters

The fifteen artist studies in the evals suite
(`apps/playground/src/evals/artists.ts`, credited in its `ACCREDITATION.md` —
fifteen profiles, fifteen rows) are well-trodden ground: every frontier model has a
strong prior for "Impressionism", so a high score cannot distinguish reading
the DNA from recognising the name. These sit further out. *Utopian Scholastic*
and *Hipness Purgatory* are precise and documented, so a brief can be checked
against something — but the priors are far weaker than for Cubism, which makes
them a more honest test of whether a spec format can carry a described style.

They also fit the room. These are aesthetics of environments — kiosk graphics,
software chrome, hold music made visible — which is where a channel actually
plays.

## Briefs

Written in the house style of `saver-art-ideas.md`. Numbering continues from
that file's ten, so a brief has one id across both.

Title each brief with **CARI's own spelling**, exactly as the worklist below
records it — `Memphis-Milano`, not `Memphis Milano`. The point of this file is
to cite their research accurately, and a silently normalised name is a small
way of failing at that.

### 11. Frutiger Aero — the optimism of a 2007 desktop
Water, glass and grass, lit from behind. Vivid aqua-to-lime gradient ground;
large soft translucent circles drifting slowly upward with `blend: lighter` —
bubbles that never quite pop; a horizontal band of brighter green low in the
frame (the grass every wallpaper had); small hard white specks with short
trails rising through the bubbles like aeration; one wide pale halo breathing
on a 12s cycle for the lens flare. Everything glossy, nothing sharp. Palette:
`#3fc7f4`, `#8fe36a`, `#e8fbff`, `#0a7ea8`. Calm, high alpha, no dark corners.

### 12. Global Village Coffeehouse — woodcut jazz
The mid-90s café: hand-carved warmth on a corporate budget. Warm oatmeal
ground, no gradient; scattered `polygon` marks in burnt sienna, olive and deep
teal at low count and large size — leaves, suns, spirals reduced to facets;
tapered `stroke` squiggles curling slowly between them like linocut gouges;
everything rotating a few degrees per minute, never spinning. Flat opaque
colour, hard edges, no glow anywhere. Palette: `#e8dcc0`, `#a8442a`,
`#5c7a3f`, `#2b5f66`.

### 13. Memphis-Milano — the grid refuses to behave
Postmodern furniture as motion. Bone-white ground; `rect` sprites in flat
primary red, cobalt and canary drifting at deliberately unrelated speeds and
angles; squiggle `stroke` marks in black doing the same; a scatter of small
black dots as the terrazzo confetti. No two layers share a tempo — the
disagreement is the aesthetic. Hard edges, alpha 1, no blending. Palette:
`#f2efe6`, `#e4322b`, `#1c63b8`, `#f2c230`, `#111`.

### 14. Cassette Futurism — the future with buttons on it
Space travel imagined on cathode tubes. Near-black ground with a faint warm
scanline wash; a `layout: table` grid of small amber `bar` sprites at low
alpha, values shifting slowly like a readout nobody is watching; two or three
brighter amber rectangles pulsing on long periods as status lamps; a thin
phosphor-green `stroke` tracing a slow horizontal sweep. Everything monospaced
in feel, nothing anti-aliased in spirit. Palette: `#0d0b08`, `#ffb000`,
`#33ff66`, `#5a4a2a`.

### 15. Whimsigothic — spirals, moons and dusty velvet
The late-90s bookstore mystic aisle. Deep aubergine gradient ground; large
soft circles in dusty violet and sage drifting on slow wander; `stroke` spirals
with `taper` curling outward at several scales, alpha 0.4, rotating a few
degrees per minute; a scatter of tiny pale stars, static, at alpha 0.15; one
crescent — a `polygon` with a dark disc painted over it — hanging still. Slow,
soft, unembarrassed. Palette: `#2e1b3a`, `#8f7fa8`, `#9fb08a`, `#e8e2d0`.

### 16. Utopian Scholastic — the future they promised a classroom
Educational optimism, airbrushed. Cool cyan-to-white gradient; a wide
perspective grid implied by evenly spaced horizontal `stroke` lines fading
toward a vanishing band; simple `polygon` solids — a cone, a torus read as a
ring — drifting slowly above it with flat shading and hard rims; small bright
specks travelling the grid lines left to right at a steady clip. Confident,
diagrammatic, no atmosphere. Palette: `#d9f2ff`, `#2a6fb5`, `#f25c2a`,
`#ffffff`.

### 17. Corporate Memphis — the flat people, without the people
Bold gradients and impossible limbs, reduced to its geometry. Off-white ground;
a few very large `polygon` shapes in muted coral, sage and periwinkle,
overlapping at flat opacity so overlaps read as a third colour by layer order
rather than by blending; slow drift, almost imperceptible rotation; no
outlines, no shadows, no texture at all. The brief is restraint: five shapes,
four colours, one tempo. Palette: `#faf7f2`, `#e8836b`, `#7fa87f`, `#8b93d4`.

### 18. Laser Grid — the horizon that never arrives
One idea, held. Black ground; a magenta-to-cyan gradient band low in the frame;
evenly spaced horizontal `stroke` lines compressing toward that band, scrolling
downward on a loop so the grid appears to travel forever; a single large soft
disc sitting on the horizon at alpha 0.5; nothing else. The discipline is
refusing to add a second idea. Palette: `#000000`, `#ff2fb9`, `#2fe0ff`,
`#1a0033`.

## The worklist

All **90** aesthetics CARI catalogues, with the eras they record. The eight
above are written; the rest are unclaimed.

A note on honesty: name, era and decade are CARI's own metadata — facts, taken
from their public API. There is no gist column, because writing one for each
without reading its page would be inventing a description of somebody's
research, and that is the one thing this file must not do. Read the page, form
your own visual reading, then write the brief.

Two traps worth knowing before you start:

- **Take slugs from this table, never guess them.** `/aesthetics/vaporwave`
  answers 200 with an empty shell — there is no Vaporwave entry, even though
  CARI's own FAQ discusses Vaporwave. What the catalogue actually holds is
  *Corporate Vaporwave*.
- **There is no colour field.** Palette information exists only as prose inside
  a description, so a palette is something you read and decide, not something
  you can extract. Which suits us: the gallery images are off limits as an
  input anyway.

Where the numbers come from: `GET /api/aesthetics?page=0..4`, undocumented but
open, 20 per page and `size` is ignored, `totalElements: 90`. `sitemap.xml`
agrees at 90 unique slugs (it lists 180 aesthetic URLs, each one twice — 180 is
not a count of entries). The `/aesthetics` index itself is client-rendered and
carries no aesthetic links in its HTML. Read 2026-09-08.

By decade: 1970s 10 · 1980s 17 · 1990s 23 · 2000s 16 · 2010s 20 · timeless 4.

| Aesthetic | Era | Decade | CARI slug |
| --- | --- | --- | --- |
| Acidgrafix | Mid 2010s – Current | 2010s | `acidgrafix` |
| Airbrush Surrealism | Late 1960s – Mid 1980s | 1970s | `airbrush-surrealism` |
| Austurbane | Late 2010s – Current | 2010s | `austurbane` |
| Blob World | Mid 2010s – Current | 2010s | `blob-world` |
| Boho-Chic | Early 2010s – Current | 2010s | `boho-chic` |
| Bubblegum Bling | Late 2010s – Current | 2010s | `bubblegum-bling` |
| Cassette Futurism | Mid 1970s – Late 1980s | 1980s | `cassette-futurism` |
| Contempo Eclectic | Mid 1980s – Mid 1990s | 1980s | `contempo-eclectic` |
| Corporate Cyberspace | Early 1990s – Late 1990s | 1990s | `corporate-cyberspace` |
| Corporate Grunge | Late 1980s – Mid 1990s | 1990s | `corporate-grunge` |
| Corporate Hippie | Late 1960s – Mid 1970s | 1970s | `corporate-hippie` |
| Corporate Memphis | Mid 2010s – Current | 2010s | `corporate-memphis` |
| Corporate Scene | Late 1990s – Early 2010s | 2000s | `corporate-scene` |
| Corporate Synthwave | Early 2010s – Current | 2010s | `corporate-synthwave` |
| Corporate Vaporwave | Early 2010s – Late 2010s | 2010s | `corporate-vaporwave` |
| Curly Girly | Late 1990s – Mid 2000s | 2000s | `curly-girly` |
| Cyberbougie | Late 2010s – Current | 2010s | `cyberbougie` |
| Cyberdelia | Late 1980s – Mid 1990s | 1990s | `cyberdelia` |
| Deco-Luxe | Early 1980s – Late 1980s | 1980s | `deco-luxe` |
| Decoplex | Early 1990s – Current | 1990s | `decoplex` |
| Diner Kitsch | Mid 1970s – Early 1990s | 1970s | `diner-kitsch` |
| Disco Deco | Mid 1960s – Late 1970s | 1970s | `disco-deco` |
| Dollar Store Vernacular | Late 1960s – Current | Timeless | `dollar-store-vernacular` |
| Early Cyber | Late 1980s – Early 1990s | 1980s | `early-cyber` |
| Eco-Beige | Late 1980s – Mid 1990s | 1990s | `eco-beige` |
| Electroclash | Late 1990s – Early 2000s | 2000s | `electroclash` |
| Factory Pomo | Late 1980s – Early 1990s | 1980s | `factory-pomo` |
| Festival Marketplace | Early 1980s – Early 1990s | 1980s | `festival-marketplace` |
| Four Colors | Mid 2000s – Current | Timeless | `four-colors` |
| Frasurbane | Late 1980s – Mid 1990s | 1990s | `frasurbane` |
| Frutiger Aero | Mid 2000s – Early 2010s | 2000s | `frutiger-aero` |
| Gay Nineties Revival | Late 1960s – Late 1970s | 1970s | `gay-nineties-revival` |
| Gen X Soft Club | Early 1990s – Mid 2000s | 1990s | `gen-x-soft-club` |
| Gen-X Home | Late 1990s – Early 2000s | 1990s | `gen-x-home` |
| Genericana | Mid 1980s – Early 2010s | 2010s | `genericana` |
| Global Village Coffeehouse | Late 1980s – Mid 1990s | 1990s | `global-village-coffeehouse` |
| Googie Kitsch | Late 1970s – Early 2000s | 1980s | `googie-kitsch` |
| Graffiti Pop | Early 1980s – Mid 1990s | 1980s | `graffiti-pop` |
| Groovival | Late 1980s – Early 2000s | 1990s | `groovival` |
| Hexatron | Early 2010s – Late 2010s | 2010s | `hexatron` |
| Hipness Purgatory | Early 2000s – Early 2010s | 2000s | `hipness-purgatory` |
| Indie Sleaze | Early 2000s – Early 2010s | 2000s | `indie-sleaze` |
| Indiecraft | Mid 2000s – Mid 2010s | 2000s | `indiecraft` |
| Industrial Americana | Early 1990s – Mid 1990s | 1990s | `industrial-americana` |
| Industrial Gothic | Late 1970s – Late 1990s | 1980s | `industrial-gothic` |
| Internet Awesomesauce | Late 2000s – Mid 2010s | 2010s | `internet-awesomesauce` |
| Jumbled Font | Mid 1980s – Mid 1990s | Timeless | `jumbled-font` |
| Laser Grid | Early 1980s – Late 1980s | 1980s | `laser-grid` |
| Live Laugh Love | Early 2010s – Current | 2010s | `live-laugh-love` |
| McBling | Early 2000s – Late 2000s | 2000s | `mcbling` |
| Memphis Jr. | Late 1980s – Early 1990s | 1990s | `memphis-jr` |
| Memphis-Milano | Early 1980s – Early 1990s | 1980s | `memphis-milano` |
| Metalheart | Late 1990s – Mid 2000s | 2000s | `metalheart` |
| Mid Century Medieval | Mid 1950s – Mid 1970s | 1970s | `mid-century-medieval` |
| Millennium Disco | Late 1990s – Early 2000s | 2000s | `millennium-disco` |
| Mission School | Mid 1990s – Early 2000s | 1990s | `mission-school` |
| Neo-Vectorheart | Late 2010s – Current | 2010s | `neo-vectorheart` |
| Neo-Y2K | Late 2010s – Current | 2010s | `neo-y2k` |
| Neoclassical Pomo | Late 1970s – Early 1990s | 1980s | `neoclassical-pomo` |
| Neon Ooze | Late 1980s – Early 1990s | 1990s | `neon-ooze` |
| New Wave Tropical | Late 1970s – Mid 1990s | 1980s | `new-wave-tropical` |
| Nouveau Organic | Late 1980s – Mid 1990s | 1990s | `nouveau-organic` |
| Nu-Brutalism | Early 2010s – Current | 2010s | `nu-brutalism` |
| Pacific Punk Wave | Mid 1970s – Early 1980s | 1970s | `pacific-punk-wave` |
| Paperback Chic | Late 2010s – Current | 2010s | `paperback-chic` |
| Pastel Southwestern | Early 1980s – Mid 1990s | 1980s | `pastel-southwestern` |
| Pixelscape | Early 2000s – Mid 2000s | 2000s | `pixelscape` |
| Polychrome | Early 2010s – Current | 2010s | `polychrome` |
| Pomo Faux Ruins | Late 1970s – Late 1980s | 1980s | `pomo-faux-ruins` |
| Preschool Pop | Early 1990s – Early 2000s | 1990s | `preschool-pop` |
| Pulp Fantasy | Early 1960s – Mid 1980s | 1970s | `pulp-fantasy` |
| Rad Dog / Neon Surf | Late 1980s – Early 1990s | 1990s | `rad-dog-neon-surf` |
| Radical Surrealism | Late 1960s – Early 1980s | 1970s | `radical-surrealism` |
| Renaissance Revival | Early 1990s – Late 1990s | 1990s | `renaissance-revival` |
| Silicon Dreams | Late 1980s – Late 1990s | 1980s | `silicon-dreams` |
| Soft Colonial Wanderlust | Late 1980s – Mid 2010s | 2000s | `soft-colonial-wanderlust` |
| Sportsbrut | Late 2010s – Current | 2010s | `sportsbrut` |
| Superflat Pop | Late 2000s – Early 2010s | 2000s | `superflat-pop` |
| Supergraphic Ultramodern | Late 1960s – Late 1970s | 1970s | `supergraphic-ultramodern` |
| Themed Spaces | Early 1990s – Early 2000s | Timeless | `themed-spaces` |
| Ultramodern Revival | Late 1990s – Mid 2000s | 2000s | `ultramodern-revival` |
| Urban Grunge | Early 2000s – Late 2000s | 2000s | `urban-grunge` |
| Utopian Scholastic | Late 1980s – Late 1990s | 1990s | `utopian-scholastic` |
| Vector Minimalism | Early 2010s – Late 2010s | 2010s | `vector-minimalism` |
| Vectorheart | Late 1990s – Mid 2000s | 2000s | `vectorheart` |
| Wacky Pomo | Early 1990s – Early 2000s | 1990s | `wacky-pomo` |
| Whimsicraft | Mid 1980s – Mid 1990s | 1980s | `whimsicraft` |
| Whimsigothic | Late 1980s – Late 1990s | 1990s | `whimsigothic` |
| Y2K Aesthetic | Early 1990s – Late 1990s | 1990s | `y2k-aesthetic` |
| Zen-X | Early 1990s – Early 2000s | 1990s | `zen-x` |
