import { createRng } from '@idle-screens/core';
import { analyzeFlashes, srgbToLinear } from '@idle-screens/validator';
import { additivePlate, backgroundLuma, backgroundRgb, backgroundRgbAt, colourSeparation, hexLuma, hexRgb, legibilityRatio, relativeLuminance, sourceOverPlate, spriteHex, spriteInks, type Rgb } from './luma';
import { buriedAreaOf, COHESION_T, cohesionOf, seamsWorthWarning } from './cohesion';
import { barFraction, flattenSprite, isPathPolygon, pathFrame, pathInkArea, polygonArea, polygonPoints } from './shapes';
import { breakTextBlock, textBlockText, buildEntities, entityScales, linkEdges, linkMaxDistPx, linkPairs, positionAt, rotationAt, textBlockAnchorOffset, textMetricsClassFor, textWidthEm, WARP_MAX_SCALE, type Entity } from './simulate';
import { morphNothingMorphable, structuralSignature } from './steer';
import { luminanceGrid } from './perceive';
import { groupOf, mapBox, paintMap, paintOpacity, paintSize } from './paint';
import { resolveTimelineAt, timelineTracks } from './timeline';
import { flashSampleTimes, lumaKeyTimes } from './flash-timeline';
import { periodWithoutTimeline } from './period';
import { LIMITS, type IdleSequence, type LayerSpec, type SaverSpec, type SpecWarning, type WarningBox } from './types';

/**
 * Minimum RGB-space colour distance (see `colourSeparation`) between a layer
 * and its background before the layer stops reading as a distinct thing.
 *
 * Calibrated against real specs rather than picked: a layer painted the literal
 * background hex measures 0.000, a near-background dark-on-dark layer ~0.036,
 * while every one of the 15 shipped examples and all 150 style-eval screens
 * clear it except the genuinely-flawed ones. Note this is a *colour* distance —
 * a Seurat-style gold-on-grey field separates by 0.39 here but only 0.013 in
 * luma, which is exactly why the measure is not luminance-based.
 */
const LOW_CONTRAST_FLOOR = 0.05;

/**
 * A spec that declares `density: 'sparse'` is promising a mostly-empty frame.
 * Above this alpha-weighted coverage the promise is broken (2 % of the frame
 * is a comfortable field, not restraint — `lanterns` measures ~1.5 %).
 */
const SPARSE_DECLARED_MAX_COVERAGE = 0.02;

/**
 * WCAG AA floor for body text. Only layers that declare `role: 'read'` are
 * measured against it — atmospheric text is texture, not copy, and the
 * shipped examples paint it at 2–3:1 on purpose.
 */
const READ_LEGIBILITY_FLOOR = 4.5;

/** A `role: 'read'` box closer than this to any edge is in the overscan / bezel zone. */
const READ_SAFE_AREA = 0.05;

/**
 * Alpha-weighted area (in viewport-areas) that additive `lighter`/`screen`
 * layers stack onto the frame before the analytic model is warned that it can
 * no longer see what it is measuring. The analytic luminance/dominance model
 * sums glow splats with no saturation ceiling, so a stack that clips to white
 * on a real canvas reports tame numbers and zero advisories (F35 — a
 * 250-entity white/cream `lighter` stack came back coverage 0.25, meanLuminance
 * 0.25, advisories []). Measured: the brightest shipped examples (`aurora`,
 * `warp-tunnel`) sit at 0.1, the recommended "80 tiny soft circles at alpha
 * 0.2" atmosphere at 0.0, and that stack at 2.0 — so 1.0 is an order of
 * magnitude above anything shipped and still half of the known blowout.
 */
const ADDITIVE_INK_CEILING = 1.0;

/**
 * Mean turn rate, in degrees a second, above which a spinning layer breaks a
 * `motionIntensity: 'calm'` declaration. About three times the fastest shipped
 * calm spin (`sakura`'s near petals at 32°/s); confetti tumbling on a
 * [-220, 220] range averages 110.
 */
const CALM_MAX_SPIN = 90;

/** Key boundaries of one window the near-limit flash check resolves: 10 is 5 flashes a second, past the gate's line. */
const NEAR_FLASH_MAX_BOUNDARIES = 10;

/** True when a region window is butted against an edge on the given axis and
 *  is a band rather than the whole axis — the shape of a deliberate anchor
 *  (a skyline along the bottom, a ceiling of stars along the top). */
function edgeAnchored(range: [number, number] | undefined): boolean {
  if (!range) return false;
  const [a, b] = range;
  return (a <= 0.02 || b >= 0.98) && b - a <= 0.6;
}

/**
 * Non-blocking advisory warnings for a valid spec. Does NOT replace validateSpec —
 * call advise only on specs that have already passed validation.
 */
