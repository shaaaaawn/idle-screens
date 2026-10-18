// Regenerate IdleScreensTVTests/Fixtures/paths-golden.json — the schema's own
// flattenPath output, which PathDrawingTests pins the Swift port against.
// usage (from apps/ios, after `pnpm --filter @idle-screens/schema build`):
//   node scripts/paths-golden.mjs
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const here = fileURLToPath(new URL('.', import.meta.url));
const { flattenPath } = await import(new URL('../../../packages/schema/dist/index.js', import.meta.url));

const c = (r, x = 0, y = 0) => `M ${x - r} ${y} A ${r} ${r} 0 1 1 ${x + r} ${y} A ${r} ${r} 0 1 1 ${x - r} ${y} Z`;
const cases = [
  ['circle-arc', c(1), 'auto'],
  ['cubic-blob', 'M 0 -0.9 C 0.56 -0.9 0.72 -0.36 0.56 0.04 C 0.46 0.3 0.22 0.44 0.13 0.54 L -0.13 0.54 C -0.22 0.44 -0.46 0.3 -0.56 0.04 C -0.72 -0.36 -0.56 -0.9 0 -0.9 Z', 'auto'],
  ['relative-smooth-implicit', 'm0-.8c.4 0 .8.4.8.8s-.4.8-.8.8-.8-.4-.8-.8.4-.8.8-.8z', 'auto'],
  ['quad-T-HV', 'M -0.8 0 Q -0.6 -0.5 -0.4 0 T 0 0 T 0.4 0 H 0.8 V 0.5 H -0.8 Z', 'auto'],
  ['arc-flags-compact', 'M -0.5 0 a.5.5 0 011 0 Z', 'auto'],
  ['square-hole', 'M -1 -1 H 1 V 1 H -1 Z M -0.5 -0.5 H 0.5 V 0.5 H -0.5 Z', 'auto'],
  ['island', 'M -1 -1 H 1 V 1 H -1 Z M -0.5 -0.5 H 0.5 V 0.5 H -0.5 Z M -0.2 -0.2 H 0.2 V 0.2 H -0.2 Z', 'auto'],
  ['overlap-merge', 'M -1 -1 L 0.4 -1 L 0.4 0.4 L -1 0.4 Z M 0 0 L 1 0 L 1 1 L 0 1 Z', 'auto'],
  ['seam-window', 'M -1 0 L 1 0 L 1 1 L -1 1 Z M -0.5 -1 L 0.5 -1 L 0.5 0.3 L -0.5 0.3 Z M -0.1 -0.1 L 0.1 -0.1 L 0.1 0.2 L -0.1 0.2 Z', 'auto'],
  ['nested-holes-bar', `${c(0.85)} ${c(0.7)} ${c(0.45)} ${c(0.35)} M -0.05 -1 L 0.05 -1 L 0.05 1 L -0.05 1 Z`, 'auto'],
  ['evenodd-rosette', [0, 1, 2, 3, 4, 5].map((i) => c(0.3, 0.3 * Math.cos((i * Math.PI) / 3), 0.3 * Math.sin((i * Math.PI) / 3))).join(' '), 'evenodd'],
  ['nonzero-as-drawn', 'M -1 -1 L 1 -1 L 1 1 L -1 1 Z M -0.5 -0.5 L 0.5 -0.5 L 0.5 0.5 L -0.5 0.5 Z', 'nonzero'],
  ['open-lines', 'M -0.8 0 C -0.4 -0.6 0.4 0.6 0.8 0 M -0.5 0.5 L 0.5 0.5', 'auto'],
];
const out = cases.map(([name, d, rule]) => {
  const f = flattenPath(d, rule);
  return { name, d, rule, subpaths: f.subpaths, points: f.points, lines: f.lines, error: f.error ?? null };
});
writeFileSync(`${here}../IdleScreensTVTests/Fixtures/paths-golden.json`, JSON.stringify(out));
console.log(`wrote ${out.length} cases`);
