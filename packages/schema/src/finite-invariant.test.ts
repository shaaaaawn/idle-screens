import { it } from 'vitest';
import { createRng } from '@idle-screens/core';
import { buildEntities, positionAt, sizeAt, alphaAt } from './simulate';
import { EXAMPLE_SPECS } from './examples/index';

// Guards the analytic invariant end-to-end: every bundled example must produce
// finite positions/sizes/alphas at every sampled time — a NaN here becomes a
// crashed canvas call (e.g. createRadialGradient throws on non-finite input).
it('no example ever produces a non-finite position/size/alpha', () => {
  const W = 1920, H = 1080;
  for (const spec of EXAMPLE_SPECS) {
    const rng = createRng((spec.seed ?? 42) >>> 0 || 1);
    const scale = spec.units === 'px' ? 1 : Math.min(W, H);
    for (const [li, layer] of spec.layers.entries()) {
      const ents = buildEntities(layer as never, rng, W, H, scale, 1);
      for (const [ei, e] of ents.entries()) {
        for (let t = 0; t <= 120000; t += 313) {
          const p = positionAt(e, t, W, H);
          const s = sizeAt(e, t);
          const a = alphaAt(e, t);
          if (![p.x, p.y, s, a].every(Number.isFinite)) {
            throw new Error(`${spec.id} layer ${li} (${(layer as {key?:string}).key}) entity ${ei} t=${t}: x=${p.x} y=${p.y} size=${s} alpha=${a} entity=${JSON.stringify(e)}`);
          }
        }
      }
    }
  }
});