export function adviseSpec(
  spec: SaverSpec,
  viewport = { width: 1920, height: 1080 },
  /**
   * Sample point. `perceiveScene` forwards its own `t`/`seed` so the advisories
   * describe the same scene its other channels do — without them a caller
   * perceiving at t = 30 s would get `form` for that instant beside an
   * `overlap-seams` advisory computed for a different one.
   *
   * `backgroundSeed` is separate from `seed` because a sequence's
   * `inkOverBed` (the segment's ink layers judged against the bed's
   * background — see `perceiveSequenceFrame`) mixes two scenes with
   * potentially different seeds: `seed` drives the ink layers' own entity
   * stream, `backgroundSeed` samples the bed's field. Defaults to `seed` —
   * every other caller has one scene and one seed for both.
   */
  opts: { t?: number; seed?: number; backgroundSeed?: number } = {},
): SpecWarning[] {
  // Which layers never show in this scene — paint opacity (the layer's own ×
  // its group's) 0 at every key boundary of its timeline, or simply 0 without
  // one. A timed piece keeps every prop in every act and hides the unused
  // ones; judging those would bury the real advisories. Without `opacity` or
  // `groups` no layer is hidden and every check below runs as it always has.
  const hidden = hiddenLayers(spec);
  // The timeline as authored, for the checks that read it over time.
  const authored = spec;
  // A `timeline` resolves at the sample time; without one this is `spec` itself.
  spec = resolveTimelineAt(spec, opts.t ?? COHESION_T);
  const warnings: SpecWarning[] = [];
  const w = viewport.width;
  const h = viewport.height;
  const { scale, countScale } = entityScales(spec, w, h);
  const rng = createRng(opts.seed ?? spec.seed ?? 42);
  const allEntities = spec.layers.map((l) => buildEntities(l, rng, w, h, scale, countScale));

  // Do overlapping layers actually merge? Computed once from the entities we
  // already built; the advisory below fires only on the case where the author
  // clearly wanted one shape and the paint settings defeat it.
  const cohesion = cohesionOf(
    spec.layers.map((layer, i) => ({ layer, entities: allEntities[i]! })),
    opts.t ?? COHESION_T, w, h,
  );

  let totalEntities = 0;
  let textLayerCount = 0;
  let motionLayerCount = 0;

  for (let li = 0; li < spec.layers.length; li++) {
    if (hidden?.[li]) continue;
    const layer = spec.layers[li]!;
    const entities = allEntities[li]!;
    totalEntities += entities.length;

    const isText = layer.sprite.kind === 'text' || layer.sprite.kind === 'textBlock';
    const isStaticText = isText && layer.motion.type === 'static';
    if (isStaticText) textLayerCount++;
    if (layer.motion.type !== 'static') motionLayerCount++;

    const coh = cohesion[li]!;
    if (seamsWorthWarning(layer, coh, entities.length, () => buriedAreaOf(layer, entities, opts.t ?? COHESION_T, w, h))) {
      // A soft or feathered edge has no edge to paint: overlaps pool into
      // smooth lumps, which is a cloud or a haze, not a seam. Measured live
      // (X423): the hard-edged control showed every overlap as an outline,
      // the soft storm showed none. What soft cannot do is make ONE solid
      // shape — say that, and leave clouds to the author.
      const s = layer.sprite;
      const softEdged = ((s.kind === 'circle' || s.kind === 'polygon') && s.soft) || (s.kind === 'rect' && !!s.feather);
      warnings.push({
        path: `layers[${li}]`,
        code: 'overlap-seams',
        message: softEdged
          ? `entities bury ${Math.round((coh.overlap ?? 0) * 100)}% of each other's outlines, but ${coh.seamCause}: `
            + 'overlaps pool into soft lumps rather than one solid silhouette (no hard edges — a cloud, smoke or haze reads well this way). '
            + 'If this layer is meant to be ONE solid shape, make it one flat colour at alpha 1, hard-edged, with no blend and no pulse.'
          : `entities bury ${Math.round((coh.overlap ?? 0) * 100)}% of each other's outlines, so this layer is drawn as one shape — `
            + `but ${coh.seamCause}, so every overlap paints a visible edge and it will read as a pile of sprites instead. `
            + 'A layer merges into a single silhouette only when it is one flat colour at alpha 1, hard-edged, with no blend and no pulse.',
      });
    }

    if (layer.trail && layer.motion.type === 'static') {
      warnings.push({
        path: `layers[${li}].trail`,
        code: 'trail-on-static',
        message: 'trail has no effect on static entities — they have no past positions to draw',
      });
    }

    // A spinning streak has an orientation of its own (a rotor, a clock hand),
    // so "no heading" is not a problem for it (F34.5).
    if ((layer.sprite.kind === 'streak' || (layer.sprite.kind === 'stroke' && layer.sprite.orient)) && layer.motion.type === 'static' && !layer.spin) {
      warnings.push({
        path: `layers[${li}].sprite`,
        code: 'streak-on-static',
        message: `${layer.sprite.kind === 'streak' ? 'streak sprites orient' : 'an oriented stroke turns'} along the motion heading — static entities have none, so the heading contributes nothing and it renders at angle 0`,
      });
    }

    if (layer.motion.type === 'wander' && layer.motion.coherence === 1 && entities.length >= 20) {
      warnings.push({
        path: `layers[${li}].motion.coherence`,
        code: 'full-coherence',
        message: 'coherence 1 makes every entity share identical harmonics — the layer moves as a rigid sheet. 0.5–0.8 reads as schooling',
      });
    }

    if (layer.sprite.kind === 'circle') {
      const maxR = entities.reduce((m, e) => Math.max(m, e.size / 2), 0);
      const maxAlpha = entities.reduce((m, e) => Math.max(m, e.alpha), 0);
      if (maxR * maxAlpha < 0.05) {
        warnings.push({
          path: `layers[${li}]`,
          code: 'invisible-layer',
          message: `layer's max visible radius (${maxR.toFixed(1)}px × ${maxAlpha.toFixed(2)} alpha) is below perceptual floor`,
        });
      }
    }

    // Colour separation: a layer painted the same brightness as the plate
    // behind it is invisible no matter how big or opaque it is. `invisible-layer`
    // above only measures radius × alpha, so a full-strength layer in a
    // background-matched colour passes every other check in this file.
    if (entities.length > 0 && layer.sprite.kind !== 'emoji') {
      // Judge against the plate the layer actually sits on: a gradient is
      // sampled across the layer's vertical extent (its region window, or its
      // pinned position), not averaged over a sky the layer never touches. A
      // layer is visible if it separates ANYWHERE in that extent (F19).
      const [y0, y1] = layer.position ? [layer.position.y, layer.position.y] : (layer.region?.y ?? [0, 1]);
      const plates = [y0, (y0 + y1) / 2, y1].map((y) => {
        const rgb = backgroundRgbAt(spec, y * h, h, scale, undefined, undefined, opts.backgroundSeed ?? opts.seed, opts.t ?? COHESION_T);
        return { rgb, luma: 0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b };
      });
      // A palette layer is visible if ANY of its colours separates — flag only
      // when every colour it can paint with disappears into the plate.
      // A path drawing is judged by the colours its parts paint (X608); an
      // entity whose every part is invisible paints nothing to judge.
      const seps = entities.map((e) => {
        const inks = spriteInks(layer, e);
        if (inks === null || inks.length === 0) return Infinity;
        return Math.max(...inks.map((hex) => {
          const ink = { rgb: hexRgb(hex), luma: hexLuma(hex) };
          const sep = Math.max(...plates.map((bg) => colourSeparation(layer, ink, bg)));
          if (sep >= LOW_CONTRAST_FLOOR || layer.blend === 'lighter' || layer.blend === 'screen') return sep;
          // Close to the page colour — but the page may not be what is behind
          // it. A dark key plate on an opaque yellow panel is judged against the
          // panel, which is what the eye (and perception's dominance) sees (X388).
          const at = positionAt(e, 0, w, h);
          const under = groundUnder(spec, allEntities, li, hidden, at, w, h);
          const framed = holeFrame(spec, allEntities, li, hidden, at, w, h);
          return Math.max(under ? colourSeparation(layer, ink, under) : sep, framed ? colourSeparation(layer, ink, framed) : sep);
        }));
      });
      const best = Math.max(...seps);
      if (best < LOW_CONTRAST_FLOOR) {
        const additive = layer.blend === 'lighter' || layer.blend === 'screen';
        warnings.push({
          path: `layers[${li}].sprite`,
          code: 'low-contrast-layer',
          message: additive
            ? `additive layer adds almost no light (luma ${best.toFixed(3)}) — a "lighter"/"screen" layer is only as visible as it is bright`
            : `layer colour is within ${best.toFixed(3)} of the background, or of the solid layer under it (floor ${LOW_CONTRAST_FLOOR}) — it will read as background, not as content`,
        });
      }
    }

  }

  // Alpha-weighted pixel coverage: how much of the viewport is "visibly filled"
  let totalCoverage = 0;
  let additiveInk = 0;
  for (let li = 0; li < spec.layers.length; li++) {
    if (hidden?.[li]) continue;
    const layer = spec.layers[li]!;
    const entities = allEntities[li]!;
    // Paint opacity weighs coverage like alpha does (unset ⇒ exactly as before).
    const paintA = layer.opacity === undefined && layer.group === undefined ? 1 : paintOpacity(spec, layer);
    // A layer/group transform scales what is painted, so it scales the area
    // too — the text boxes below already land where the transform puts them,
    // and coverage must judge the same picture (X418: a word zoomed 8× read
    // as both "the scene is empty" and "the text runs 33 000 px off-screen").
    const map = paintMap(spec, layer, w, h, scale);
    const areaScale = map ? paintSize(spec, layer) ** 2 : 1;
    const additive = layer.blend === 'lighter' || layer.blend === 'screen';
    for (const e of entities) {
      const r = e.size / 2;
      let pixArea: number;
      if (layer.sprite.kind === 'circle') {
        pixArea = Math.PI * r * r;
      } else if (layer.sprite.kind === 'polygon') {
        // The outline's own area, not its bounding square (4r²) — a flat band
        // or ridge fills a fraction of that. A path drawing counts what its
        // parts paint: an unfilled line is its stroke, not the area its
        // points enclose (X605), and a part at opacity 0 is nothing.
        if (isPathPolygon(layer.sprite)) {
          const fr = pathFrame(layer.sprite, r, w, h);
          pixArea = pathInkArea(layer.sprite, fr.sx, fr.sy, r);
        } else pixArea = polygonArea(polygonPoints(layer.sprite, r));
      } else if (layer.sprite.kind === 'bar') {
        pixArea = e.size * barFraction(layer.sprite, e.barIndex ?? 0) * (e.size2 ?? e.size * 0.2);
      } else if (layer.sprite.kind === 'textBlock') {
        const fsPx = layer.sprite.fontSize * scale;
        const lh = (layer.sprite.lineHeight ?? 1.4) * fsPx;
        const maxWPx = layer.sprite.maxWidth * scale;
        const lines = breakTextBlock(textBlockText(layer.sprite), maxWPx / fsPx, textMetricsClassFor(layer.sprite.font));
        pixArea = maxWPx * lines.length * lh * 0.55 * (layer.sprite.opacity ?? 1);
      } else if (layer.sprite.kind === 'text') {
        // The renderer's own box (a px `font` wins over the seeded size), at
        // the ~55 % ink fill a textBlock line is credited with.
        const b = textBoxAt(layer.sprite, e, positionAt(e, 0, w, h), spec, w, h);
        pixArea = (b.x1 - b.x0) * (b.y1 - b.y0) * 0.55;
      } else {
        pixArea = e.size * e.size; // emoji: approximate as square of its size
      }
      // Scaled by the transform, and never more than the frame it lands in.
      if (areaScale !== 1) pixArea *= areaScale;
      if (pixArea > w * h) pixArea = w * h;
      // Sparse-event layers are lit only for `life` of every `every` ms, at a
      // mean envelope of ~½, and at a mean grown size — judge their coverage
      // by that duty, not by whichever instant we happen to sample.
      let duty = 1;
      if (layer.emit) {
        // Area scales with size², so the time-mean over a linear size ramp
        // a→b is mean(f²) = (a² + ab + b²) / 3, not mean(f)².
        const [ga, gb] = layer.emit.grow ?? [1, 1];
        const g2 = (ga * ga + ga * gb + gb * gb) / 3;
        duty = (Math.min(layer.emit.life, layer.emit.every) / layer.emit.every) * 0.5 * g2;
      }
      const ink = paintA === 1 ? (pixArea * e.alpha * duty) / (w * h) : (pixArea * e.alpha * duty * paintA) / (w * h);
      totalCoverage += ink;
      if (additive) additiveInk += ink;
    }
    // Link lines are visual coverage too (for Mystify-style scenes they ARE the scene).
    if (layer.links) {
      const positions = entities.map((e) => positionAt(e, 0, w, h));
      const edges = linkEdges(layer.links, positions, linkMaxDistPx(layer.links, scale), layer.wrap !== false, w, h);
      const defaultWidth = scale === 1 ? 1 : 1 / LIMITS.referenceViewport;
      const lwPx = (layer.links.width ?? defaultWidth) * scale;
      const la = layer.links.alpha ?? 1;
      for (const edge of edges) totalCoverage += paintA === 1 ? (edge.dist * lwPx * la) / (w * h) : (edge.dist * lwPx * la * paintA) / (w * h);
    }
  }

  // A declared `density` is read before either density advisory fires — and
  // then checked against the measurement, so the declaration cannot be used
  // to silence a scene that is empty by accident rather than by intent.
  const density = spec.density ?? 'normal';
  const wouldBeSparse = totalCoverage < 0.0005 && spec.layers.length > 0;
  if (wouldBeSparse && density !== 'sparse') {
    warnings.push({
      path: 'layers',
      code: 'sparse-scene',
      message: `alpha-weighted coverage is ${(totalCoverage * 100).toFixed(4)}% — scene will look empty on most displays`,
    });
  }

  if (additiveInk > ADDITIVE_INK_CEILING) {
    warnings.push({
      path: 'layers',
      code: 'additive-saturation',
      message: `"lighter"/"screen" layers stack ${additiveInk.toFixed(1)}× the frame's area in alpha-weighted light — overlapping additive sprites clip to white on a real canvas, and the analytic perception model sums them without a ceiling so its coverage/luminance/dominance numbers cannot see it. Thin the count, lower alpha (summed additive alpha at any point ≲ 0.5), or drop blend on the densest layer`,
    });
  }

  if (totalEntities > 500 && density !== 'dense') {
    warnings.push({
      path: 'layers',
      code: 'dense-scene',
      message: `${totalEntities} entities — scene may feel crowded and hurt performance on low-end devices`,
    });
  }

  if (density === 'sparse' && totalCoverage > SPARSE_DECLARED_MAX_COVERAGE) {
    warnings.push({
      path: 'density',
      code: 'density-mismatch',
      message: `declared sparse but alpha-weighted coverage is ${(totalCoverage * 100).toFixed(2)}% — either the declaration or the scene is wrong`,
    });
  } else if (density === 'dense' && wouldBeSparse) {
    warnings.push({
      path: 'density',
      code: 'density-mismatch',
      message: `declared dense but alpha-weighted coverage is ${(totalCoverage * 100).toFixed(4)}% — the scene will look empty`,
    });
  }

  if (spec.layers.length > 0 && textLayerCount > 0 && motionLayerCount === 0) {
    const textRatio = textLayerCount / spec.layers.length;
    if (textRatio >= 0.8) {
      warnings.push({
        path: 'layers',
        code: 'text-heavy',
        message: 'most layers are static text — reads as a document, not a screensaver',
      });
    }
  }

  // `calm` is a promise about tempo, like `density` is one about emptiness —
  // and spin is motion the eye reads (perception.motion counts it, X607).
  // Only the turn rate is judged: drift speed cannot tell calm from moderate
  // (the shipped calm `sakura` gusts outrun the moderate `comets`), while
  // every shipped calm spin turns at ≤ 32°/s.
  if (spec.motionIntensity === 'calm') {
    for (let li = 0; li < spec.layers.length; li++) {
      if (hidden?.[li]) continue;
      const layer = spec.layers[li]!;
      // A disc or ring looks the same turned.
      if (!layer.spin || layer.sprite.kind === 'circle' || layer.sprite.kind === 'ring') continue;
      const entities = allEntities[li]!;
      if (entities.length === 0) continue;
      const rate = (entities.reduce((s, e) => s + Math.abs(e.spinSpeed), 0) / entities.length) * (180 / Math.PI);
      if (rate <= CALM_MAX_SPIN) continue;
      warnings.push({
        path: `layers[${li}].spin`,
        code: 'motion-intensity-mismatch',
        message: `declared motionIntensity: 'calm' but ${layer.key ? `\`${layer.key}\`` : `layers[${li}]`} spins at ~${Math.round(rate)}°/s on average — that reads busy, not calm (calm spins sit at ≤ ${CALM_MAX_SPIN}°/s); slow the spin or declare 'moderate' / 'energetic'`,
      });
    }
  }

  // Flash, near the line: the publish-time gate (`timelineFlashReport`) only
  // refuses MORE than 3 flashes a second, so a full-frame step keyed at the
  // 200 ms floor — 2.5 a second, right at the edge — passes it silently (X589).
  const flicker = nearLimitFlash(authored);
  if (flicker) {
    warnings.push({
      path: 'timeline',
      code: 'flash-near-limit',
      message: `the timeline flickers ${flicker.flashesPerSecond} times a second over ${Math.round(flicker.area * 100)}% of the frame around ${Math.round(flicker.at)} ms — at or near WCAG 2.3.1's limit of 3; space opposing luminance changes ≥ 500 ms apart, or lower the contrast between the two states`,
    });
  }

  // Loop seam: a looping timeline says "this lap is the piece". When the
  // rest of the scene repeats too, but on a period that does not divide the
  // lap, one lap cannot come round to its own first frame — and the fix is
  // one number. A scene whose other motion never repeats (drifting stars) is
  // not judged: that is ambient by design, and the wall does not need a seam.
  if (authored.timeline?.loop && (authored.timeline.duration ?? 0) > 0) {
    const lap = Math.round(authored.timeline.duration!);
    const rest = periodWithoutTimeline(authored);
    if (rest.period !== null && rest.period > 0 && lap % rest.period !== 0) {
      let a = lap;
      let b = rest.period;
      while (b) [a, b] = [b, a % b];
      warnings.push({
        path: 'timeline.duration',
        code: 'loop-seam',
        message: `the timeline loops every ${lap} ms but the rest of the scene repeats every ${rest.period} ms (${rest.parts.join(', ')}), so the whole scene only repeats every ${(lap / a) * rest.period} ms — make the lap a multiple of ${rest.period} ms for one lap to loop`,
      });
    }
  }

  // Link starvation: links layer where few edges actually form.
  // Chain mode always forms its edges — only distance-gated modes can starve.
  for (let li = 0; li < spec.layers.length; li++) {
    if (hidden?.[li]) continue;
    const layer = spec.layers[li]!;
    if (!layer.links || layer.links.mode === 'chain') continue;
    const entities = allEntities[li]!;
    const positions = entities.map((e) => positionAt(e, 0, w, h));
    const k = layer.links.k ?? 1;
    const pairs = linkPairs(positions, k, linkMaxDistPx(layer.links, scale), layer.wrap !== false, w, h);
    const maxPossible = Math.min(entities.length * k, entities.length * (entities.length - 1) / 2);
    if (maxPossible > 0 && pairs.length / maxPossible < 0.1) {
      warnings.push({
        path: `layers[${li}].links`,
        code: 'link-starvation',
        message: `only ${pairs.length}/${maxPossible} possible edges formed — raise count or widen links.maxDist`,
      });
    }
  }

  // Motion variety: all entities in a layer have nearly identical velocity
  for (let li = 0; li < spec.layers.length; li++) {
    if (hidden?.[li]) continue;
    const layer = spec.layers[li]!;
    if (layer.motion.type === 'static') continue;
    const entities = allEntities[li]!;
    if (entities.length < 3) continue;
    const speeds = entities.map((e) => Math.sqrt(e.vx * e.vx + e.vy * e.vy));
    const mean = speeds.reduce((a, b) => a + b, 0) / speeds.length;
    if (mean === 0) continue;
    const maxDev = Math.max(...speeds.map((s) => Math.abs(s - mean)));
    if (maxDev / mean < 0.05) {
      warnings.push({
        path: `layers[${li}].motion`,
        code: 'uniform-motion',
        message: 'all entities move at nearly identical speed — widen the speed range for visual variety',
      });
    }
  }

  // Composition balance: entities clustered in one region. Motions that sweep the
  // whole viewport (bounce, warp, path) have transient spawn positions that say
  // nothing about composition — exclude them from the centroid.
  const composed = spec.layers
    .map((l, li) => ({ l, li, ents: allEntities[li]! }))
    .filter(({ li }) => !hidden?.[li])
    .filter(({ l }) => !['bounce', 'warp', 'path'].includes(l.motion.type))
    // Layer-parented orbits position relative to their parent (resolved at render
    // time) — their raw positionAt is an offset around (0,0), not a screen position.
    .filter(({ l }) => !(l.motion.type === 'orbit' && l.motion.center && 'layer' in l.motion.center));
  const composedCount = composed.reduce((s, c) => s + c.ents.length, 0);
  if (composedCount >= 8) {
    const positions = composed.flatMap(({ ents }) => ents.map((e) => positionAt(e, 0, w, h)));
    const px = positions.reduce((s, p) => s + p.x, 0) / positions.length / w;
    const py = positions.reduce((s, p) => s + p.y, 0) / positions.length / h;
    // A skyline sits low on purpose. When the offset is along ONE axis and most
    // of the composed entities come from layers whose region is butted against
    // an edge on that axis, the offset is the composition, not a mistake (F20).
    const offX = Math.abs(px - 0.5);
    const offY = Math.abs(py - 0.5);
    const anchoredOn = (axis: 'x' | 'y'): number =>
      composed.reduce((n, { l, ents }) => n + (edgeAnchored(l.region?.[axis]) ? ents.length : 0), 0) / composedCount;
    const intentional =
      (offY > 0.2 && offX <= 0.2 && anchoredOn('y') >= 0.5) ||
      (offX > 0.2 && offY <= 0.2 && anchoredOn('x') >= 0.5);
    if ((offX > 0.2 || offY > 0.2) && !intentional) {
      // Where the entities are is only a suspicion; where the ink is decides.
      // Confirmed on the same luminance grid — the same rule, cells weighted
      // by how far they sit from the background — that perception reports
      // beside it, so the two can no longer disagree in one response (X384:
      // 24 overlapping slivers in one half outweighed a full-height stripe in
      // the other, 0.73 counted vs 0.58 seen). It can only silence the head
      // count, never add a warning, and costs a grid only when it fires.
      const grid = luminanceGrid({ ...spec, layers: composed.map(({ l }) => l) }, { viewport: { width: w, height: h }, t: opts.t ?? COHESION_T, seed: opts.seed });
      const c = grid.centroid;
      if (c && (Math.abs(c.x - 0.5) > 0.2 || Math.abs(c.y - 0.5) > 0.2)) {
        warnings.push({
          path: 'layers',
          code: 'off-center',
          message: `centroid at (${c.x.toFixed(2)}, ${c.y.toFixed(2)}) — composition is heavily offset from center`,
        });
      }
    }
  }

  // Spatial text: the one layout bug an author without eyes makes most and
  // cannot detect — a caption that runs off the frame, a title painted over a
  // body. Only static text is judged (moving text has no fixed box). Boxes use
  // the character-class width table the textBlock line-breaker uses, so the
  // estimate is the renderer's own idea of the text, not a separate guess.
  const textBoxes: TextBoxAt[] = [];
  for (let li = 0; li < spec.layers.length; li++) {
    if (hidden?.[li]) continue;
    const layer = spec.layers[li]!;
    const s = layer.sprite;
    if (layer.motion.type !== 'static') continue;
    if (s.kind !== 'text' && s.kind !== 'textBlock') continue;
    const label = layer.key ? `\`${layer.key}\`` : `layers[${li}]`;
    for (const e of allEntities[li]!) {
      const p = positionAt(e, 0, w, h);
      const unturned = s.kind === 'textBlock' ? textBlockBoxAt(s, p, w, h) : textBoxAt(s, e, p, spec, w, h);
      // The renderer turns text about its entity by `rotate`: a vertical
      // caption is tall and narrow, not a long line off the edge (X603).
      const rot = rotationAt(e, 0);
      const turn = (q: { x: number; y: number }) => ({ x: p.x + (q.x - p.x) * Math.cos(rot) - (q.y - p.y) * Math.sin(rot), y: p.y + (q.x - p.x) * Math.sin(rot) + (q.y - p.y) * Math.cos(rot) });
      // A layer `transform` moves (and scales) the painted text: judge the box where it lands.
      // Both turns compose on the corners before one box is taken, so rotations that cancel don't grow it.
      const map = paintMap(spec, layer, w, h, scale);
      const both = rot && map ? (q: { x: number; y: number }) => map(turn(q)) : rot ? turn : map;
      const box = both ? { ...unturned, ...mapBox(both, unturned) } : unturned;
      const raw = rot ? { ...unturned, ...mapBox(turn, unturned) } : unturned;
      // What the layer guarantees it paints, worst case: base alpha minus its
      // pulse trough (ignoring `emit`'s on/off envelope — a mark's on-screen
      // duty cycle is a readability question, not an ink-colour one; sampling
      // at `t = 0` would otherwise flag every emitting layer as invisible)
      // times a textBlock's own `opacity` — so faint or invisible
      // `role: 'read'` text can't hide behind an unmeasured alpha.
      const baseAlpha = Math.max(0, Math.min(1, e.alpha - e.pulseAmp)) * (s.kind === 'textBlock' ? (s.opacity ?? 1) : 1);
      const alpha = layer.opacity === undefined && layer.group === undefined ? baseAlpha : baseAlpha * paintOpacity(spec, layer);
      const str = s.kind === 'textBlock' ? textBlockText(s) : (s.strings[e.spriteIndex] ?? s.strings[0] ?? '');
      textBoxes.push({ li, label, alpha, str, ...box, rawW: raw.x1 - raw.x0, rawH: raw.y1 - raw.y0 });
    }
  }
  const asFraction = (b: Pick<Box, 'x0' | 'y0' | 'x1' | 'y1'>): WarningBox => ({
    x: +(b.x0 / w).toFixed(4),
    y: +(b.y0 / h).toFixed(4),
    w: +((b.x1 - b.x0) / w).toFixed(4),
    h: +((b.y1 - b.y0) / h).toFixed(4),
  });

  // Off-screen: any edge past the viewport by more than 1% of that dimension
  // (the width table is approximate; a hairline overhang is not a finding).
  const tolX = w * 0.01;
  const tolY = h * 0.01;
  const offFlagged = new Set<number>();
  for (const b of textBoxes) {
    if (offFlagged.has(b.li)) continue;
    const edges: string[] = [];
    if (b.x0 < -tolX) edges.push(`left edge by ~${Math.round(-b.x0)}px`);
    if (b.x1 > w + tolX) edges.push(`right edge by ~${Math.round(b.x1 - w)}px`);
    if (b.y0 < -tolY) edges.push(`top edge by ~${Math.round(-b.y0)}px`);
    if (b.y1 > h + tolY) edges.push(`bottom edge by ~${Math.round(b.y1 - h)}px`);
    if (edges.length === 0) continue;
    offFlagged.add(b.li);
    warnings.push({
      path: `layers[${b.li}]`,
      code: 'text-off-screen',
      message: `${b.label} text runs off the ${edges.join(' and the ')} at ${w}×${h} — move position, or shrink fontSize / maxWidth`,
    });
  }

  // Overlap: two different static text layers whose boxes share more than 10%
  // of the smaller box. Reported once per layer pair, on the earlier layer.
  const pairFlagged = new Set<string>();
  for (let i = 0; i < textBoxes.length; i++) {
    for (let j = i + 1; j < textBoxes.length; j++) {
      const a = textBoxes[i]!;
      const b = textBoxes[j]!;
      if (a.li === b.li) continue;
      const pair = `${Math.min(a.li, b.li)}:${Math.max(a.li, b.li)}`;
      if (pairFlagged.has(pair)) continue;
      const ix = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
      const iy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
      if (ix <= 0 || iy <= 0) continue;
      const smaller = Math.min((a.x1 - a.x0) * (a.y1 - a.y0), (b.x1 - b.x0) * (b.y1 - b.y0));
      if (smaller <= 0) continue;
      const share = (ix * iy) / smaller;
      if (share <= 0.1) continue;
      if (isOutlineStack(a, b)) continue;
      pairFlagged.add(pair);
      const [first, second] = a.li < b.li ? [a, b] : [b, a];
      warnings.push({
        path: `layers[${first.li}]`,
        code: 'text-overlap',
        message: `${first.label} and ${second.label} text boxes overlap (~${Math.round(share * 100)}% of the smaller one) — they will paint over each other; move one or shrink it`,
        // The two boxes, so an agent can move one without re-deriving the
        // layout. Additive: the message is unchanged.
        boxes: [asFraction(first), asFraction(second)],
      });
    }
  }

  // Cells of ONE list/table layer painting over each other (X214). A data
  // layout's `gap` is the pitch between cell anchors, not the space between
  // cells, so a label wider than the column pitch runs into its neighbour.
  // Only data layouts are judged: scattered text in one layer overlapping is
  // texture, not a layout bug. Same 10%-of-the-smaller-box rule as above.
  const cellFlagged = new Set<number>();
  for (let i = 0; i < textBoxes.length; i++) {
    const a = textBoxes[i]!;
    if (cellFlagged.has(a.li)) continue;
    const layer = spec.layers[a.li]!;
    const layout = layer.layout;
    if (layout?.type !== 'list' && layout?.type !== 'table') continue;
    for (let j = i + 1; j < textBoxes.length; j++) {
      const b = textBoxes[j]!;
      if (b.li !== a.li) continue;
      const ix = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
      const iy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
      if (ix <= 0 || iy <= 0) continue;
      const smaller = Math.min((a.x1 - a.x0) * (a.y1 - a.y0), (b.x1 - b.x0) * (b.y1 - b.y0));
      if (smaller <= 0 || (ix * iy) / smaller <= 0.1) continue;
      cellFlagged.add(a.li);
      const cells = textBoxes.filter((x) => x.li === a.li);
      const dflt = scale === 1 ? LIMITS.defaultListGapPx : LIMITS.defaultListGap;
      const g = layout.gap ?? dflt;
      const gx = typeof g === 'number' ? g : g.x ?? dflt;
      const gy = typeof g === 'number' ? g : g.y ?? dflt;
      const cols = layout.type === 'list' ? 1 : Math.max(1, Math.round(layout.columns));
      const unitPx = (v: number): number => (scale === 1 ? v : v * scale);
      const fromPx = (px: number): number => (scale === 1 ? Math.ceil(px) : Math.ceil((px / scale) * 100) / 100);
      const maxW = cells.reduce((m, c) => Math.max(m, c.rawW), 0);
      const maxH = cells.reduce((m, c) => Math.max(m, c.rawH), 0);
      const fixes: string[] = [];
      const across = cols > 1 && maxW > unitPx(gx);
      if (across) fixes.push(`its labels are up to ~${Math.round(maxW)}px wide against a ${Math.round(unitPx(gx))}px column pitch (gap${typeof g === 'number' ? '' : '.x'} ${gx}) — raise gap${typeof g === 'number' ? '' : '.x'} to ≥ ${fromPx(maxW * 1.1)}`);
      if (!across || maxH > unitPx(gy)) fixes.push(`rows are ~${Math.round(maxH)}px tall against a ${Math.round(unitPx(gy))}px row pitch (gap${typeof g === 'number' ? '' : '.y'} ${gy}) — raise gap${typeof g === 'number' ? '' : '.y'} to ≥ ${fromPx(maxH * 1.1)}`);
      warnings.push({
        path: `layers[${a.li}].layout.gap`,
        code: 'layout-text-overlap',
        message: `${a.label} cells overlap at ${w}×${h}: a ${layout.type}'s \`gap\` is the pitch between cell anchors, not the space between cells; ${fixes.join('; and ')}, or shrink the text`,
        boxes: [asFraction(a), asFraction(b)],
      });
      break;
    }
  }

  // Legibility, for text that declared it must be read (`role: 'read'`).
  // Everything below is opt-in: a layer without the role is never measured,
  // so the atmospheric text the examples paint at 2–3:1 stays silent.
  const readFlagged = new Set<number>();
  for (const b of textBoxes) {
    if (readFlagged.has(b.li)) continue;
    const layer = spec.layers[b.li]!;
    const s = layer.sprite;
    if ((s.kind !== 'text' && s.kind !== 'textBlock') || s.role !== 'read') continue;
    // Every box of the layer (a `list` of labels is several), worst one wins.
    const boxes = textBoxes.filter((x) => x.li === b.li);
    readFlagged.add(b.li);

    const ink = hexRgb(s.color ?? '#e6e8ef');
    // What the layer actually paints over `base`, at its own alpha and blend —
    // a `role: 'read'` label at low opacity, or under `lighter`/`screen`/
    // `multiply`, is not free to hide behind a source-over assumption.
    const textPlate = (base: Rgb, alpha: number): Rgb => {
      if (layer.blend === 'lighter' || layer.blend === 'screen') return additivePlate(base, ink, alpha, layer.blend);
      if (layer.blend === 'multiply') {
        return {
          r: base.r * (1 - alpha + ink.r * alpha),
          g: base.g * (1 - alpha + ink.g * alpha),
          b: base.b * (1 - alpha + ink.b * alpha),
        };
      }
      return sourceOverPlate(base, ink, alpha);
    };
    let worst: { ground: number; plate: number; plateLabel: string | null; onSolid: boolean } | null = null;
    for (const box of boxes) {
      const cy = (box.y0 + box.y1) / 2;
      const cx = (box.x0 + box.x1) / 2;
      const bgAt = (x: number, y: number): Rgb => backgroundRgbAt(spec, y, h, scale, x, w, opts.backgroundSeed ?? opts.seed, opts.t ?? COHESION_T);
      // The ground is what is painted behind the text, not just the page: a
      // solid backing chip drawn under a label is the standard remedy, and
      // the one this message recommends (X562 — the same root cause as X388
      // on low-contrast-layer). The chip must cover the whole box to replace
      // the page: centre and corners are probed, and any probe it misses
      // keeps the page at the box centre in play, judged as before.
      const ix = (box.x1 - box.x0) * 0.02;
      const iy = (box.y1 - box.y0) * 0.02;
      const probes = [[cx, cy], [box.x0 + ix, box.y0 + iy], [box.x1 - ix, box.y0 + iy], [box.x0 + ix, box.y1 - iy], [box.x1 - ix, box.y1 - iy]] as const;
      const grounds: Array<{ rgb: Rgb; onSolid: boolean }> = [];
      let bare = false;
      for (const [x, y] of probes) {
        const under = groundUnder(spec, allEntities, box.li, hidden, { x, y }, w, h, bgAt(x, y));
        if (under) grounds.push({ rgb: under.rgb, onSolid: true });
        else bare = true;
      }
      if (bare) grounds.push({ rgb: bgAt(cx, cy), onSolid: false });
      for (const g of grounds) {
        const ground = legibilityRatio(textPlate(g.rgb, box.alpha), g.rgb);
        const lit = brightestAdditivePlate(spec, allEntities, g.rgb, box, w, h);
        const plate = lit ? legibilityRatio(textPlate(lit.rgb, box.alpha), lit.rgb) : Infinity;
        if (!worst || Math.min(ground, plate) < Math.min(worst.ground, worst.plate)) {
          worst = { ground, plate, plateLabel: lit?.label ?? null, onSolid: g.onSolid };
        }
      }
    }
    if (worst && Math.min(worst.ground, worst.plate) < READ_LEGIBILITY_FLOOR) {
      const under = worst.plateLabel
        ? ` and ${worst.plate.toFixed(1)}:1 under ${worst.plateLabel} at its brightest`
        : '';
      const against = worst.onSolid ? 'against the solid layer painted under it' : 'against the background at the box centre';
      warnings.push({
        path: `layers[${b.li}].sprite`,
        code: 'text-legibility',
        message: `${b.label} is declared role: 'read' but its colour reads at ${worst.ground.toFixed(1)}:1 ${against}${under} — below ${READ_LEGIBILITY_FLOOR}:1; brighten the text, darken the ground under it, or declare role: 'atmosphere' if it is texture`,
      });
    }

    // Safe area: readable text that sits in the outer 5 % of the frame lands
    // in the bezel / overscan zone on a real display.
    const edges: string[] = [];
    const x0 = Math.min(...boxes.map((x) => x.x0));
    const x1 = Math.max(...boxes.map((x) => x.x1));
    const y0 = Math.min(...boxes.map((x) => x.y0));
    const y1 = Math.max(...boxes.map((x) => x.y1));
    if (x0 < w * READ_SAFE_AREA) edges.push('left');
    if (x1 > w * (1 - READ_SAFE_AREA)) edges.push('right');
    if (y0 < h * READ_SAFE_AREA) edges.push('top');
    if (y1 > h * (1 - READ_SAFE_AREA)) edges.push('bottom');
    if (edges.length > 0) {
      warnings.push({
        path: `layers[${b.li}]`,
        code: 'text-safe-area',
        message: `${b.label} is declared role: 'read' but its box is within ${READ_SAFE_AREA * 100}% of the ${edges.join(' and ')} edge${edges.length === 1 ? '' : 's'} at ${w}×${h} — displays crop and bezels hide that zone; move it inward`,
        boxes: [asFraction({ x0, y0, x1, y1 })],
      });
    }
  }

  return warnings;
}

