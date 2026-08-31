import { test, expect, type Page } from '@playwright/test';

/**
 * Conformance: the analytic perception vs the real canvas.
 *
 * Every agent that authors a scene judges it on `perceiveScene` numbers, and
 * until this file nothing checked the claim those numbers rest on — that the
 * model describes the pixels a viewer sees. It is an assertion about two
 * independent implementations agreeing, and the project has already shipped a
 * bug of exactly that shape (idle-server's `preview-svg` oriented every streak
 * by spin instead of heading, so warp previewed as horizontal lines while
 * perception showed the true starburst).
 *
 * `docs/cloudflare-render-and-assets.md` §1c proposed this test on top of
 * Cloudflare Browser Run. It does not need one: Playwright already gives a real
 * Chromium, `compileSaver` gives the real engine, and the two grids are both
 * 80x48 with the same coverage epsilon by construction.
 *
 * ## Measured baseline (1280x800, t=5000, seeds 42 and 7)
 *
 * | fixture | cell | row | col | centroid | coverage ratio |
 * | --- | --- | --- | --- | --- | --- |
 * | radial streaks | .83–.89 | .90–.97 | .94–.95 | <.010 | 0.99–1.02 |
 * | soft discs | .98 | .99 | .99 | <.008 | 0.71–0.74 |
 * | hard discs | .85–.86 | .94–.96 | .97 | <.012 | 0.99–1.00 |
 * | rings on a gradient | .67–.73 | .93–.95 | .95–.98 | <.008 | 1.38–1.45 |
 * | hard rects | .83–.88 | .92–.93 | .90–.95 | <.013 | 0.92–0.94 |
 * | additive glow | .65–.67 | .87–.90 | .83–.88 | <.016 | **0.26** |
 *
 * Read that last column: structure agrees everywhere, but the model's idea of
 * how much is LIT is off by up to 4x on additive glow — `GLOW_SPREAD` in
 * `packages/schema/src/perceive.ts` is documented as "tuned by intuition rather
 * than measurement", and this is the measurement (`future-ideas.md` G1). The
 * thresholds below are floors under the measured values, not aspirations.
 * Tighten them as the model is calibrated; never loosen one to make a red run
 * green without naming which spec feature moved.
 *
 * Fixtures deliberately declare NO `seed` — see the precedence test at the
 * bottom for why that is load-bearing rather than tidy.
 */

interface Conformance {
  cols: number;
  rows: number;
  analytic: { coverage: number; meanLuminance: number; centroid: { x: number; y: number } | null };
  pixel: { coverage: number; meanLuminance: number; centroid: { x: number; y: number } | null };
  agreement: {
    cellCorrelation: number;
    rowCorrelation: number;
    colCorrelation: number;
    centroidDistance: number | null;
    coverageRatio: number;
    meanAbsCellDelta: number;
  };
  braille: { analytic: string; pixel: string };
  unsupported?: string;
}

interface PerceiveHook {
  conformance(
    spec: unknown,
    opts?: { width?: number; height?: number; seed?: number; t?: number },
  ): Promise<Conformance>;
}

const VIEWPORT = { width: 1280, height: 800, t: 5000 };

const ready = async (page: Page): Promise<void> => {
  await page.goto('/#dev');
  await page.waitForFunction(() => !!(window as unknown as { __perceive?: unknown }).__perceive);
};

const run = (page: Page, spec: unknown, seed = 42): Promise<Conformance> =>
  page.evaluate(
    ([s, o]) => (window as unknown as { __perceive: PerceiveHook }).__perceive.conformance(s, o as never),
    [spec, { ...VIEWPORT, seed }] as const,
  );

/**
 * Fixtures are written here rather than taken from the example catalog on
 * purpose: each isolates ONE thing the model has to get right, so a failure
 * names the feature instead of a scene. A catalog spec mixes five features and
 * a regression in any of them reads the same.
 */

/** Radial streaks — the geometry the historical orientation bug destroyed. */
const RADIAL_STREAKS = {
  schemaVersion: 1,
  id: 'conf-streaks',
  label: 'Conformance: radial streaks',
  background: { type: 'solid', color: '#050510' },
  layers: [
    {
      key: 'streaks',
      count: 120,
      sprite: { kind: 'streak', length: [0.03, 0.07], width: 0.004, color: '#ffffff' },
      motion: { type: 'warp', speed: [0.2, 0.5] },
      alpha: [0.9, 1],
    },
  ],
};

/** Hard-edged discs — the plainest possible geometry check, no soft falloff. */
const HARD_DISCS = {
  schemaVersion: 1,
  id: 'conf-discs',
  label: 'Conformance: drifting discs',
  background: { type: 'solid', color: '#08080c' },
  layers: [
    {
      key: 'discs',
      count: 40,
      sprite: { kind: 'circle', radius: [0.02, 0.05], color: '#ffcc88' },
      motion: { type: 'drift', speed: [0.02, 0.05], angle: 200 },
      alpha: [0.8, 1],
    },
  ],
};

