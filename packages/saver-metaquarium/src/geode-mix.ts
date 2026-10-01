/**
 * The wild geodes' vocabulary, with no three.js (the package entry reaches
 * it through guide.ts, on the Apple TV's 2D path too): the kinds, the
 * minerals, and the `geodeMix` / `geodeMineral` parsers. Builders: geodes.ts.
 */

/** Few, and each made well: a split geode (sometimes a thunder egg), a standing cathedral, a crystal cluster, and the mega cavern. */
export type GeodeKind = 'geode' | 'cathedral' | 'cluster' | 'cavern';
export const GEODE_KINDS: readonly GeodeKind[] = ['geode', 'cathedral', 'cluster', 'cavern'];

export type MineralName = 'amethyst' | 'agate' | 'celestine' | 'citrine' | 'carnelian' | 'rose' | 'emerald' | 'quartz' | 'smoky';
export const MINERALS: readonly MineralName[] = ['amethyst', 'agate', 'celestine', 'citrine', 'carnelian', 'rose', 'emerald', 'quartz', 'smoky'];

/** `geodeMix`: `kind[:weight]`, comma-separated — `geode:3, cathedral, cluster`. Empty = the default spread. */
export function parseGeodeMix(src: string): { mix: Partial<Record<GeodeKind, number>>; problems: string[] } {
  const mix: Partial<Record<GeodeKind, number>> = {}, problems: string[] = [];
  for (const raw of src.split(',')) {
    const part = raw.trim();
    if (!part) continue;
    const m = /^([a-z]+)\s*(?::\s*([0-9]*\.?[0-9]+))?$/i.exec(part);
    const name = m?.[1]?.toLowerCase() as GeodeKind | undefined;
    if (!m || !name || !(GEODE_KINDS as readonly string[]).includes(name)) {
      problems.push(`"${part}": expected kind[:weight] with kind one of ${GEODE_KINDS.join(', ')}`);
      continue;
    }
    mix[name] = (mix[name] ?? 0) + (m[2] === undefined ? 1 : Number(m[2]));
  }
  return { mix, problems };
}

/**
 * `geodeMineral`: empty = every mineral, by how common it is; `world` = two
 * minerals chosen from the seed (one world, one scheme, as No Man's Sky
 * would have it); or a comma-separated list of minerals.
 */
export function parseGeodeMineral(src: string, seed01 = 0): { minerals: MineralName[] | undefined; problems: string[] } {
  const t = src.trim().toLowerCase();
  if (!t) return { minerals: undefined, problems: [] };
  if (t === 'world') {
    const i = Math.floor((((seed01 % 1) + 1) % 1) * MINERALS.length);
    const j = (i + 1 + Math.floor((((seed01 * 7.31) % 1) + 1) % 1 * (MINERALS.length - 1))) % MINERALS.length;
    return { minerals: [MINERALS[i]!, MINERALS[j]!], problems: [] };
  }
  const minerals: MineralName[] = [], problems: string[] = [];
  for (const raw of t.split(',')) {
    const name = raw.trim();
    if (!name) continue;
    if ((MINERALS as readonly string[]).includes(name)) { if (!minerals.includes(name as MineralName)) minerals.push(name as MineralName); }
    else problems.push(`"${name}": expected world, or minerals from ${MINERALS.join(', ')}`);
  }
  return { minerals: minerals.length ? minerals : undefined, problems };
}