/**
 * The densest one-second window of luminance key boundaries in a timeline,
 * resolved and run through the WCAG analyzer at a stricter rate — a tile
 * counts once it reaches 2 flashes a second — or null when nothing flickers
 * that fast over a quarter of the frame. One window, at most
 * {@link NEAR_FLASH_MAX_BOUNDARIES} boundaries of it: this runs on every
 * preview, and a window denser than that is the publish gate's to judge.
 */
function nearLimitFlash(spec: SaverSpec): { flashesPerSecond: number; area: number; at: number } | null {
  if (!spec.timeline) return null;
  const { times, lap } = lumaKeyTimes(spec);
  // Two flashes are four reversals inside the window.
  let best: { from: number; n: number } | null = null;
  for (let i = 0, e = 0; i < times.length; i++) {
    while (e < times.length && times[e]! < times[i]! + 1000) e++;
    if (e - i >= 4 && (!best || e - i > best.n)) best = { from: i, n: e - i };
  }
  if (!best) return null;
  const window = times.slice(best.from, best.from + Math.min(best.n, NEAR_FLASH_MAX_BOUNDARIES));
  const samples = flashSampleTimes(window).map((t) => ({ t, lum: luminanceGrid(spec, { t, cols: 16, rows: 9 }).cells.flat().map((v) => srgbToLinear(v * 255)) }));
  const r = analyzeFlashes(samples, { maxFlashesPerSecond: 1 }).general;
  if (!r.fails) return null;
  return { flashesPerSecond: r.worstTileFlashesPerSecond, area: r.flashingAreaFraction, at: lap ? window[0]! % lap : window[0]! };
}

