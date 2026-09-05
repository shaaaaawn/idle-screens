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

/**
 * The unminted breeds — the original aquarium's NPC set, brought in as
 * catalog entries with synthetic ids above the 512 supply. No token, no
 * IPFS pin yet (`ipfs3d` empty), so they resolve only where a host serves
 * the bundled GLBs (`localGlb`) — the playground/studio today. Pinning them
 * and filling `ipfs3d` is what makes them wall-ready; until then the DSL
 * reports them as unhosted rather than spawning a dead URL.
 *
 * All are clip-less and unrigged — they swim on `bodyWiggle`. Their
 * materials use the NPC naming (PrimaryColor, SecondaryColor, EYES-, GLOW-),
 * so every instance gets the seeded two-tone coat and glow halos.
 */
export const NPC_CATALOG: FishEntry[] = [
  { id: 601, name: 'Blowfish', breed: 'blowfish', ipfs3d: '', localGlb: '/assets/metaquarium/npc-blowfish.glb' },
  { id: 602, name: 'Hackerfish', breed: 'hackerfish', ipfs3d: '', localGlb: '/assets/metaquarium/npc-hackerfish.glb' },
  { id: 603, name: 'Glowfish', breed: 'glowfish', ipfs3d: '', localGlb: '/assets/metaquarium/npc-glowfish.glb' },
  { id: 604, name: 'Babyfish', breed: 'babyfish', ipfs3d: '', localGlb: '/assets/metaquarium/npc-babyfish.glb' },
  { id: 605, name: 'Shark', breed: 'shark', ipfs3d: '', localGlb: '/assets/metaquarium/shark3.glb' },
  { id: 606, name: 'Crab', breed: 'crab', ipfs3d: '', localGlb: '/assets/metaquarium/npc-crab.glb' },
  { id: 607, name: 'Jellyfish', breed: 'jellyfish', ipfs3d: '', localGlb: '/assets/metaquarium/npc-jellyfish.glb' },
  { id: 608, name: 'Dori', breed: 'dori', ipfs3d: '', localGlb: '/assets/metaquarium/npc-dori.glb' },
];

import { SWIM_STYLE_NAMES, type SwimStyle } from './swim';
import { BREEDS, breedOf, fishAsset, TOTAL_SUPPLY } from './farm';
import type { Breed } from './farm';

export interface FishMixEntry {
  id: number;
  url: string;
  count: number;
  /** Per-token swim style (`id[:count]@style`, MQ30). Absent = the scene's
   *  `swimStyle`. This is what turns a monoculture into a community:
   *  `457:3@hover, 257:6@school, 497:1@surface`. */
  style?: SwimStyle;
}

