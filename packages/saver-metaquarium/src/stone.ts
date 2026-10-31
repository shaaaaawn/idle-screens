/**
 * The world's stone, two ways (`stoneStyle`).
 *
 *   classic    slate, dark toward the buried base: the stone as it always was
 *   weathered  river-grey — lifted out of the black, each facet a shade of its
 *              own, silt settled on whatever faces up — so a boulder or a home
 *              in a lit room reads as stone, not as a hole in the picture
 *
 * Used by the free rocks and arches (rocks.ts), the homes and the castle keep
 * (geode.ts). A recolouring of what was painted; it draws nothing from the
 * rng, so no seeded layout moves.
 */

import { Color, type Vector3 } from 'three';

export type StoneStyle = 'classic' | 'weathered';
export const STONE_STYLES: readonly StoneStyle[] = ['classic', 'weathered'];

const SILT = new Color('#a89f8c');
/** The light the water gives stone from every side (linear): what keeps a face turned from the key out of the black. */
const AMBIENT = new Color().setRGB(0.06, 0.065, 0.075);

/**
 * A weathered stone's colour from its classic one: ×1.7 with a ±8% shade per
 * facet (a hash of where the facet is), plus the water's ambient — a face
 * turned from the key light is slate, not black — and silt on faces turned
 * up (`ny`, the world normal's y, from 0.5 to 0.9).
 */
export function weathered(c: Color, ny: number, facet: Vector3): Color {
  const h = Math.sin(facet.x * 12.9898 + facet.y * 78.233 + facet.z * 37.719) * 43758.5453;
  const jitter = 0.92 + 0.16 * (h - Math.floor(h));
  c.multiplyScalar(1.7 * jitter).add(AMBIENT);
  const t = Math.max(0, Math.min(1, (ny - 0.5) / 0.4));
  return c.lerp(SILT, 0.5 * t * t * (3 - 2 * t));
}