/**
 * The brightest ground a `role: 'read'` box can find itself on: for every
 * additive layer (`lighter` / `screen`) whose entities can reach the box and
 * are big enough to sit under a glyph, the brightest per-entity plate — its
 * own colour composited at its own peak alpha (base + pulse), never a
 * different entity's alpha borrowed onto it. Reach is judged at rest: a
 * static entity is its disc at `t = 0`; an orbit is its centre ± radius;
 * every travelling motion can be anywhere. The disc's diameter is the
 * entity's largest possible rendered extent — grow breathing, a rect/bar's
 * second dimension (thickness/aspect height can exceed the primary size),
 * and the peak scale warp/emit reach over their lifecycle — so a mote that
 * balloons under a line is not dismissed as dust because it starts small.
 */
function brightestAdditivePlate(
  spec: SaverSpec,
  allEntities: Entity[][],
  ground: Rgb,
  box: TextBoxAt,
  w: number,
  h: number,
): { rgb: Rgb; label: string } | null {
  let best: { rgb: Rgb; label: string; lum: number } | null = null;
  for (let lj = 0; lj < spec.layers.length; lj++) {
    const layer = spec.layers[lj]!;
    const blend = layer.blend;
    if (blend !== 'lighter' && blend !== 'screen') continue;
    if (lj === box.li) continue;
    const entities = allEntities[lj]!;
    // Only a layer that is actually moved at draw time (its own or its
    // group's transform) may reach anywhere; opacity alone moves nothing.
    const moved = layer.transform !== undefined || groupOf(spec, layer)?.transform !== undefined;
    for (const e of entities) {
      const hex = spriteHex(layer, e);
      if (hex === null) continue;
      const growScale = (e.motion === 'warp' ? WARP_MAX_SCALE : 1) * (e.emit ? Math.max(e.emit.growFrom, e.emit.growTo) : 1);
      const maxDim = Math.max(e.size, e.size2 ?? 0) * (1 + e.growAmp) * growScale;
      if (maxDim < box.fs) continue;
      // A transformed layer is moved at draw time: treat it like a moving one (it may reach anywhere).
      if (!moved && !entityReachesBox(e, maxDim / 2, box, w, h)) continue;
      const a = layer.opacity === undefined && layer.group === undefined ? Math.min(1, e.alpha + e.pulseAmp) : Math.min(1, e.alpha + e.pulseAmp) * paintOpacity(spec, layer);
      if (a <= 0) continue;
      const plate = additivePlate(ground, hexRgb(hex), a, blend);
      const lum = relativeLuminance(plate);
      if (!best || lum > best.lum) {
        best = { rgb: plate, label: layer.key ? `\`${layer.key}\`` : `layers[${lj}]`, lum };
      }
    }
  }
  return best ? { rgb: best.rgb, label: best.label } : null;
}