/** One spawn slot: the URL to load and, if the token said so, how it swims. */
export interface FishSlot {
  url: string;
  style?: SwimStyle;
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
 * are absolute; a count above 24 clamps to 24 (recorded as a problem so a
 * validator can mention it), and the tank clamps the expanded total to its
 * tier cap. Raw
 * URLs are deliberately NOT accepted — `:` and `,` stay unambiguous, the
 * validation surface stays finite, and custom URLs remain `fishUrl`'s job
 * (single-breed mode).
 *
 * Zero-dep and pure, so the Worker (via the manifest subpath), the
 * playground, and the tank all validate with the same code. Never throws:
 * bad tokens land in `problems` and good ones still parse, so one typo
 * degrades a mix instead of blanking the tank.
 */
/**
 * THE UNIQUENESS RULE (default catalog only): a minted fish is an INDIVIDUAL,
 * so no token id appears twice in one scene. Counts still mean "how many
 * fish" — `300:12` casts twelve DISTINCT angelfish (300 and its nearest
 * unused neighbours in the breed range), and `betafish:5` five distinct
 * betafish spread across the range. Reassignments are recorded in `problems`
 * so publish advisories can say what happened; a breed with no ids left
 * clamps with a problem. Custom catalogs are exempt — a closed world is its
 * curator's business, and NPC entries are SPECIES, not individuals.
 */
export function parseFishMix(
  mix: string,
  catalog: FishEntry[] = FISH_CATALOG,
): FishMixResult {
  const entries: FishMixEntry[] = [];
  const problems: string[] = [];
  const unique = catalog === FISH_CATALOG;
  const used = new Set<number>();

  /** Whether `core` is already a complete, valid unstyled token. Custom
   *  catalog aliases historically allowed `@`, so an unrecognised trailing
   *  word is style syntax only when the prefix resolves and the whole token
   *  does not. */
  const resolvesAsToken = (core: string): boolean => {
    const [idRaw, countRaw, ...extra] = core.split(':');
    if (extra.length > 0) return false;
    if (countRaw !== undefined) {
      const count = Number(countRaw.trim());
      if (!Number.isInteger(count) || count < 1) return false;
    }
    const key = (idRaw ?? '').trim().toLowerCase();
    if (/^\d+$/.test(key)) {
      if (catalog.some((fish) => fish.id === Number(key))) return true;
      return catalog === FISH_CATALOG
        && fishAsset(Number(key), '3d') !== null
        && breedOf(Number(key)) !== null;
    }
    return catalog.some((fish) => fish.breed.toLowerCase() === key);
  };

  /** Nearest unused minted id of `breed`, spreading outward from `want`. */
  const allocate = (breed: Breed, want: number): number | null => {
    const b = BREEDS.find((x) => x.breed === breed);
    if (!b?.range) return null;
    const [lo, hi] = b.range;
    if (!used.has(want) && want >= lo && want <= hi) { used.add(want); return want; }
    for (let d = 1; d <= hi - lo; d += 1) {
      for (const cand of [want + d, want - d]) {
        if (cand >= lo && cand <= hi && !used.has(cand)) { used.add(cand); return cand; }
      }
    }
    return null;
  };
  for (const rawToken of mix.split(',')) {
    const token = rawToken.trim();
    if (token === '') continue;
    // `@style` is parsed off the END first so `id:count` stays exactly as
    // documented; an unknown style is a problem but the fish still swims,
    // on the scene's style — degrade the tag, never drop the fish.
    let style: SwimStyle | undefined;
    let core = token;
    const at = token.lastIndexOf('@');
    if (at >= 0) {
      const styleRaw = token.slice(at + 1).trim().toLowerCase();
      const styledCore = token.slice(0, at).trim();
      if ((SWIM_STYLE_NAMES as readonly string[]).includes(styleRaw)) {
        core = styledCore;
        style = styleRaw as SwimStyle;
      } else if (resolvesAsToken(styledCore) && !resolvesAsToken(token)) {
        // Preserve a complete alias such as `reef@night`; only diagnose a
        // misspelled suffix when removing it exposes a real id/alias.
        core = styledCore;
        problems.push(`"${token}": unknown style "${styleRaw}" (${SWIM_STYLE_NAMES.join(', ')}) — swimming with the scene's swimStyle`);
      }
    }
    const [idRaw, countRaw, ...extra] = core.split(':');
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
      // Name what THIS catalog offers, not a hardcoded minted list — a studio
      // catalog carries the NPC breeds too, and the message should say so.
      const breeds = [...new Set(catalog.map((f) => f.breed))].join(', ');
      problems.push(
        /^\d+$/.test(key)
          ? catalog === FISH_CATALOG
            ? `"${key}": not a minted token id (1-${TOTAL_SUPPLY})`
            : `"${key}": not a catalog id`
          : `"${key}": not a breed (${breeds})`,
      );
      continue;
    }
    // ipfs3d stays the ONE spawnable URL. NPC entries ship with it empty —
    // a host that serves the bundled GLBs maps localGlb into it (the
    // playground's asset() rebase); anywhere else the honest answer is
    // "not hosted here", never a root-relative path that 404s on the wall.
    const url = fish.ipfs3d;
    if (!url) {
      problems.push(`"${key}": model not hosted here (catalog carries no URL for it)`);
      continue;
    }
    let count = 1;
    if (countRaw !== undefined) {
      const n = Number(countRaw.trim());
      if (!Number.isInteger(n) || n < 1) {
        problems.push(`"${token}": count must be an integer 1-24`);
        continue;
      }
      if (n > 24) {
        // Oversized is clear intent ("lots of these"), so clamp instead of
        // dropping the token — but still record it, so a validator can say so.
        problems.push(`"${token}": count clamped to 24`);
        count = 24;
      } else {
        count = n;
      }
    }
    // Minted individuals are unique per scene; everything else (custom
    // catalogs, NPC species) keeps plain count semantics.
    if (!unique || fish.id > TOTAL_SUPPLY) {
      entries.push({ id: fish.id, url, count, ...(style ? { style } : {}) });
      continue;
    }
    const breed = breedOf(fish.id);
    if (!breed) {
      entries.push({ id: fish.id, url, count, ...(style ? { style } : {}) });
      continue;
    }
    // Breed aliases spread across the whole range for variety; numeric ids
    // start the spread at the id the author asked for.
    const isAlias = !/^\d+$/.test(key);
    const b = BREEDS.find((x) => x.breed === breed);
    for (let i = 0; i < count; i += 1) {
      const want = isAlias && b?.range
        ? b.range[0] + Math.floor(((b.range[1] - b.range[0]) * i) / Math.max(1, count))
        : fish.id;
      const got = allocate(breed, want);
      if (got === null) {
        problems.push(`"${token}": only ${i} distinct ${breed} left — a minted fish appears once per scene`);
        break;
      }
      // Advisory only when the id the author NAMED was already taken by an
      // earlier token — the extras of an `id:count` school reassign silently,
      // that being the whole meaning of the count under uniqueness.
      if (!isAlias && i === 0 && got !== fish.id) {
        problems.push(`fish ${fish.id} already cast — fish ${got} swims instead`);
      }
      const gotUrl = fishAsset(got, '3d');
      if (!gotUrl) {
        problems.push(`fish ${got}: no asset URL`);
        continue;
      }
      entries.push({ id: got, url: gotUrl, count: 1, ...(style ? { style } : {}) });
    }
  }
  return { entries, problems };
}

/** Expand a parsed mix into the ordered per-slot URL list the tank spawns
 *  from: `"257:2,100:1"` → [url257, url257, url100]. Slot order IS the
 *  DSL order, so fish 0..N are stable for a given string. */
export function expandFishMix(entries: FishMixEntry[], cap: number): string[] {
  return expandFishMixSlots(entries, cap).map((s) => s.url);
}

/** The same expansion carrying each token's `@style` per slot (MQ30). The
 *  tank spawns from this; `expandFishMix` stays for callers that only need
 *  the URLs. */
export function expandFishMixSlots(entries: FishMixEntry[], cap: number): FishSlot[] {
  const slots: FishSlot[] = [];
  for (const e of entries) {
    for (let i = 0; i < e.count && slots.length < cap; i++) {
      slots.push(e.style ? { url: e.url, style: e.style } : { url: e.url });
    }
  }
  return slots;
}
