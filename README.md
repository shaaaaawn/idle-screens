# idle-screens

[![CI](https://img.shields.io/github/actions/workflow/status/shaaaaawn/idle-screens/ci.yml?branch=main&label=CI)](https://github.com/shaaaaawn/idle-screens/actions/workflows/ci.yml)
[![core](https://img.shields.io/npm/v/@idle-screens/core?label=core)](https://www.npmjs.com/package/@idle-screens/core)
[![saver-black-hole](https://img.shields.io/npm/v/@idle-screens/saver-black-hole?label=saver-black-hole)](https://www.npmjs.com/package/@idle-screens/saver-black-hole)
[![savers-classic](https://img.shields.io/npm/v/@idle-screens/savers-classic?label=savers-classic)](https://www.npmjs.com/package/@idle-screens/savers-classic)
[![schema](https://img.shields.io/npm/v/@idle-screens/schema?label=schema)](https://www.npmjs.com/package/@idle-screens/schema)
[![validator](https://img.shields.io/npm/v/@idle-screens/validator?label=validator)](https://www.npmjs.com/package/@idle-screens/validator)
[![capabilities](https://img.shields.io/npm/v/@idle-screens/capabilities?label=capabilities)](https://www.npmjs.com/package/@idle-screens/capabilities)

A framework-agnostic ambient-visual (screensaver) engine for the 2026 web.

`idle-screens` renders idle-time visuals as a capability-tiered, agent-operable
overlay. Its signature idea: a saver is a **seeded program** steered by a
**deterministic control track**, so the same program + seed + track produces
identical frames anywhere. Frames never cross the wire; only the program and its
control signals do.


## Architecture

```
                         +-----------------------+
                         |    @idle-screens/     |
                         |        core           |
                         |  engine, <idle-screen> |
                         |  element, RNG, control |
                         |  track, types          |
                         +----------+------------+
                                    |
              +---------------------+---------------------+
              |                     |                     |
   +----------v-----------+  +-----v-----------+  +------v----------+
   | @idle-screens/       |  | @idle-screens/  |  | @idle-screens/  |
   | saver-black-hole     |  | savers-classic  |  | schema          |
   | passthrough lensing  |  | 13 classic      |  | declarative     |
   | saver                |  | savers          |  | saver format    |
   +----------------------+  +-----------------+  +-----------------+

   +----------------------+  +-----------------+
   | @idle-screens/       |  | @idle-screens/  |
   | validator            |  | capabilities    |
   | WCAG flash + perf    |  | device tier +   |
   | gates                |  | eligibility     |
   +----------------------+  +-----------------+
        (standalone)             (standalone)

   +-------------------------------------------------------+
   |                    playground                          |
   |  Vite workbench (imports all 6, dev only)              |
   +-------------------------------------------------------+
```

**core** is the foundation. The three plugin/tooling packages (`saver-black-hole`,
`savers-classic`, `schema`) depend on it for types and the `SaverPlugin` contract.
**validator** and **capabilities** are standalone with zero dependencies, so they
can be used independently. The **playground** app imports everything for
development and testing.

## Packages

| Package | What |
| --- | --- |
| [`@idle-screens/core`](packages/core) | Engine + `<idle-screen>` custom element, idle detection, plugin registry, seeded RNG, control-track, types. |
| [`@idle-screens/saver-black-hole`](packages/saver-black-hole) | The signature passthrough saver: a gravitational-lensing black hole that roams and eats the live page. Seeded + paramSpace + control-track. |
| [`@idle-screens/savers-classic`](packages/savers-classic) | 13 classic savers (toasters, DVD, warp, fish, rain, globe, spotlight, and more) ported to framework-agnostic saver plugins. |
| [`@idle-screens/validator`](packages/validator) | Photosensitivity (WCAG 2.3.1 flash) + performance validation. Feed it luminance samples and frame times, get a pass/fail safety verdict. |
| [`@idle-screens/capabilities`](packages/capabilities) | Device and capability detection + saver eligibility tiering. Pure decide (Node-testable) + a thin browser detector. |
| [`@idle-screens/schema`](packages/schema) | Declarative, agent-authorable saver format. Validate a data spec, then compile it into a runnable, seeded, flash-safe SaverPlugin. |

### Apps

| App | What |
| --- | --- |
| [`playground`](apps/playground) | Vite dev workbench: saver palette, inline preview, determinism proof, safety/perf analysis, device capabilities, declarative schema editor. |

## Design docs

- **[`docs/specs/`](./docs/specs)** -- authoritative specifications: the [behavior contract](./docs/specs/behavior-contract.md) (97 requirements, all tested) and the [control-track](./docs/specs/control-track.md) data model.
- **[`docs/research/`](./docs/research)** -- original thinking: the [2026 vision](./docs/research/vision-2026.md) and the [architecture addendum](./docs/research/architecture-addendum.md) (speculative).

## Develop

```bash
corepack enable pnpm      # this repo pins pnpm 9 via packageManager
pnpm install
pnpm build                # tsup build all packages
pnpm typecheck
pnpm lint
pnpm test                 # vitest
pnpm dev                  # the Vite playground
pnpm test:e2e             # Playwright (incl. the determinism proof)
pnpm test:all             # build + typecheck + lint + test + e2e
```

## Attribution

Several classic savers are ports of screensavers originally from Berkeley Systems'
_After Dark_ series (1989-1998), via Bryan Braun's MIT-licensed
[after-dark-css](https://github.com/bryanbraun/after-dark-css). See
[CREDITS.md](./CREDITS.md) for full details.

## License

MIT