/** Rings over a gradient: line-like ink AND a background the pixel path has to
 *  infer per row while the analytic path reads it from the spec. */
const RINGS_ON_GRADIENT = {
  schemaVersion: 1,
  id: 'conf-rings',
  label: 'Conformance: rings on a gradient',
  background: {
    type: 'gradient',
    stops: [
      { at: 0, color: '#101830' },
      { at: 1, color: '#02040a' },
    ],
  },
  layers: [
    {
      key: 'rings',
      count: 24,
      sprite: { kind: 'ring', radius: [0.03, 0.08], thickness: 0.006, color: '#7fd8ff' },
      motion: { type: 'orbit', speed: [8, 20], radius: [0.1, 0.3] },
      alpha: [0.7, 1],
    },
  ],
};

/** Big soft discs in `lighter` — the case the model is worst at, kept as a
 *  fixture precisely because it is where calibration has the most to gain. */
const ADDITIVE_GLOW = {
  schemaVersion: 1,
  id: 'conf-glow',
  label: 'Conformance: additive glow',
  background: { type: 'solid', color: '#01010a' },
  layers: [
    {
      key: 'glow',
      count: 18,
      sprite: { kind: 'circle', radius: [0.05, 0.12], color: '#66aaff', soft: true },
      motion: { type: 'drift', speed: [0.01, 0.03] },
      alpha: [0.3, 0.6],
      blend: 'lighter',
    },
  ],
};

/** Same scene as HARD_DISCS with soft falloff, plus persistence in the ghost test. */
const SOFT_DISCS = {
  ...HARD_DISCS,
  id: 'conf-soft-discs',
  layers: [
    {
      ...HARD_DISCS.layers[0],
      sprite: { kind: 'circle', radius: [0.02, 0.05], color: '#ffcc88', soft: true },
    },
  ],
};

const FIXTURES = [
  { name: 'radial streaks', spec: RADIAL_STREAKS },
  { name: 'hard discs', spec: HARD_DISCS },
  { name: 'rings on a gradient', spec: RINGS_ON_GRADIENT },
  { name: 'additive glow', spec: ADDITIVE_GLOW },
] as const;

test('the analytic grid agrees with the real canvas on where the light is', async ({ page }) => {
  test.setTimeout(90_000);
  await ready(page);

  for (const { name, spec } of FIXTURES) {
    for (const seed of [42, 7]) {
      const c = await run(page, spec, seed);
      const at = `${name} @ seed ${seed}`;
      expect(c.unsupported, `${at}: no readable canvas`).toBeUndefined();
      // Both halves must have drawn something — two empty grids correlate at 0
      // and would otherwise sail through as "no disagreement".
      expect(c.analytic.coverage, `${at}: analytic grid is empty`).toBeGreaterThan(0.01);
      expect(c.pixel.coverage, `${at}: canvas is empty`).toBeGreaterThan(0.01);

      // Structure is the load-bearing claim: a model that puts the light in the
      // wrong PLACE is the failure agents have no other way to detect.
      expect(c.agreement.cellCorrelation, `${at}: cells`).toBeGreaterThan(0.55);
      expect(c.agreement.rowCorrelation, `${at}: row profile`).toBeGreaterThan(0.8);
      expect(c.agreement.colCorrelation, `${at}: col profile`).toBeGreaterThan(0.8);
      expect(c.agreement.centroidDistance, `${at}: centroid`).not.toBeNull();
      expect(c.agreement.centroidDistance!, `${at}: centre of mass`).toBeLessThan(0.03);
    }
  }
});

/**
 * The orientation regression, pinned as its own case.
 *
 * `warp` motion throws streaks outward from the centre, so the column profile is
 * symmetric about the middle and the row profile is bright top and bottom.
 * Drawing every streak at angle 0 — the bug that shipped in the SVG renderer —
 * collapses that into horizontal bands, which is a profile change, which is what
 * these correlations measure. Tighter than the general case because the scene is
 * one sprite kind with nothing else to blur the reading.
 */
test('radial streaks keep their starburst in both renderings', async ({ page }) => {
  await ready(page);
  const c = await run(page, RADIAL_STREAKS);
  expect(c.agreement.rowCorrelation).toBeGreaterThan(0.85);
  expect(c.agreement.colCorrelation).toBeGreaterThan(0.85);
  // The braille of both grids is the evidence a human reads on a failure.
  expect(c.braille.pixel.length).toBeGreaterThan(100);
  expect(c.braille.analytic.length).toBeGreaterThan(100);
});

