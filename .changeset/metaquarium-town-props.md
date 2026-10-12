---
'@idle-screens/saver-metaquarium': minor
---

`townProps`: the small things a lived-in village has, as `kind[:count][/style], …`. Each is built from cubes on the fish's grid (one cube is two of a classic token's pixels), sized for fish.

- **fence**: a yard round every home, fitted to its shell, with a gate where its path leaves. The fence keeps off paths, the square, crystals, lamps and the next yard, and leaves a gap wherever something is in the way. Styles:
  - `driftwood`: weathered pickets and a rail;
  - `coral`: coral posts strung with sagging kelp rope;
  - `stone`: a low dry-stone wall;
  - `crystal`: slate posts capped with glowing crystals in the home's colour.
  
  With no style, each home takes the next one in turn.
- **mailbox**: one by every gate, beside the path, facing it.
  - `post`: its flag goes up when the mail comes;
  - `clam`: it opens;
  - `bottle`: it rocks on its cradle.
  
  Each is a vignette mark `mailbox1…`, so a fish sent there has come with the post.
- **bench[:n]** (shell, stone): round the fountain, the hub or the village green, facing in.
- **sock[:n]**: a striped current sock on a pole that swings round as the current turns.

The moving parts (flags, lids, bottles, socks) are one draw, turned in the vertex shader and closed-form in the scene clock. Fences and mailboxes need `geodeHomes`. An empty `townProps` leaves the world byte-identical.
