/**
 * The Metaquarium farm, in-house.
 *
 * Everything needed to turn a fish token id into asset URLs lives here as
 * DATA — no AWS API, no metadata round-trip, no third-party resolver on the
 * path to a rendered frame. `fishAssets(85)` is a pure function.
 *
 * Why this is not a client: the farm's AWS endpoint requires an allowlisted
 * `Origin` header that does not include idlescreens.com, and its media lives
 * behind gateways that have proven unreliable. Depending on either at render
 * time makes an ambient screen only as good as someone else's uptime. The
 * collection is closed (512, `totalSupply()`), so the mapping is a constant.
 *
 * Zero-dep on purpose — servers can validate fish references through the
 * `./manifest` subpath without pulling three.js.
 *
 * Source of truth and provenance: `idle-mono/docs/metaquarium-farm-api.md`.
 */

import { ASSET_CIDS } from './asset-cids';

export { ASSET_CIDS };

export const TOTAL_SUPPLY = 512;

/** ERC-721, Ethereum mainnet. Metadata is per-token but collapses to the four
 *  directory CIDs in {@link BREEDS}, so `tokenURI` is never needed at runtime. */
export const CONTRACT = '0x680cCc4fE7aa62172D20899Ab87C5304545431CB';

// ---------------------------------------------------------------------------
// Breeds
// ---------------------------------------------------------------------------

/** Every breed the Metaquarium was designed around. Four were minted as the
 *  512-fish collection; the rest exist as finished models in the original
 *  aquarium and are the natural stock for future tank life (props, NPCs,
 *  wildlife that isn't a token). Kept here so the knowledge isn't stranded
 *  in the source project. */
export type Breed =
  | 'betafish' | 'angelfish' | 'seahorse' | 'seaturtle'   // minted
  | 'blowfish' | 'hackerfish' | 'glowfish' | 'babyfish'   // designed, unminted
  | 'shark' | 'crab' | 'jellyfish' | 'dori';

export interface BreedInfo {
  breed: Breed;
  minted: boolean;
  /** Inclusive token range, minted breeds only. Ranges are contiguous and
   *  in mint order — this is what makes id → metadata a pure function. */
  range?: readonly [number, number];
  count: number;
  /** Metadata directory CID (one per minted breed, holding every
   *  `fish_<n>_of_the_metaquarium.json` in its range). */
  metadataCid?: string;
  /** Model basename in the original aquarium's NPC set, for unminted breeds
   *  whose art exists but has no token behind it. */
  model?: string;
}

export const BREEDS: readonly BreedInfo[] = [
  { breed: 'betafish',  minted: true, range: [1, 256],   count: 256,
    metadataCid: 'QmZSs1ZHsW4B4ZLip8N8EqdUaXCv5ra5M5bWz1RsFSkKb4', model: 'beta-fish' },
  { breed: 'angelfish', minted: true, range: [257, 456], count: 200,
    metadataCid: 'QmaQXcFof5qb6cigk4eo59zyMUdP4CV6pVAupPZys4jquT', model: 'angel-fish' },
  { breed: 'seahorse',  minted: true, range: [457, 496], count: 40,
    metadataCid: 'Qme8G5eXaAkk1dzVr5VDt8sgauVez9kmxxDNaYbSQLyggx', model: 'sea-horse' },
  { breed: 'seaturtle', minted: true, range: [497, 512], count: 16,
    metadataCid: 'QmZTntNpvwxe8Mii7s1XTpTrbaci4ZgYUXs9sEbsBodtaF', model: 'sea-turtle' },
  { breed: 'blowfish',   minted: false, count: 0, model: 'blow-fish' },
  { breed: 'hackerfish', minted: false, count: 0, model: 'hacker-fish' },
  { breed: 'glowfish',   minted: false, count: 0, model: 'glow-fish' },
  { breed: 'babyfish',   minted: false, count: 0, model: 'baby-fish' },
  { breed: 'shark',      minted: false, count: 0, model: 'shark' },
  { breed: 'crab',       minted: false, count: 0, model: 'crab' },
  { breed: 'jellyfish',  minted: false, count: 0, model: 'jellyfish' },
  { breed: 'dori',       minted: false, count: 0, model: 'dori' },
];