/**
 * The colour of a layer ABOVE `li` that frames the point through a hole: a
 * static, opaque path drawing with more than one subpath whose outline box
 * holds the point while its fill does not (a window, a slit, a porthole).
 * What shows through is seen against that frame, not the background (X610).
 */
function holeFrame(
  spec: SaverSpec,
  allEntities: Entity[][],
  li: number,
  hidden: boolean[] | null,
  pt: { x: number; y: number },
  w: number,
  h: number,
): { rgb: Rgb; luma: number } | null {
  for (let lj = li + 1; lj < spec.layers.length; lj++) {
    if (hidden?.[lj]) continue;
    const layer = spec.layers[lj]!;
    const sp = layer.sprite;
    if (sp.kind !== 'polygon' || !isPathPolygon(sp) || sp.soft) continue;
    if (layer.motion.type !== 'static' || layer.blend !== undefined || layer.transform !== undefined || groupOf(spec, layer)?.transform !== undefined) continue;
    if (flattenSprite(sp).subpaths < 2) continue;
    const a = layer.opacity === undefined && layer.group === undefined ? 1 : paintOpacity(spec, layer);
    for (const e of allEntities[lj]!) {
      if (e.spinSpeed !== 0 || e.rotate || e.alpha * a < 0.9) continue;
      const c = positionAt(e, 0, w, h);
      // The outline lands through the drawing's frame (span stretches it,
      // origin anchors it), as the renderer draws it.
      const fr = pathFrame(sp, e.size / 2, w, h);
      const pts = flattenSprite(sp).points.map(([u, v]) => ({ x: (u - fr.ox) * fr.sx, y: (v - fr.oy) * fr.sy }));
      if (pts.length < 3) continue;
      const dx = pt.x - c.x;
      const dy = pt.y - c.y;
      if (dx < Math.min(...pts.map((q) => q.x)) || dx > Math.max(...pts.map((q) => q.x))) continue;
      if (dy < Math.min(...pts.map((q) => q.y)) || dy > Math.max(...pts.map((q) => q.y))) continue;
      if (pointInPolygon(dx, dy, pts)) continue;
      // What the frame paints, not its base colour: parts may override it, and
      // a frame whose parts are all invisible frames nothing.
      const ink = spriteInks(layer, e)?.[0];
      if (ink === undefined) continue;
      const rgb = hexRgb(ink);
      return { rgb, luma: 0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b };
    }
  }
  return null;
}

