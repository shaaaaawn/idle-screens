import { createRng } from '@idle-screens/core';
import { buildEntities, linkPairs, positionAt } from './simulate';
import { LIMITS, type SaverSpec } from './types';

export interface LayerSnapshot {
  key: string | undefined;
  count: number;
  centroid: { x: number; y: number };
  coverage: number;
  meanAlpha: number;
  linksDrawn: number | null;
  linksExpected: number | null;
  connectedComponents: number | null;
  isolatedNodes: number | null;
}

export interface SceneSnapshot {
  t: number;
  viewport: { w: number; h: number };
  layers: LayerSnapshot[];
  warnings: string[];
}

export interface SceneDescription {
  spec: { id: string; label: string; units: string };
  snapshots: SceneSnapshot[];
}

/**
 * Deterministic scene analysis at one or more time values. Reuses `buildEntities`
 * and `linkPairs` — no render needed. Returns structured data a non-vision model
 * can use to understand what a spec looks like when rendered.
 */
export function describeScene(
  spec: SaverSpec,
  options: {
    viewport?: { width: number; height: number };
    seed?: number;
    times?: number[];
  } = {},
): SceneDescription {
  const { width: w, height: h } = options.viewport ?? { width: 1920, height: 1080 };
  const seed = options.seed ?? spec.seed ?? 42;
  const times = options.times ?? [0, 5000, 15000];
  const scale = spec.units === 'viewport' ? Math.min(w, h) : 1;
  const refVp = spec.referenceViewport ?? LIMITS.referenceViewport;
  const countScale = scale > 1 ? Math.min(w, h) / refVp : 1;

  const rng = createRng(seed);
  const builtLayers = spec.layers.map((layer) => ({
    layer,
    entities: buildEntities(layer, rng, w, h, scale, countScale),
  }));

  const snapshots: SceneSnapshot[] = times.map((t) => {
    const layerSnapshots: LayerSnapshot[] = builtLayers.map(({ layer, entities }) => {
      const positions = entities.map((e) => positionAt(e, t, w, h));
      const cx = positions.length > 0 ? positions.reduce((s, p) => s + p.x, 0) / positions.length : 0;
      const cy = positions.length > 0 ? positions.reduce((s, p) => s + p.y, 0) / positions.length : 0;

      // Coverage: fraction of viewport area covered by entity bounding circles
      let pixArea = 0;
      for (const e of entities) {
        const r = e.size / 2;
        pixArea += layer.sprite.kind === 'circle' ? Math.PI * r * r : e.size * e.size;
      }
      const coverage = pixArea / (w * h);
      const meanAlpha = entities.length > 0
        ? entities.reduce((s, e) => s + e.alpha, 0) / entities.length
        : 0;

      // Link analysis
      let linksDrawn: number | null = null;
      let linksExpected: number | null = null;
      let connectedComponents: number | null = null;
      let isolatedNodes: number | null = null;
      if (layer.links) {
        const maxDist = layer.links.maxDist * scale;
        const pairs = linkPairs(positions, layer.links.k, maxDist, layer.wrap !== false, w, h);
        linksDrawn = pairs.length;
        linksExpected = Math.min(entities.length * layer.links.k, entities.length * (entities.length - 1) / 2);
        // Connected components via union-find
        const parent = Array.from({ length: entities.length }, (_, i) => i);
        const find = (x: number): number => {
          while (parent[x] !== x) { parent[x] = parent[parent[x]!]!; x = parent[x]!; }
          return x;
        };
        for (const [a, b] of pairs) {
          const ra = find(a); const rb = find(b);
          if (ra !== rb) parent[ra] = rb;
        }
        const roots = new Set(entities.map((_, i) => find(i)));
        connectedComponents = roots.size;
        // Isolated = nodes with zero edges
        const degree = new Uint16Array(entities.length);
        for (const [a, b] of pairs) { degree[a]!++; degree[b]!++; }
        isolatedNodes = degree.filter((d) => d === 0).length;
      }

      return {
        key: layer.key,
        count: entities.length,
        centroid: { x: +(cx / w).toFixed(3), y: +(cy / h).toFixed(3) },
        coverage: +coverage.toFixed(4),
        meanAlpha: +meanAlpha.toFixed(3),
        linksDrawn,
        linksExpected,
        connectedComponents,
        isolatedNodes,
      };
    });

    // Warnings derived from the numbers
    const warnings: string[] = [];
    for (const ls of layerSnapshots) {
      const label = ls.key ?? `layer`;
      if (ls.coverage * ls.meanAlpha < 0.0005) {
        warnings.push(`${label}: effectively invisible (coverage×alpha=${(ls.coverage * ls.meanAlpha).toFixed(5)})`);
      }
      if (ls.linksDrawn !== null && ls.linksExpected !== null && ls.linksExpected > 0) {
        const ratio = ls.linksDrawn / ls.linksExpected;
        if (ratio < 0.1) {
          warnings.push(`${label}: link starvation — ${ls.linksDrawn}/${ls.linksExpected} edges formed`);
        }
      }
      if (ls.isolatedNodes !== null && ls.count > 0 && ls.isolatedNodes / ls.count > 0.5) {
        warnings.push(`${label}: ${ls.isolatedNodes}/${ls.count} nodes isolated — graph is disconnected`);
      }
    }

    return { t, viewport: { w, h }, layers: layerSnapshots, warnings };
  });

  return {
    spec: { id: spec.id, label: spec.label, units: spec.units ?? 'px' },
    snapshots,
  };
}
