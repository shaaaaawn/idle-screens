import { createRng } from '@idle-screens/core';
import { buildEntities, linkPairs, positionAt } from './simulate';
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
  const scale = spec.units === 'viewport' ? Math.min(w, h) : 1;
  const countScale = scale > 1 ? Math.min(w, h) / LIMITS.referenceViewport : 1;
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

  // Link starvation: links layer where few edges actually form
  for (let li = 0; li < spec.layers.length; li++) {
    const layer = spec.layers[li]!;
    if (!layer.links) continue;
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

  // Composition balance: entities clustered in one region
  if (totalEntities >= 8) {
    const positions = allEntities.flatMap((ents) => ents.map((e) => positionAt(e, 0, w, h)));
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