/**
 * What an earlier layer has painted at `pt` (t = 0), composited over the
 * page colour (or over `base`, the page sampled where `pt` is, when the
 * caller has it), or null when nothing solid sits there. Conservative on
 * purpose: only static, transform-free, normal-blend, hard-edged shapes
 * count, with exact containment for circles, axis-aligned (or quarter-turned)
 * rects and unrotated polygons — so the low-contrast check can only be
 * talked out of firing by a plate that is really there.
 */
function groundUnder(
  spec: SaverSpec,
  allEntities: Entity[][],
  li: number,
  hidden: boolean[] | null,
  pt: { x: number; y: number },
  w: number,
  h: number,
  base: Rgb = backgroundRgb(spec),
): { rgb: Rgb; luma: number } | null {
  let plate: Rgb = base;
  let covered = false;
  for (let lj = 0; lj < li; lj++) {
    if (hidden?.[lj]) continue;
    const layer = spec.layers[lj]!;
    const sp = layer.sprite;
    if (layer.motion.type !== 'static' || layer.blend !== undefined || layer.transform !== undefined || groupOf(spec, layer)?.transform !== undefined) continue;
    // A chip that is not there for the whole run (lifecycle, sparse emit) is
    // not a ground the text can lean on.
    if (layer.life !== undefined || layer.emit !== undefined) continue;
    if ((sp.kind === 'circle' || sp.kind === 'polygon') && sp.soft) continue;
    if (sp.kind !== 'circle' && sp.kind !== 'rect' && sp.kind !== 'polygon') continue;
    // A path drawing paints through its parts (own colours, opacity, holes); the base colour is not what lands.
    if (sp.kind === 'polygon' && isPathPolygon(sp)) continue;
    const a = layer.opacity === undefined && layer.group === undefined ? 1 : paintOpacity(spec, layer);
    for (const e of allEntities[lj]!) {
      if (e.spinSpeed !== 0 || e.pulseAmp > 0 || e.growAmp > 0 || e.alpha * a <= 0) continue;
      const hex = spriteHex(layer, e);
      if (hex === null) continue;
      const c = positionAt(e, 0, w, h);
      const dx = pt.x - c.x;
      const dy = pt.y - c.y;
      let inside = false;
      if (sp.kind === 'circle') inside = Math.hypot(dx, dy) <= e.size / 2;
      else if (sp.kind === 'rect') {
        const rot = ((e.rotate ?? 0) % Math.PI + Math.PI) % Math.PI;
        const quarter = Math.abs(rot - Math.PI / 2) < 0.01;
        if (rot > 0.01 && rot < Math.PI - 0.01 && !quarter) continue;
        const hx = (quarter ? (e.size2 ?? e.size) : e.size) / 2;
        const hy = (quarter ? e.size : (e.size2 ?? e.size)) / 2;
        inside = Math.abs(dx) <= hx && Math.abs(dy) <= hy;
      } else {
        if (e.rotate) continue;
        inside = pointInPolygon(dx, dy, polygonPoints(sp, e.size / 2));
      }
      if (!inside) continue;
      plate = sourceOverPlate(plate, hexRgb(hex), Math.min(1, e.alpha * a));
      covered = true;
    }
  }
  return covered ? { rgb: plate, luma: 0.2126 * plate.r + 0.7152 * plate.g + 0.0722 * plate.b } : null;
}

