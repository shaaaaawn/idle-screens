/**
 * The flora's vocabulary, with no three.js: the species, each room's own
 * garden, and the `floraMix` parser. The package entry re-exports guide.ts,
 * which validates `floraMix`, and anything guide.ts imports lands on EVERY
 * path — including the Apple TV's Canvas2D tank, which must never load three
 * (e2e MQ10). The builders live in flora.ts.
 */

export type FloraSpecies =
  | 'grass' | 'tube' | 'bulb' | 'fan' | 'kelp'
  | 'anemone' | 'staghorn' | 'brain' | 'whip' | 'barrel' | 'shelf' | 'seapen' | 'clam'
  | 'bubble' | 'elder' | 'curl' | 'pod';
export const FLORA_SPECIES: readonly FloraSpecies[] = [
  'grass', 'tube', 'bulb', 'fan', 'kelp', 'anemone', 'staghorn', 'brain', 'whip', 'barrel', 'shelf', 'seapen', 'clam',
  'bubble', 'elder', 'curl', 'pod',
];

/** The default garden in each room, as weights (anything unnamed does not grow there). */
export const FLORA_BY_ENVIRONMENT: Readonly<Partial<Record<string, Partial<Record<FloraSpecies, number>>>>> = {
  reef: { grass: 0.1, fan: 0.12, staghorn: 0.14, brain: 0.12, anemone: 0.12, tube: 0.08, barrel: 0.08, kelp: 0.04, whip: 0.08, clam: 0.03, seapen: 0.03, bulb: 0.03, shelf: 0.02, bubble: 0.05, elder: 0.015, pod: 0.03 },
  kelp: { kelp: 0.34, grass: 0.22, whip: 0.12, seapen: 0.08, bulb: 0.06, fan: 0.06, anemone: 0.06, shelf: 0.03, tube: 0.03, elder: 0.015, curl: 0.1 },
  vent: { tube: 0.26, barrel: 0.14, anemone: 0.14, shelf: 0.14, grass: 0.1, whip: 0.08, brain: 0.06, bulb: 0.08, pod: 0.06 },
  ice: { whip: 0.18, seapen: 0.14, anemone: 0.12, grass: 0.2, brain: 0.08, fan: 0.1, kelp: 0.1, tube: 0.05, clam: 0.03, bubble: 0.03 },
  lagoon: { grass: 0.22, brain: 0.12, staghorn: 0.12, anemone: 0.12, fan: 0.1, kelp: 0.08, whip: 0.08, tube: 0.05, barrel: 0.04, clam: 0.05, bubble: 0.07, elder: 0.02, curl: 0.06 },
  abyss: { shelf: 0.2, bulb: 0.18, seapen: 0.16, anemone: 0.12, tube: 0.12, grass: 0.1, whip: 0.06, kelp: 0.06, elder: 0.02, pod: 0.1, curl: 0.06 },
  universe: { shelf: 0.18, bulb: 0.18, seapen: 0.14, anemone: 0.12, tube: 0.1, grass: 0.1, kelp: 0.1, fan: 0.08, elder: 0.03, pod: 0.12, curl: 0.1 },
};

/**
 * `floraMix`: `species[:weight]`, comma-separated — `kelp:3, anemone, clam:0.5`.
 * Weights are relative; a bare name is 1. Empty = the room's own garden.
 */
export function parseFloraMix(src: string): { mix: Partial<Record<FloraSpecies, number>>; problems: string[] } {
  const mix: Partial<Record<FloraSpecies, number>> = {}, problems: string[] = [];
  for (const raw of src.split(',')) {
    const part = raw.trim();
    if (!part) continue;
    const m = /^([a-z]+)\s*(?::\s*([0-9]+(?:\.[0-9]+)?|\.[0-9]+))?$/i.exec(part);
    const name = m?.[1]?.toLowerCase() as FloraSpecies | undefined;
    if (!m || !name || !(FLORA_SPECIES as readonly string[]).includes(name)) {
      problems.push(`"${part}": expected species[:weight] with species one of ${FLORA_SPECIES.join(', ')}`);
      continue;
    }
    const w = m[2] === undefined ? 1 : Number(m[2]), sum = (mix[name] ?? 0) + w;
    // "kelp:1e400" parses as Infinity, and one infinite weight would make the
    // whole garden that species.
    if (!Number.isFinite(sum)) {
      problems.push(`"${part}": weight too large`);
      continue;
    }
    mix[name] = sum;
  }
  return { mix, problems };
}


/** `#rrggbb` from hue, saturation, lightness (0..1) — no three.js here. */
function hsl(h: number, sat: number, l: number): string {
  const f = (n: number): number => {
    const k = (n + h * 12) % 12, a = sat * Math.min(l, 1 - l);
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return '#' + [f(0), f(8), f(4)].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
}

/**
 * A world palette from one number in [0, 1): a hero hue, its neighbour and a
 * split complement — the way a No Man's Sky planet is magenta grass and
 * orange trees, one bold scheme rather than every colour at once.
 */
export function worldPalette(u: number): string[] {
  const h = ((u % 1) + 1) % 1;
  return [hsl(h, 0.78, 0.56), hsl((h + 0.07) % 1, 0.7, 0.62), hsl((h + 0.47) % 1, 0.8, 0.55)];
}

/**
 * `floraPalette`: empty = every species its own colours; `world` = a scheme
 * grown from the scene's seed; or up to six `#rrggbb`, comma-separated.
 */
export function parseFloraPalette(src: string, seed01 = 0): { palette: string[] | undefined; problems: string[] } {
  const t = src.trim();
  if (!t) return { palette: undefined, problems: [] };
  if (t.toLowerCase() === 'world') return { palette: worldPalette(seed01), problems: [] };
  const palette: string[] = [], problems: string[] = [];
  for (const raw of t.split(',')) {
    const c = raw.trim();
    if (!c) continue;
    if (/^#[0-9a-f]{6}$/i.test(c) && palette.length < 6) palette.push(c.toLowerCase());
    else problems.push(`"${c}": expected world, or up to six #rrggbb`);
  }
  return { palette: palette.length ? palette : undefined, problems };
}
