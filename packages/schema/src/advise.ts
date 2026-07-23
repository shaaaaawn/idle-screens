import { createRng } from '@idle-screens/core';
import { buildEntities, linkEdges, linkPairs, positionAt } from './simulate';
import { LIMITS, type SaverSpec, type SpecWarning } from './types';

/**
 * Non-blocking advisory warnings for a valid spec. Does NOT replace validateSpec —
 * call advise only on specs that have already passed validation.
 */
export function adviseSpec(
  spec: SaverSpec,
  viewport = { width: 1920, height: 1080 },
): SpecWarning[] {
  const warnings: SpecWarning[] = [];
  const w = viewport.width;
  const h = viewport.height;
  const scale = spec.units === 'px' ? 1 : Math.min(w, h);
  const refVp = spec.referenceViewport ?? LIMITS.referenceViewport;
  const countScale = scale > 1 ? Math.min(w, h) / refVp : 1;
  const rng = createRng(spec.seed ?? 42);
  const allEntities = spec.layers.map((l) => buildEntities(l, rng, w, h, scale, countScale));

  let totalEntities = 0;
  let textLayerCount = 0;
  let motionLayerCount = 0;

  for (let li = 0; li < spec.layers.length; li++) {
    const layer = spec.layers[li]!;
    const entities = allEntities[li]!;
    totalEntities += entities.length;

    const isText = layer.sprite.kind === 'text';
    const isStaticText = isText && layer.motion.type === 'static';
    if (isStaticText) textLayerCount++;
    if (layer.motion.type !== 'static') motionLayerCount++;

    if (layer.trail && layer.motion.type === 'static') {
      warnings.push({
        path: `layers[${li}].trail`,
        code: 'trail-on-static',
        message: 'trail has no effect on static entities — they have no past positions to draw',
      });
    }

    if (layer.sprite.kind === 'streak' && layer.motion.type === 'static') {
      warnings.push({
        path: `layers[${li}].sprite`,
        code: 'streak-on-static',
        message: 'streak sprites orient along the motion heading — static entities have none and will render at angle 0',
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

  }

  // Alpha-weighted pixel coverage: how much of the viewport is "visibly filled"
  let totalCoverage = 0;
  for (let li = 0; li < spec.layers.length; li++) {
    const layer = spec.layers[li]!;
    const entities = allEntities[li]!;
    for (const e of entities) {
      const r = e.size / 2;
      const pixArea = layer.sprite.kind === 'circle'
        ? Math.PI * r * r
        : e.size * e.size; // text/emoji: approximate as square of font size
      totalCoverage += (pixArea * e.alpha) / (w * h);
    }
    // Link lines are visual coverage too (for Mystify-style scenes they ARE the scene).
    if (layer.links) {
      const positions = entities.map((e) => positionAt(e, 0, w, h));
      const maxDistPx = layer.links.maxDist * scale;
      const edges = linkEdges(layer.links, positions, maxDistPx, layer.wrap !== false, w, h);
      const lwPx = (layer.links.width ?? 1) * scale;
      const la = layer.links.alpha ?? 1;
      for (const edge of edges) totalCoverage += (edge.dist * lwPx * la) / (w * h);
    }
  }

  if (totalCoverage < 0.0005 && spec.layers.length > 0) {
    warnings.push({
      path: 'layers',
      code: 'sparse-scene',
      message: `alpha-weighted coverage is ${(totalCoverage * 100).toFixed(4)}% — scene will look empty on most displays`,
    });
  }

  if (totalEntities > 500) {
    warnings.push({
      path: 'layers',
      code: 'dense-scene',
      message: `${totalEntities} entities — scene may feel crowded and hurt performance on low-end devices`,
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

  // Link starvation: links layer where few edges actually form.
  // Chain mode always forms its edges — only distance-gated modes can starve.
  for (let li = 0; li < spec.layers.length; li++) {
    const layer = spec.layers[li]!;
    if (!layer.links || layer.links.mode === 'chain') continue;
    const entities = allEntities[li]!;
    const positions = entities.map((e) => positionAt(e, 0, w, h));
    const maxDist = layer.links.maxDist * scale;
    const pairs = linkPairs(positions, layer.links.k, maxDist, layer.wrap !== false, w, h);
    const maxPossible = Math.min(entities.length * layer.links.k, entities.length * (entities.length - 1) / 2);
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
    .map((l, li) => ({ l, ents: allEntities[li]! }))
    .filter(({ l }) => !['bounce', 'warp', 'path'].includes(l.motion.type))
    // Layer-parented orbits position relative to their parent (resolved at render
    // time) — their raw positionAt is an offset around (0,0), not a screen position.
    .filter(({ l }) => !(l.motion.type === 'orbit' && l.motion.center && 'layer' in l.motion.center));
  const composedCount = composed.reduce((s, c) => s + c.ents.length, 0);
  if (composedCount >= 8) {
    const positions = composed.flatMap(({ ents }) => ents.map((e) => positionAt(e, 0, w, h)));
    const cx = positions.reduce((s, p) => s + p.x, 0) / positions.length;
    const cy = positions.reduce((s, p) => s + p.y, 0) / positions.length;
    const offX = Math.abs(cx / w - 0.5);
    const offY = Math.abs(cy / h - 0.5);
    if (offX > 0.2 || offY > 0.2) {
      warnings.push({
        path: 'layers',
        code: 'off-center',
        message: `centroid at (${(cx / w).toFixed(2)}, ${(cy / h).toFixed(2)}) — composition is heavily offset from center`,
      });
    }
  }

  return warnings;
}