function pointInPolygon(x: number, y: number, pts: Array<{ x: number; y: number }>): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]!;
    const b = pts[j]!;
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Whether an entity's disc of half-extent `r` can overlap `box` (see `brightestAdditivePlate`). */
function entityReachesBox(e: Entity, r: number, box: TextBoxAt, w: number, h: number): boolean {
  if (e.motion === 'static') {
    const p = positionAt(e, 0, w, h);
    return p.x + r > box.x0 && p.x - r < box.x1 && p.y + r > box.y0 && p.y - r < box.y1;
  }
  if (e.motion === 'orbit' && !e.orbitParent) {
    const span = e.orbitR + r;
    return e.orbitCx + span > box.x0 && e.orbitCx - span < box.x1 && e.orbitCy + span > box.y0 && e.orbitCy - span < box.y1;
  }
  return true;
}

/**
 * The outline / drop-shadow idiom (X416): the SAME string painted twice at the
 * same size, nudged a few px — a dark copy under the fill. That is one title,
 * not two labels colliding. "A few px" is judged against the glyph height, so
 * it holds at every viewport: centres within 15 % of it on EACH axis, sizes
 * within 10 %. Per axis, not by straight-line distance: the four-corner
 * outline puts copies at (±d, ±d), and the diagonal opposites sit √2 further
 * apart than the axis neighbours for the same nudge (X611).
 */
const OUTLINE_STACK_OFFSET = 0.15;