/**
 * Calibration, pinned as bands rather than asserted as agreement.
 *
 * `coverageRatio` is pixel coverage over analytic coverage. The model is close
 * for hard-edged ink, generous for soft falloff, and 4x too generous for
 * additive glow — `GLOW_SPREAD` was set by intuition and has never been checked
 * against a canvas. These bands record the current calibration so a change to
 * those constants shows up as a deliberate edit here rather than a silent shift
 * in what every agent is told about its scene.
 */
test('coverage calibration stays where it was measured', async ({ page }) => {
  await ready(page);
  const bands: Array<[string, unknown, number, number]> = [
    ['hard discs', HARD_DISCS, 0.85, 1.15],
    ['rings on a gradient', RINGS_ON_GRADIENT, 1.15, 1.75],
    ['soft discs', SOFT_DISCS, 0.55, 0.9],
    ['additive glow', ADDITIVE_GLOW, 0.15, 0.45],
  ];
  for (const [name, spec, lo, hi] of bands) {
    const c = await run(page, spec);
    expect(c.agreement.coverageRatio, `${name} coverage ratio`).toBeGreaterThan(lo);
    expect(c.agreement.coverageRatio, `${name} coverage ratio`).toBeLessThan(hi);
  }
});

/**
 * Persistence: a documented divergence, asserted by DIRECTION rather than excluded.
 *
 * `ghosting` composites previous frames, so the canvas carries strictly more ink
 * than the single instant the analytic model computes. The useful invariant is
 * not "they agree" — they must not — but "the canvas gets brighter, the model
 * does not gain ink, and the composition still lines up". A future model that
 * accounts for persistence moves the ratio toward 1 and this stays honest.
 */
test('ghosting brightens the canvas beyond the model, without moving the composition', async ({ page }) => {
  await ready(page);
  const plain = await run(page, SOFT_DISCS);
  const ghosted = await run(page, { ...SOFT_DISCS, id: 'conf-ghost', ghosting: 0.85 });

  expect(ghosted.pixel.meanLuminance).toBeGreaterThan(plain.pixel.meanLuminance);
  // Persistence reaches the analytic reading only as a dominance nudge (#10),
  // never as extra ink, so the ratio moves in a knowable direction.
  expect(ghosted.agreement.coverageRatio).toBeGreaterThan(plain.agreement.coverageRatio);
  // ...and it is still the same scene.
  expect(ghosted.agreement.cellCorrelation).toBeGreaterThan(0.8);
});

/** The same (spec, seed, t) must read identically twice — without this the
 *  numbers above are a sample, not a measurement. */
test('a conformance reading is reproducible', async ({ page }) => {
  await ready(page);
  const a = await run(page, HARD_DISCS);
  const b = await run(page, HARD_DISCS);
  expect(a.agreement.cellCorrelation).toBe(b.agreement.cellCorrelation);
  expect(a.pixel.coverage).toBe(b.pixel.coverage);
  expect(a.braille.pixel).toBe(b.braille.pixel);
});

/**
 * THE DEFECT THIS HARNESS FOUND, pinned so it cannot be forgotten or re-found.
 *
 * The two implementations disagree about which seed wins when a spec declares
 * one and the caller passes another:
 *
 *   - the renderer (`compile.ts` SpecInstance): `spec.seed ?? ctx.seed` — SPEC wins
 *   - the model    (`perceive.ts` buildScene):  `opts.seed ?? spec.seed` — CALLER wins
 *
 * So for any spec carrying `seed`, a caller-supplied seed re-arranges the
 * analytic reading and changes nothing on the canvas. Measured: cell
 * correlation collapses from ~0.98 to ~0.00 while coverage stays identical —
 * the signature of "same statistics, different scene". It reaches production
 * through `publishScene`, whose seed argument is documented as forcing a fresh
 * arrangement.
 *
 * This test asserts the CURRENT behaviour, not the desired one. When the
 * precedence is unified, this test fails — that is the intent: replace it with
 * the agreement assertion at that point.
 */
test('KNOWN DEFECT: spec.seed and a caller seed disagree, and the model follows the caller', async ({ page }) => {
  await ready(page);
  const seeded = { ...HARD_DISCS, id: 'conf-seeded', seed: 5 };

  const matched = await run(page, seeded, 5);
  expect(matched.agreement.cellCorrelation, 'agrees when the two seeds coincide').toBeGreaterThan(0.8);

  const mismatched = await run(page, seeded, 42);
  expect(
    mismatched.agreement.cellCorrelation,
    'a caller seed moves the model but not the canvas — see the doc comment above',
  ).toBeLessThan(0.3);
  // Same scene statistically, which is why nothing else catches this.
  expect(Math.abs(mismatched.agreement.coverageRatio - matched.agreement.coverageRatio)).toBeLessThan(0.2);
});
