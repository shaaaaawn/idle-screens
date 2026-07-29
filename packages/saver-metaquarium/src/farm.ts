import type { Rng } from '@idle-screens/core';

/**
 * One fish from the Metaquarium farm cache (OpenSea-style metadata). The
 * envelope carries a full media ladder per fish — the 3D model plus 2D and
 * video renditions — which is what lets low-fidelity clients show the same
 * fish without three.js.
 */
export interface FarmFish {
  name?: string;
  external_url?: string;
  token_id?: number;
  owner_of?: string;
  /** GLB model URL (usually `ipfs://`). The primary, high-fidelity asset. */
  '3d'?: string;
  /** Full render (jpg/png, usually `ipfs://`). Poster / OG art. */
  image?: string;
  /** Transparent-background PNG — sprite/billboard LOD material. */
  transparent_icon?: string;
  /** Tiny icon — channel favicon material. */
  favicon?: string;
  /** 512px MP4 loop — mid-fidelity moving rendition. */
  video_512?: string;
  attributes?: Array<{ trait_type?: string; value?: unknown }>;
}

/** `ipfs://<path>` → gateway URL; anything else passes through untouched. */
export function resolveAssetUrl(asset: string, gateway: string): string {
  if (!asset.startsWith('ipfs://')) return asset;
  const g = gateway.endsWith('/') ? gateway : `${gateway}/`;
  return g + asset.slice('ipfs://'.length);
}

/** Token id from farm metadata (`token_id`, else external_url tail, else digits in the name). */
export function tokenOf(f: FarmFish): string {
  if (typeof f.token_id === 'number') return String(f.token_id);
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

/** Resolve the hero fish's model URL by token: find it in the farm metadata
 *  and route its `3d` asset through the gateway; `fallback` (the bundled
 *  hero) when the token is missing or has no model. Pure — the tank's live
 *  fish-swap resolves through this. */
export function heroUrlFor(
  meta: FarmFish[],
  token: string,
  gateway: string,
  fallback: string,
): string {
  const fish = meta.find((f) => tokenOf(f) === token);
  const asset = fish?.['3d'];
  return typeof asset === 'string' ? resolveAssetUrl(asset, gateway) : fallback;
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
