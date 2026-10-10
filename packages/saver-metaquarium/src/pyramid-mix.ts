/**
 * The pyramids' names and their mix string — three-free, so the package entry
 * can validate `pyramidMix` (guide.ts) without pulling three.js in.
 */

export const PYRAMID_SHAPES = ['giza', 'step', 'bent', 'djoser', 'mayan', 'frame', 'octa'] as const;
export type PyramidShape = (typeof PYRAMID_SHAPES)[number];

/** Materials: main, alt, accent (glyphs, speckle, veins) and the capstone's colour; and the motif. */
export const PYRAMID_MATERIALS = {
  sandstone: { pal: ['#d4ab6a', '#b98f50', '#6e4426', '#ffd86b'], bands: 6, speckle: 0, veins: 0, nacre: 0, glow: 0.5 },
  limestone: { pal: ['#e8e1cc', '#d2c9ae', '#9a8b62', '#ffe08a'], bands: 0, speckle: 0, veins: 0, nacre: 0, glow: 0.6 },
  obsidian: { pal: ['#2a2238', '#191424', '#a17bff', '#c9a6ff'], bands: 5, speckle: 0, veins: 1, nacre: 0, glow: 0.9 },
  jade: { pal: ['#3e9e78', '#2b7a5a', '#c6f5dc', '#9ff0c8'], bands: 4, speckle: 0, veins: 0, nacre: 0, glow: 0.5 },
  gold: { pal: ['#e2ad36', '#c48c1e', '#7a4a0e', '#fff3b0'], bands: 7, speckle: 0, veins: 0, nacre: 0, glow: 0.8 },
  lapis: { pal: ['#2a4aa8', '#1d347d', '#e8c25a', '#ffd86b'], bands: 3, speckle: 0, veins: 0, nacre: 0, glow: 0.6 },
  coral: { pal: ['#c9a37a', '#a9825a', '#ff6f61', '#ff9ad5'], bands: 0, speckle: 0.32, veins: 0, nacre: 0, glow: 0.4 },
  crystal: { pal: ['#49cfff', '#2b8fd6', '#e6fbff', '#bff3ff'], bands: 0, speckle: 0, veins: 1, nacre: 0.35, glow: 1 },
  nacre: { pal: ['#efe6f0', '#d8cfe8', '#ffd1f0', '#ffffff'], bands: 0, speckle: 0, veins: 0, nacre: 1, glow: 0.7 },
  basalt: { pal: ['#3b3f45', '#2c3035', '#5fae55', '#8fd16a'], bands: 0, speckle: 0.42, veins: 0, nacre: 0, glow: 0.3 },
} as const;
export type PyramidMaterial = keyof typeof PYRAMID_MATERIALS;
export const PYRAMID_MATERIAL_NAMES = Object.keys(PYRAMID_MATERIALS) as PyramidMaterial[];

/** The room chooses the stone, unless `pyramidMix` names some. */
export const PYRAMID_STONES_BY_ENVIRONMENT: Record<string, Partial<Record<PyramidMaterial, number>>> = {
  reef: { coral: 3, sandstone: 2, limestone: 1, jade: 1, gold: 0.5 },
  kelp: { basalt: 3, jade: 2, sandstone: 1, coral: 0.5 },
  lagoon: { limestone: 3, sandstone: 3, gold: 1, lapis: 1 },
  ice: { crystal: 3, nacre: 2, limestone: 1 },
  abyss: { obsidian: 3, crystal: 2, gold: 0.5, basalt: 1 },
  vent: { obsidian: 3, basalt: 2, gold: 1 },
  universe: { obsidian: 2, crystal: 2, nacre: 1, gold: 1 },
  void: { sandstone: 2, limestone: 2, obsidian: 1, jade: 1, gold: 0.6, lapis: 0.6, crystal: 0.6, nacre: 0.4, coral: 0.4, basalt: 0.4 },
};

/** `pyramidMix`: shapes and stones, each with an optional weight — `giza:3,mayan,gold:2,obsidian`. */
export function parsePyramidMix(src: string): { shapes: Partial<Record<PyramidShape, number>>; materials: Partial<Record<PyramidMaterial, number>>; problems: string[] } {
  const shapes: Partial<Record<PyramidShape, number>> = {}, materials: Partial<Record<PyramidMaterial, number>> = {}, problems: string[] = [];
  for (const raw of src.split(',')) {
    const part = raw.trim();
    if (!part) continue;
    const m = /^([a-z]+)\s*(?::\s*([0-9]+(?:\.[0-9]+)?|\.[0-9]+))?$/i.exec(part);
    const name = m?.[1]?.toLowerCase() ?? '';
    const w = m?.[2] !== undefined ? Number(m[2]) : 1;
    if (m && (PYRAMID_SHAPES as readonly string[]).includes(name)) shapes[name as PyramidShape] = (shapes[name as PyramidShape] ?? 0) + w;
    else if (m && name in PYRAMID_MATERIALS) materials[name as PyramidMaterial] = (materials[name as PyramidMaterial] ?? 0) + w;
    else problems.push(`"${part}": expected a shape (${PYRAMID_SHAPES.join(', ')}) or a stone (${PYRAMID_MATERIAL_NAMES.join(', ')}), with an optional :weight`);
  }
  return { shapes, materials, problems };
}