function isOutlineStack(a: TextBoxAt, b: TextBoxAt): boolean {
  if (a.str !== b.str || a.str.trim() === '') return false;
  const fs = Math.min(a.fs, b.fs);
  if (fs <= 0 || Math.abs(a.fs - b.fs) > 0.1 * Math.max(a.fs, b.fs)) return false;
  const dx = (a.x0 + a.x1) / 2 - (b.x0 + b.x1) / 2;
  const dy = (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2;
  return Math.max(Math.abs(dx), Math.abs(dy)) <= OUTLINE_STACK_OFFSET * fs;
}

interface TextBoxAt {
  li: number;
  label: string;
  /** The painted string — two boxes of one string offset a hair are an outline, not a clash. */
  str: string;
  /**
   * Worst case, not "at rest": base alpha minus its pulse trough (never the
   * `emit` envelope, whose on/off duty cycle is excluded on purpose) times a
   * textBlock's own `opacity`.
   */
  alpha: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Glyph height in px — what an additive layer must out-size to sit under a line. */
  fs: number;
  /** The box's size before the layer `transform` — in the units a layout `gap` is measured in. */
  rawW: number;
  rawH: number;
}

type Box = Pick<TextBoxAt, 'x0' | 'y0' | 'x1' | 'y1' | 'fs'>;

/**
 * Box of one `text` entity, mirroring the renderer: a `font` with a px size is
 * used verbatim (scaled by the same viewport/reference ratio the renderer
 * applies), otherwise the seeded per-entity size; `align`/`baseline` move the
 * anchor; `maxWidth` is a hard cap because `fillText(text, x, y, maxWidth)`
 * squeezes the glyphs to fit.
 */
function textBoxAt(
  s: Extract<LayerSpec['sprite'], { kind: 'text' }>,
  e: Entity,
  p: { x: number; y: number },
  spec: SaverSpec,
  w: number,
  h: number,
): Box {
  const m = s.font ? /(\d{1,5}(?:\.\d{1,4})?|\.\d{1,4})px/.exec(s.font) : null;
  const fontScale = spec.units === 'px' ? 1 : Math.min(w, h) / (spec.referenceViewport ?? LIMITS.referenceViewport);
  const fh = m ? Number(m[1]) * fontScale : e.size;
  const str = s.strings[e.spriteIndex] ?? s.strings[0] ?? '';
  let fw = textWidthEm(str) * fh;
  if (s.maxWidth) fw = Math.min(fw, s.maxWidth * (spec.units === 'px' ? 1 : Math.min(w, h)));
  const align = s.align ?? 'center';
  const baseline = s.baseline ?? 'middle';
  const x0 = align === 'left' ? p.x : align === 'right' ? p.x - fw : p.x - fw / 2;
  const y0 = baseline === 'top' ? p.y : baseline === 'bottom' ? p.y - fh : p.y - fh / 2;
  return { x0, y0, x1: x0 + fw, y1: y0 + fh, fs: fh };
}

/**
 * Box of a `textBlock`, mirroring the renderer: `position` is the block's
 * top-left, lines break with `breakTextBlock`, `align` moves the painted lines
 * inside the `maxWidth` box (not the box itself).
 */
function textBlockBoxAt(
  s: Extract<LayerSpec['sprite'], { kind: 'textBlock' }>,
  p: { x: number; y: number },
  w: number,
  h: number,
): Box {
  const unit = Math.min(w, h);
  const fsPx = s.fontSize * unit;
  const lh = (s.lineHeight ?? 1.4) * fsPx;
  const maxWPx = s.maxWidth * unit;
  const lines = breakTextBlock(textBlockText(s), maxWPx / fsPx, textMetricsClassFor(s.font));
  const maxLineW = lines.reduce((mx, l) => Math.max(mx, l.widthEm), 0) * fsPx;
  const totalH = lines.length * lh;
  const align = s.align ?? 'left';
  const x0 = align === 'center' ? p.x + (maxWPx - maxLineW) / 2 : align === 'right' ? p.x + maxWPx - maxLineW : p.x;
  // Anchor moves the whole block the same way the renderer does (0,0 when absent).
  const { dx, dy } = textBlockAnchorOffset(s, maxWPx, maxLineW, totalH);
  return { x0: x0 + dx, y0: p.y + dy, x1: x0 + dx + maxLineW, y1: p.y + dy + totalH, fs: fsPx };
}

/**
 * Per layer, whether it never shows: its own `opacity`, or its group's, is
 * pinned to 0 — 0 in the base scene and every `timeline` key on that path
 * (and no whole-object key above it) sets 0 too. A glide between zeros stays
 * at zero, so this is exact at every instant, not just at key boundaries,
 * and costs no timeline resolution. Membership is fixed per scene (not
 * steerable or keyable), so a group's pin covers its members. Null when no
 * layer uses `opacity` or `groups` (nothing can be hidden — the common case).
 */
function hiddenLayers(spec: SaverSpec): boolean[] | null {
  if (!spec.groups && !spec.layers.some((l) => l.opacity !== undefined)) return null;
  const tracks = spec.timeline ? timelineTracks(spec) : null;
  const pinnedZero = (path: string, base: unknown, ancestors: string[]): boolean => {
    if (base !== 0) return false;
    if (!tracks) return true;
    for (const [p, keys] of tracks) {
      if (p === path && keys.some((k) => k.value !== 0)) return false;
      if (ancestors.includes(p)) return false; // a whole-object key could set anything
    }
    return true;
  };
  const out = spec.layers.map((l, i) => {
    const lp = `layers.${i}`;
    if (pinnedZero(`${lp}.opacity`, l.opacity, ['layers', lp])) return true;
    const g = l.group !== undefined && spec.groups && Object.prototype.hasOwnProperty.call(spec.groups, l.group) ? spec.groups[l.group] : undefined;
    return !!g && pinnedZero(`groups.${l.group}.opacity`, g.opacity, ['groups', `groups.${l.group}`]);
  });
  return out.some(Boolean) ? out : null;
}

/**
 * Non-blocking advisory warnings for a validated sequence envelope.
 * Checks cross-segment luminance jumps at boundaries and per-segment advisories.
 */
export function adviseSequence(
  seq: IdleSequence,
  viewport = { width: 1920, height: 1080 },
): SpecWarning[] {
  const warnings: SpecWarning[] = [];

  for (let i = 0; i < seq.segments.length; i++) {
    const seg = seq.segments[i]!;
    // A timed segment changes as it plays, so its advisories describe ONE
    // stated moment of it — never a moment past its end. The default sample
    // (COHESION_T, 5 s) used to land beyond a 2 s segment and judge its
    // timeline's final frame while the request asked about another (X418).
    const timed = !!seg.scene.timeline && seg.duration !== undefined;
    const tSample = timed ? Math.min(COHESION_T, seg.duration!) : undefined;
    const segWarnings = adviseSpec(seg.scene, viewport, tSample === undefined ? {} : { t: tSample });
    const at = tSample === undefined ? '' : ` (judged ${(tSample / 1000).toFixed(1)} s into this ${(seg.duration! / 1000).toFixed(1)} s segment)`;
    for (const w of segWarnings) {
      warnings.push({ path: `segments[${i}].scene.${w.path}`, code: w.code, message: w.message + at, boxes: w.boxes });
    }
  }

  // Informational, once per sequence: a fade costs two live segments for
  // `dur`, which the lowest tiers cannot afford, so they play it as a cut.
  // A `fade` on the last segment only ever runs under `loop: true` (it's the
  // wrap's transition into segment 0) — without loop there is no next
  // segment for it to transition into, so it never executes and should not
  // be counted.
  const fadeBound = seq.loop ? seq.segments.length : seq.segments.length - 1;
  const live = (s: { transition?: { type: string } }): boolean => s.transition?.type === 'fade' || s.transition?.type === 'wipe';
  const fades = seq.segments.slice(0, fadeBound).filter(live).length;
  if (fades > 0) {
    const first = seq.segments.slice(0, fadeBound).findIndex(live);
    const wipes = seq.segments.slice(0, fadeBound).some((s) => s.transition?.type === 'wipe');
    warnings.push({
      path: `segments[${first}].transition`,
      code: 'fade-degrades-on-low-tier',
      message: wipes
        ? `informational: ${fades} fade/wipe transition${fades === 1 ? '' : 's'} declared — viewers on the 'basic' or 'minimal' capability tier render them as cuts (two live segments for dur is over that budget); the show still plays`
        : `informational: ${fades} fade transition${fades === 1 ? '' : 's'} declared — viewers on the 'basic' or 'minimal' capability tier render fade as cut (two live segments for dur is over that budget); the show still plays`,
    });
  }

  for (let i = 0; i < seq.segments.length - 1; i++) {
    const tr = seq.segments[i]!.transition;
    // The ground each side of the cut actually shows: the outgoing segment at
    // its end, the incoming at its start (a timeline may end on a different
    // colour than it began; without one these are the scenes themselves).
    // A declared `fade` is the documented remedy — the jump is ramped over
    // `dur`, not cut — so it is not raised there (low tiers that play the
    // fade as a cut are covered by `fade-degrades-on-low-tier`).
    const lumaA = backgroundLuma(resolveTimelineAt(seq.segments[i]!.scene, seq.segments[i]!.duration ?? 0));
    const lumaB = backgroundLuma(resolveTimelineAt(seq.segments[i + 1]!.scene, 0));
    const delta = Math.abs(lumaA - lumaB);
    if (delta > 0.5 && tr?.type !== 'fade' && tr?.type !== 'wipe') {
      warnings.push({
        path: `segments[${i}]`,
        code: 'boundary-luminance-jump',
        message: `background luminance jumps ${delta.toFixed(2)} at boundary ${i}→${i + 1} — may flash on cut; declare transition: { type: 'fade', dur } on segments[${i}] to ramp it`,
      });
    }

    if (tr?.type === 'morph') {
      const sigA = structuralSignature(seq.segments[i]!.scene);
      const sigB = structuralSignature(seq.segments[i + 1]!.scene);
      if (sigA !== sigB) {
        warnings.push({
          path: `segments[${i}].transition`,
          code: 'morph-structural-mismatch',
          message: `segments ${i}→${i + 1} differ structurally: morph will fall back to cut`,
        });
      } else if (!seq.segments[i]!.scene.timeline && !seq.segments[i + 1]!.scene.timeline
        && morphNothingMorphable(seq.segments[i]!.scene, seq.segments[i + 1]!.scene, { textCrossfade: tr.text === 'crossfade' || tr.text === 'dip' })) {
        warnings.push({
          path: `segments[${i}].transition`,
          code: 'morph-nothing-morphable',
          message: `segments ${i}→${i + 1} differ only in values morph cannot interpolate (strings such as textBlock.text step on the first frame): the morph will look like a cut — fade text via colour or reveal.progress`,
        });
      }
    }
  }

  return warnings;
}
