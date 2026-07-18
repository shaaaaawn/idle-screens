import { createRng } from '@idle-screens/core';
import { buildEntities } from './simulate';
import type { SaverSpec, SpecWarning } from './types';

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
  const rng = createRng(spec.seed ?? 42);
  const allEntities = spec.layers.map((l) => buildEntities(l, rng, w, h, scale));

  let totalEntities = 0;
  let textLayerCount = 0;
  let motionLayerCount = 0;

  for (let li = 0; li < spec.layers.length; li++) {
    const layer = spec.layers[li]!;
    const entities = allEntities[li]!;
    totalEntities += entities.length;

    const isText = layer.sprite.kind === 'text';
    const isEmoji = layer.sprite.kind === 'emoji';
    const isStaticText = isText && layer.motion.type === 'static';
    if (isStaticText) textLayerCount++;
    if (layer.motion.type !== 'static') motionLayerCount++;

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

  return warnings;
}
