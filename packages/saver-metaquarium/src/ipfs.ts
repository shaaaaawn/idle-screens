/** Ordered gateway candidates. dweb.link stays primary (flaky but usually
 *  fast); our own node at hermosaai.com is second — flip it to the front
 *  once the tunnel is verified serving /ipfs/ (it timed out on the
 *  2026-08-15 check); ipfs.io is the last resort. Each is tried in order
 *  with a per-gateway timeout by the tank's template loader (MQ21). */
export const IPFS_GATEWAYS = [
  'https://dweb.link/ipfs/',
  'https://hermosaai.com/ipfs/',
  'https://ipfs.io/ipfs/',
];

export function resolveIpfsUrl(url: string): string {
  return resolveIpfsUrls(url)[0]!;
}

/** All gateway candidates for a URL — one entry for non-ipfs URLs. */
export function resolveIpfsUrls(url: string): string[] {
  if (!url.startsWith('ipfs://')) return [url];
  const stripped = url.slice('ipfs://'.length);
  return IPFS_GATEWAYS.map((g) => `${g}${stripped}`);
}

export interface FishEntry {
  id: number;
  name: string;
  breed: string;
  ipfs3d: string;
  localGlb: string;
}

export const FISH_CATALOG: FishEntry[] = [
  { id: 257, name: 'Fish 257', breed: 'angelfish', ipfs3d: 'ipfs://QmaHbEQAP6k2zopJHJBzyaK62zNX5yH8yASDjkaG4DY9Dp/fish_257_of_the_metaquarium_3d.glb', localGlb: '/assets/metaquarium/fish-257-angelfish.glb' },
  { id: 258, name: 'Fish 258', breed: 'angelfish', ipfs3d: 'ipfs://QmUZGF3ge3d9rzrtxrD6V4qx2gLtGeeNLuCb8fQeNyUkwJ/fish_258_of_the_metaquarium_3d.glb', localGlb: '' },
  { id: 259, name: 'Fish 259', breed: 'angelfish', ipfs3d: 'ipfs://QmfBBnNrVrkffMKoESvq3cB6nAWGpfMPjduTgw1unahvPf/fish_259_of_the_metaquarium_3d.glb', localGlb: '' },
  { id: 100, name: 'Fish 100', breed: 'betafish', ipfs3d: 'ipfs://Qmb5Uu8u154QTzoGpB6ypwVfPZ8NUsU519tQmrgE8yQrWV/fish_100_of_the_metaquarium_3d.glb', localGlb: '/assets/metaquarium/fish-100-betafish.glb' },
  { id: 457, name: 'Fish 457', breed: 'seahorse', ipfs3d: 'ipfs://QmVvEaCa6zRp8Z9YkkZVYBn2owSdwZxupEQacjfd1b2HA2/fish_457_of_the_metaquarium_3d.glb', localGlb: '' },
  { id: 497, name: 'Fish 497', breed: 'seaturtle', ipfs3d: 'ipfs://QmTBNvoUiwPw9HSUmy1qKCWPBKkBRAensgooYVqMmsviaE/fish_497_of_the_metaquarium_3d.glb', localGlb: '' },
];

export const DEFAULT_FISH = FISH_CATALOG[0]!;

import { BREEDS, breedOf, fishAsset, TOTAL_SUPPLY } from './farm';

export interface FishMixEntry {
  id: number;
  url: string;
  count: number;
}

export interface FishMixResult {
  entries: FishMixEntry[];
  problems: string[];
}

/**
 * Parse the `fishMix` DSL: comma-separated `id[:count]` where `id` is a
 * catalog token id (`257`) or breed alias (`betafish`; picks the breed's
 * first entry). Against the default catalog, any minted id 1–512 also
 * resolves via the in-house farm table. A caller-supplied catalog is a
 * closed world — ids not in it are problems, not IPFS fallbacks. Counts
 * are absolute; the tank clamps the expanded total to its tier cap. Raw
 * URLs are deliberately NOT accepted — `:` and `,` stay unambiguous, the
 * validation surface stays finite, and custom URLs remain `fishUrl`'s job
 * (single-breed mode).
 *
 * Zero-dep and pure, so the Worker (via the manifest subpath), the
 * playground, and the tank all validate with the same code. Never throws:
 * bad tokens land in `problems` and good ones still parse, so one typo
 * degrades a mix instead of blanking the tank.
 */
export function parseFishMix(
  mix: string,
  catalog: FishEntry[] = FISH_CATALOG,
): FishMixResult {
  const entries: FishMixEntry[] = [];
  const problems: string[] = [];
  for (const rawToken of mix.split(',')) {
    const token = rawToken.trim();
    if (token === '') continue;
    const [idRaw, countRaw, ...extra] = token.split(':');
    if (extra.length > 0) {
      problems.push(`"${token}": too many ':' — expected id[:count]`);
      continue;
    }
    const key = (idRaw ?? '').trim().toLowerCase();
    let fish = /^\d+$/.test(key)
      ? catalog.find((f) => f.id === Number(key))
      : catalog.find((f) => f.breed.toLowerCase() === key);
    // Farm fallback is only for the default catalog. A custom catalog is a
    // closed world (playground offline e2e, a future pack) — leaking a minted
    // id out to IPFS would silently undo that constraint.
    if (!fish && catalog === FISH_CATALOG && /^\d+$/.test(key)) {
      const n = Number(key);
      const url = fishAsset(n, '3d');
      const breed = breedOf(n);
      if (url && breed) fish = { id: n, name: `Fish ${n}`, breed, ipfs3d: url, localGlb: '' };
    }
    if (!fish) {
      problems.push(
        /^\d+$/.test(key)
          ? catalog === FISH_CATALOG
            ? `"${key}": not a minted token id (1-${TOTAL_SUPPLY})`
            : `"${key}": not a catalog id`
          : `"${key}": not a breed (${BREEDS.filter((b) => b.minted).map((b) => b.breed).join(', ')})`,
      );
      continue;
    }
    let count = 1;
    if (countRaw !== undefined) {
      const n = Number(countRaw.trim());
      if (!Number.isInteger(n) || n < 1 || n > 24) {
        problems.push(`"${token}": count must be an integer 1-24`);
        continue;
      }
      count = n;
    }
    entries.push({ id: fish.id, url: fish.ipfs3d, count });
  }
  return { entries, problems };
}

/** Expand a parsed mix into the ordered per-slot URL list the tank spawns
 *  from: `"257:2,100:1"` → [url257, url257, url100]. Slot order IS the
 *  DSL order, so fish 0..N are stable for a given string. */
export function expandFishMix(entries: FishMixEntry[], cap: number): string[] {
  const urls: string[] = [];
  for (const e of entries) {
    for (let i = 0; i < e.count && urls.length < cap; i++) urls.push(e.url);
  }
  return urls;
}
