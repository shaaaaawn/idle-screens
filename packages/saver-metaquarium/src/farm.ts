import type { Rng } from '@idle-screens/core';

/** OpenSea-style farm metadata entry (subset the tank reads). */
export interface FarmFish {
  name?: string;
  external_url?: string;
  '3d'?: string;
  attributes?: Array<{ trait_type?: string; value?: unknown }>;
}

/** `ipfs://<path>` → gateway URL; anything else passes through untouched. */
export function resolveAssetUrl(asset: string, gateway: string): string {
  if (!asset.startsWith('ipfs://')) return asset;
  const g = gateway.endsWith('/') ? gateway : `${gateway}/`;
  return g + asset.slice('ipfs://'.length);
}

/** Token id from farm metadata (external_url tail, else digits in the name). */
export function tokenOf(f: FarmFish): string {
  const tail = f.external_url?.split('/').pop();
  if (tail && /^\d+$/.test(tail)) return tail;
  return /\d+/.exec(f.name ?? '')?.[0] ?? '';
}

/** Extract the metadata array from either a bare array or the farm envelope
 *  `{message: {metadata: [...]}}`. */
export function farmMetadata(raw: unknown): FarmFish[] {
  if (Array.isArray(raw)) return raw as FarmFish[];
  const meta = (raw as { message?: { metadata?: FarmFish[] } } | null)?.message?.metadata;
  return Array.isArray(meta) ? meta : [];
}

/**
 * Choose the tank's population. Explicit `tokens` pin exact fish; otherwise a
 * seeded Fisher-Yates shuffle makes "which fish live in this tank" a pure
 * function of the rng stream. Fish without a `3d` model are skipped.
 */
export function pickFarmFish(
  meta: FarmFish[],
  tokens: string[],
  rng: Rng,
  max: number,
): FarmFish[] {
  const withModel = meta.filter((f) => typeof f['3d'] === 'string');
  let picked: FarmFish[];
  if (tokens.length > 0) {
    picked = withModel.filter((f) => tokens.includes(tokenOf(f)));
  } else {
    picked = [...withModel];
    for (let i = picked.length - 1; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      [picked[i], picked[j]] = [picked[j]!, picked[i]!];
    }
  }
  return picked.slice(0, max);
}
