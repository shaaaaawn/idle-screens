# idle-screens

```text
 +----------------------------------------------------------+
 |  .         *            .             .            z     |
 |       .          \\\\   ________   ////     .       z    |
 |   *               \\\\ |  ====  | ////            .  Z   |
 |         .          \\\|________|///    .                 |
 |  .          *          '-'    '-'            .   .--.    |
 |       .          .           *       .           |__|    |
 |   *        .            .                 .        *     |
 +----------------------------------------------------------+
              \________________________________/
                   i d l e - s c r e e n s
```

[![CI](https://img.shields.io/github/actions/workflow/status/shaaaaawn/idle-screens/ci.yml?branch=main&label=CI)](https://github.com/shaaaaawn/idle-screens/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@idle-screens/core?label=%40idle-screens%2Fcore)](https://www.npmjs.com/package/@idle-screens/core)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

A screensaver engine for the web. Drop one custom element on a page and,
after a minute of nobody touching anything, the page goes to sleep and
something nice happens on it: a starfield, a fish tank, a black hole that
eats your layout.

A saver here is a seeded program steered by a control track. The same
program, seed and track give the same frames on every screen, so frames
never cross the wire; only the program and its control signals do. Savers
come in two kinds:

- plugins written in TypeScript (the classics, the passthrough savers that
  play with the live page, a three.js aquarium), and
- SaverSpecs: JSON scenes with no code in them, which the schema package
  validates and compiles into a plugin. They are built to be accepted
  from strangers and from AI agents, and they are flash-safe by
  construction.

[idlescreens.com](https://idlescreens.com) runs on these packages. Its
channels are live scenes, published and steered by people and AI agents,
that any screen can open full-screen.

## How the pieces fit

```text
  scene.json  (a SaverSpec: plain data, no code)
       |
       v
  +----------------------------+     +-------------------------+
  | @idle-screens/schema       |---->| @idle-screens/validator |
  | validateSpec, compileSaver |<----| WCAG 2.3.1 flash + perf |
  +-------------+--------------+     +-------------------------+
                |
                | SaverPlugin        savers-classic, saver-*
                |                    (plugins written in code)
                v                             |
  +----------------------------------+        |
  | @idle-screens/core               |<-------+
  | engine, <idle-screen> element,   |
  | idle timer, seeded RNG, control  |<-- @idle-screens/capabilities
  | track, OffscreenCanvas worker    |    (what this device can run)
  +----------------+-----------------+
                   |
     +-------------+-------------+------------------+
     v             v             v                  v
  your page    playground   idlescreens.com   mac + linux apps
               (pnpm dev)   (from npm)        (bundled engine)
                                 |
                                 v
                    live channels on any screen: a browser,
                    iPhone, iPad, Apple TV, the mac + linux apps
```

`core` is the foundation; every saver package and `schema` take it as a
peer dependency. `schema` uses `validator` for its flash checks.
`validator` and `capabilities` have no dependencies and work on their own,
in a browser or in Node.

## Quick start

```bash
npm install @idle-screens/core @idle-screens/schema @idle-screens/savers-classic
```

```js
import { defineIdleScreen } from '@idle-screens/core';
import { compileSaver } from '@idle-screens/schema';
import { CLASSIC_SAVERS } from '@idle-screens/savers-classic';

// A SaverSpec: a background plus layers of moving sprites. Data, not code.
const fireflies = compileSaver({
  schemaVersion: 1,
  id: 'fireflies',
  label: 'Fireflies',
  background: {
    type: 'gradient',
    stops: [
      { at: 0, color: '#0b1026' },
      { at: 1, color: '#2a1f3d' },
    ],
  },
  layers: [
    {
      count: 70,
      sprite: { kind: 'circle', radius: [0.003, 0.009], color: '#ffd98a' },
      alpha: [0.4, 0.9],
      blend: 'lighter',
      pulse: { amp: 0.3, period: 3000 },
      motion: { type: 'wander', speed: [0.004, 0.012], meander: 0.012 },
    },
  ],
});

defineIdleScreen(); // registers <idle-screen>

const screen = document.createElement('idle-screen');
screen.plugins = [fireflies, ...CLASSIC_SAVERS];
screen.config = { timeoutMs: 60_000, defaultPluginId: 'fireflies' };
document.body.append(screen);
```

The element starts once it has both `plugins` and `config`. It sleeps after
`timeoutMs` without input and wakes on the next key press, mouse move or
touch. Cmd+K or Ctrl+K opens the built-in saver picker.

Sizes and speeds in a spec are fractions of the screen's shorter side, so
`radius: 0.005` is about 5 px on a 1080p display. `compileSaver` throws on an
invalid spec, and the safety floors are not negotiable. Try
`pulse: { period: 200 }` and you get:

```
layers[0].pulse.period: must be >= 500 ms (flash-safety floor)
```

Call `validateSpec(spec)` first if you would rather get the errors back as
data. The full format, with every sprite kind and motion type, the
timeline, sequences and the perception API, is in
[`packages/schema/FORMAT.md`](packages/schema/FORMAT.md). There is also a
JSON Schema at
[`packages/schema/saver-spec.schema.json`](packages/schema/saver-spec.schema.json),
importable as `@idle-screens/schema/saver-spec.schema.json`.

## Packages

Everything under [`packages/`](packages) is published to npm under the
`@idle-screens` scope.

| Package | npm | What it is |
| --- | --- | --- |
| [`@idle-screens/core`](packages/core) | [![npm](https://img.shields.io/npm/v/@idle-screens/core?label=)](https://www.npmjs.com/package/@idle-screens/core) | The engine and the `<idle-screen>` custom element: idle detection, plugin registry, seeded RNG, control tracks, Web Worker rendering. |
| [`@idle-screens/schema`](packages/schema) | [![npm](https://img.shields.io/npm/v/@idle-screens/schema?label=)](https://www.npmjs.com/package/@idle-screens/schema) | The SaverSpec format: `validateSpec`, `compileSaver`, sequences, and the perception API (`perceiveScene`) that describes a frame in text. |
| [`@idle-screens/validator`](packages/validator) | [![npm](https://img.shields.io/npm/v/@idle-screens/validator?label=)](https://www.npmjs.com/package/@idle-screens/validator) | Pure photosensitivity (WCAG 2.3.1 flash) and frame-time analysis. Feed it luminance samples, get a pass or fail. |
| [`@idle-screens/capabilities`](packages/capabilities) | [![npm](https://img.shields.io/npm/v/@idle-screens/capabilities?label=)](https://www.npmjs.com/package/@idle-screens/capabilities) | Device and capability detection, plus saver eligibility tiering. The deciding half runs in Node; the detector is a thin browser shim. |
| [`@idle-screens/savers-classic`](packages/savers-classic) | [![npm](https://img.shields.io/npm/v/@idle-screens/savers-classic?label=)](https://www.npmjs.com/package/@idle-screens/savers-classic) | The classics, rebuilt as plugins: flying toasters, DVD, warp, mystify, flurry, pipes, BSOD, fish, rain, globe and more. |
| [`@idle-screens/saver-black-hole`](packages/saver-black-hole) | [![npm](https://img.shields.io/npm/v/@idle-screens/saver-black-hole?label=)](https://www.npmjs.com/package/@idle-screens/saver-black-hole) | Passthrough. A black hole roams the live page and lenses, then eats, its content. |
| [`@idle-screens/saver-tide`](packages/saver-tide) | [![npm](https://img.shields.io/npm/v/@idle-screens/saver-tide?label=)](https://www.npmjs.com/package/@idle-screens/saver-tide) | Passthrough. Water rises over the page; light blocks float and raft, heavy ones sink. |
| [`@idle-screens/saver-limelight`](packages/saver-limelight) | [![npm](https://img.shields.io/npm/v/@idle-screens/saver-limelight?label=)](https://www.npmjs.com/package/@idle-screens/saver-limelight) | Passthrough. A roaming key light lifts page blocks into set pieces that cast shadows on each other. |
| [`@idle-screens/saver-slipstream`](packages/saver-slipstream) | [![npm](https://img.shields.io/npm/v/@idle-screens/saver-slipstream?label=)](https://www.npmjs.com/package/@idle-screens/saver-slipstream) | Passthrough. Page blocks become obstacles in a potential-flow wind field, and lean as it passes. |
| [`@idle-screens/saver-catwalk`](packages/saver-catwalk) | [![npm](https://img.shields.io/npm/v/@idle-screens/saver-catwalk?label=)](https://www.npmjs.com/package/@idle-screens/saver-catwalk) | Passthrough. A silhouette cat parkours across the page's own blocks and naps on the warm ones. |
| [`@idle-screens/saver-metaquarium`](packages/saver-metaquarium) | [![npm](https://img.shields.io/npm/v/@idle-screens/saver-metaquarium?label=)](https://www.npmjs.com/package/@idle-screens/saver-metaquarium) | A three.js fish tank: skinned GLB fish on seeded swim paths, rooms, mixed schools and a steerable camera. |

"Passthrough" savers draw over the page instead of hiding it, and treat the
page's own blocks as props.

```text
  .------------------------------------.  <- so close.
  | [DVD]\        /\        /\        /|
  |       \      /  \      /  \      / |
  |        \    /    \    /    \    /  |
  |         \  /      \  /      \  /   |
  |          \/        \/        \/    |
  '------------------------------------'
```

## Apps

| App | What it is |
| --- | --- |
| [`apps/playground`](apps/playground) | The Vite workbench: a gallery of every saver, full-screen preview, a keyframe timeline editor, the determinism proof, flash and perf analysis, capability tiering, a SaverSpec editor and text-readable frame perception. Run it with `pnpm dev`, or open the [hosted copy](https://shaaaaawn.github.io/idle-screens/). |
| [`apps/mac`](apps/mac) | A menu-bar app for macOS 13+ (Swift, universal binary). One overlay per display, running the bundled engine offline or an idlescreens.com channel. No release has been cut yet; [build it from source](apps/mac/README.md). |
| [`apps/ios`](apps/ios) | One XcodeGen project with two apps. On iPhone and iPad you browse channels, watch them and steer the ones you own. On Apple TV, scenes are drawn natively, with no web view, at a quality matched to the box. See [apps/ios/README.md](apps/ios/README.md). |
| [`apps/linux`](apps/linux) | A Wayland overlay in Rust, GTK 4 and WebKitGTK 6, for x86_64 and aarch64 (Raspberry Pi OS included). It needs a compositor with wlr-layer-shell: sway, Hyprland, labwc, river, wayfire and KDE Plasma work; GNOME and X11 do not. No release has been cut yet; [build it from source](apps/linux/README.md). |

## Develop

You need Node 22 or newer. The repo pins pnpm 9 through `packageManager`.

```bash
corepack enable pnpm
pnpm install
pnpm build            # build every package; do this first
pnpm typecheck
pnpm lint
pnpm test             # vitest
pnpm test:coverage    # vitest with coverage thresholds, which is what CI runs
pnpm dev              # the playground on localhost:5177 (PLAYGROUND_PORT overrides)
pnpm test:e2e         # Playwright, including the determinism proof
```

Run `pnpm build` before `pnpm typecheck` on a clean checkout. The packages
typecheck against each other's emitted `dist/*.d.ts`, so those files have to
exist first.

The native apps build outside the pnpm workspace. Their READMEs cover the
toolchains: Xcode and XcodeGen for [`apps/ios`](apps/ios/README.md), Swift
for [`apps/mac`](apps/mac/README.md), and cargo plus a dependency check
script for [`apps/linux`](apps/linux/README.md).

## Contributing and releases

Day-to-day work goes to `develop` through pull requests. `main` is the
release branch: every push to it runs the release workflow.

Releases use [changesets](https://github.com/changesets/changesets). If a
change affects what an npm consumer gets, add a changeset with
`pnpm changeset` (or write a `.changeset/*.md` file by hand). When it reaches
`main`, the release workflow bumps versions, writes changelogs and publishes
to npm. Docs, tests, CI and app-only changes do not need one.

While `@idle-screens/core` is below 1.0, its changesets should be `patch`.
A `minor` on a 0.x package counts as breaking for everything that depends on
it, so it would force a major bump on every saver package.

Two rules for saver code: take all randomness from the seeded `Rng` in the
saver's context (never `Math.random()`), and keep frames a function of time
and seed. Those two rules are what make the determinism proof pass.

## More docs

- [`packages/schema/FORMAT.md`](packages/schema/FORMAT.md): the SaverSpec format reference.
- [`THREAT-MODEL.md`](THREAT-MODEL.md): what the engine trusts, what it does not, and why a SaverSpec cannot run code.
- [`docs/`](docs/README.md): design notes, roadmaps and specs. [`docs/research/`](docs/research) is the original thinking behind the project, kept as history rather than guidance.
- [`docs/ios-release.md`](docs/ios-release.md): the TestFlight and App Store runbook for the Apple apps.

## Attribution

Several classic savers are ports of screensavers from Berkeley Systems'
_After Dark_ series (1989-1998), by way of Bryan Braun's MIT-licensed
[after-dark-css](https://github.com/bryanbraun/after-dark-css). See
[CREDITS.md](CREDITS.md) for the details.

## License

[MIT](LICENSE)