/** Breed of a minted token, or null when the id is outside 1..512. */
export function breedOf(id: number): Breed | null {
  for (const b of BREEDS) {
    if (b.range && id >= b.range[0] && id <= b.range[1]) return b.breed;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Traits
// ---------------------------------------------------------------------------

/**
 * The twelve trait types every fish carries, in the order the metadata emits
 * them. Documented because several are steering-relevant and would otherwise
 * be rediscovered by reading JSON: `primary color`/`secondary color` are the
 * fish's own hexes (an authored palette the tank currently overrides with its
 * seeded coats), `eyes` is a 9-bit pixel mask, `track`/`voice` name the audio
 * the original aquarium played for that fish.
 */
export const TRAIT_TYPES = [
  'breed', 'track', 'primary color', 'secondary color', 'eyes', 'voice',
  'credit score', 'astrological sign', 'mystery digit', 'attack power',
  'birthday', 'left finned',
] as const;
export type TraitType = (typeof TRAIT_TYPES)[number];

/** A fish's metadata as the farm publishes it. `token_id` is deliberately
 *  absent — the live API does not return it; derive from `name`. */
export interface FishMetadata {
  name: string;
  description?: string;
  external_url?: string;
  image?: string;
  favicon?: string;
  transparent_icon?: string;
  /** GLB. Note the filename suffix differs by metadata generation — see
   *  {@link fishAssets}, which builds the current one. */
  '3d'?: string;
  animation_url?: string;
  video_512?: string;
  born_in?: string;
  background_color?: string;
  attributes?: Array<{ trait_type: TraitType | string; value: string | number }>;
}

/** Token id from a metadata `name` ("Fish 85 of the Metaquarium" → 85). */
export function idFromName(name: string): number | null {
  const m = /Fish\s+(\d+)\s+of the Metaquarium/i.exec(name);
  return m ? Number(m[1]) : null;
}

// ---------------------------------------------------------------------------
// URL construction
// ---------------------------------------------------------------------------

export type AssetKind = '3d' | 'image' | 'transparent_icon' | 'favicon' | 'video';

/** Filename suffix per asset kind, current generation. (An earlier metadata
 *  batch named the model `_glb.glb`; the directories themselves hold
 *  `_3d.glb`, which is what these build.) */
const SUFFIX: Record<AssetKind, string> = {
  '3d': '_3d.glb',
  image: '_image.jpg',
  transparent_icon: '_transparent_icon.png',
  favicon: '_favicon.png',
  video: '_video.mp4',
};

export function isMintedId(id: number): boolean {
  return Number.isInteger(id) && id >= 1 && id <= TOTAL_SUPPLY;
}

/** The asset directory CID for a token, or null when the id isn't minted. */
export function assetCid(id: number): string | null {
  return isMintedId(id) ? (ASSET_CIDS[id - 1] ?? null) : null;
}

/** `ipfs://<cid>/<file>` for one asset — the scheme the tank's gateway ladder
 *  resolves. Pure: no fetch, no metadata lookup. */
export function fishAsset(id: number, kind: AssetKind = '3d'): string | null {
  const cid = assetCid(id);
  return cid ? `ipfs://${cid}/fish_${id}_of_the_metaquarium${SUFFIX[kind]}` : null;
}

/** Every asset URL for a fish, plus its breed — one call, no network. */
export function fishAssets(id: number): {
  id: number; breed: Breed; cid: string;
  model: string; image: string; icon: string; favicon: string; video: string;
} | null {
  const cid = assetCid(id);
  const breed = breedOf(id);
  if (!cid || !breed) return null;
  return {
    id, breed, cid,
    model: fishAsset(id, '3d')!,
    image: fishAsset(id, 'image')!,
    icon: fishAsset(id, 'transparent_icon')!,
    favicon: fishAsset(id, 'favicon')!,
    video: fishAsset(id, 'video')!,
  };
}

/** Canonical metadata URL for a token — the range formula, no RPC. Useful for
 *  traits/description; never needed just to render. */
export function fishMetadataUrl(id: number): string | null {
  if (!isMintedId(id)) return null;
  const b = BREEDS.find((x) => x.range && id >= x.range[0] && id <= x.range[1]);
  return b?.metadataCid
    ? `ipfs://${b.metadataCid}/fish_${id}_of_the_metaquarium.json`
    : null;
}

/** All minted ids of a breed — the seam for "a tank of seahorses". */
export function idsOfBreed(breed: Breed): number[] {
  const b = BREEDS.find((x) => x.breed === breed);
  if (!b?.range) return [];
  const out: number[] = [];
  for (let i = b.range[0]; i <= b.range[1]; i++) out.push(i);
  return out;
}
