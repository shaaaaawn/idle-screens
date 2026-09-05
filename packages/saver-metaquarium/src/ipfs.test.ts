import { describe, it, expect } from 'vitest';
import { resolveIpfsUrl, resolveIpfsUrls, IPFS_GATEWAYS, FISH_CATALOG, DEFAULT_FISH, parseFishMix, expandFishMix , NPC_CATALOG, expandFishMixSlots } from './ipfs';

describe('resolveIpfsUrl', () => {
  it('rewrites ipfs:// URLs to the dweb.link gateway', () => {
    expect(resolveIpfsUrl('ipfs://QmABC123/file.glb')).toBe(
      'https://dweb.link/ipfs/QmABC123/file.glb',
    );
  });

  it('passes through non-ipfs URLs unchanged', () => {
    expect(resolveIpfsUrl('https://example.com/fish.glb')).toBe(
      'https://example.com/fish.glb',
    );
    expect(resolveIpfsUrl('/local/path.glb')).toBe('/local/path.glb');
  });
});

describe('FISH_CATALOG', () => {
  it('contains at least one entry', () => {
    expect(FISH_CATALOG.length).toBeGreaterThan(0);
  });

  it('every entry has an ipfs:// 3d URL', () => {
    for (const fish of FISH_CATALOG) {
      expect(fish.ipfs3d).toMatch(/^ipfs:\/\//);
    }
  });

  it('every entry has an id and breed', () => {
    for (const fish of FISH_CATALOG) {
      expect(fish.id).toBeGreaterThan(0);
      expect(fish.breed.length).toBeGreaterThan(0);
    }
  });
});

describe('DEFAULT_FISH', () => {
  it('is the first catalog entry', () => {
    expect(DEFAULT_FISH).toBe(FISH_CATALOG[0]);
  });

  it('has a resolvable ipfs3d URL', () => {
    const url = resolveIpfsUrl(DEFAULT_FISH.ipfs3d);
    expect(url).toMatch(/^https:\/\/dweb\.link\/ipfs\//);
  });
});

describe('parseFishMix', () => {
  it('parses ids, breed aliases, and counts — counts cast DISTINCT fish', () => {
    // The uniqueness rule: a minted fish is an individual. `257:2` is two
    // different angelfish (257 and its nearest unused neighbour), silently.
    const r = parseFishMix('257:2, betafish, seaturtle:1');
    expect(r.problems).toEqual([]);
    expect(r.entries.map((e) => [e.id, e.count])).toEqual([[257, 1], [258, 1], [1, 1], [497, 1]]);
    expect(r.entries[0]!.url).toContain('fish_257');
  });

  it('no minted fish appears twice, whatever the author writes', () => {
    for (const mix of ['257,257', '257:3,258:3', 'angelfish:8,300:4', 'seaturtle:16,497:4']) {
      const ids = parseFishMix(mix).entries.map((e) => e.id);
      expect(new Set(ids).size, mix).toBe(ids.length);
    }
  });

  it('a named id already cast gets a swims-instead advisory; school extras do not', () => {
    const dup = parseFishMix('257,257');
    expect(dup.entries.map((e) => e.id)).toEqual([257, 258]);
    expect(dup.problems).toEqual(['fish 257 already cast — fish 258 swims instead']);
    const school = parseFishMix('300:6');
    expect(school.entries).toHaveLength(6);
    expect(school.problems).toEqual([]); // reassignment IS the count's meaning
  });

  it('breed exhaustion clamps with a problem instead of duplicating', () => {
    // Sea turtles are 497-512: sixteen individuals exist, so a 16 + 4 ask
    // runs dry at 16 total.
    const r = parseFishMix('seaturtle:16, 497:4');
    expect(r.entries).toHaveLength(16);
    expect(r.problems.some((p) => p.includes('distinct seaturtle left'))).toBe(true);
  });
  it('degrades on bad tokens instead of failing the mix', () => {
    const r = parseFishMix('257:2, nope:1, 100:0, 258:x, 259:1:9');
    expect(r.entries.map((e) => e.id)).toEqual([257, 258]);
    expect(r.problems).toHaveLength(4);
  });
  it('clamps oversized counts to 24 instead of dropping the token', () => {
    const r = parseFishMix('seahorse:30');
    expect(r.entries).toHaveLength(24);
    expect(new Set(r.entries.map((e) => e.id)).size).toBe(24); // 24 distinct seahorses
    expect(r.problems).toEqual(['"seahorse:30": count clamped to 24']);
  });
  it('parses a per-token @style and keeps untagged tokens style-less', () => {
    const r = parseFishMix('457:2@hover, 257:1@School, 100:1');
    expect(r.problems).toEqual([]);
    expect(r.entries.map((e) => [e.id, e.style ?? null])).toEqual([
      [457, 'hover'], [458, 'hover'], [257, 'school'], [100, null],
    ]);
    const slots = expandFishMixSlots(r.entries, 24);
    expect(slots.map((sl) => sl.style ?? null)).toEqual(['hover', 'hover', 'school', null]);
    expect(slots[0]!.url).toContain('fish_457');
  });
  it('degrades an unknown @style to a problem without dropping the fish', () => {
    const r = parseFishMix('257:1@zoom');
    expect(r.entries.map((e) => [e.id, e.style ?? null])).toEqual([[257, null]]);
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toContain('unknown style "zoom"');
  });
  it('preserves @ inside custom aliases and parses only a trailing style suffix', () => {
    const catalog = [
      { id: 9, name: 'Night reef', breed: 'reef@night', ipfs3d: '/reef.glb', localGlb: '' },
      { id: 10, name: 'Hover reef', breed: 'reef@hover', ipfs3d: '/hover.glb', localGlb: '' },
    ];
    const unstyled = parseFishMix('reef@night:2', catalog);
    expect(unstyled.problems).toEqual([]);
    expect(unstyled.entries).toEqual([{ id: 9, url: '/reef.glb', count: 2 }]);

    const styled = parseFishMix('reef@night:2@hover', catalog);
    expect(styled.problems).toEqual([]);
    expect(styled.entries).toEqual([{ id: 9, url: '/reef.glb', count: 2, style: 'hover' }]);

    const typo = parseFishMix('reef@night:2@zoom', catalog);
    expect(typo.entries).toEqual([{ id: 9, url: '/reef.glb', count: 2 }]);
    expect(typo.problems[0]).toContain('unknown style "zoom"');

    const collidingAlias = parseFishMix('reef@hover', catalog);
    expect(collidingAlias.problems).toEqual([]);
    expect(collidingAlias.entries).toEqual([{ id: 10, url: '/hover.glb', count: 1 }]);
  });
  it('empty string parses to an empty mix', () => {
    expect(parseFishMix('')).toEqual({ entries: [], problems: [] });
  });
  it('resolves against an injected catalog', () => {
    const r = parseFishMix('9:1', [{ id: 9, name: 'X', breed: 'x', ipfs3d: '/x.glb', localGlb: '' }]);
    expect(r.entries[0]!.url).toBe('/x.glb');
  });
  it('does not farm-fallback ids missing from a custom catalog', () => {
    const custom = [{ id: 9, name: 'X', breed: 'x', ipfs3d: '/x.glb', localGlb: '' }];
    const r = parseFishMix('9:1,85:1', custom);
    expect(r.entries.map((e) => e.url)).toEqual(['/x.glb']);
    expect(r.problems[0]).toContain('not a catalog id');
  });
});

describe('expandFishMix', () => {
  it('expands in DSL order and clamps to the cap', () => {
    // Distinct ids now, still DSL-ordered; the cap trims the tail.
    const { entries } = parseFishMix('257:2,100:2');
    expect(expandFishMix(entries, 3).map((u) => /fish_(\d+)/.exec(u)![1])).toEqual(['257', '258', '100']);
  });
});

describe('resolveIpfsUrls', () => {
  it('returns every gateway candidate in order for ipfs:// urls', () => {
    const urls = resolveIpfsUrls('ipfs://QmX/fish.glb');
    expect(urls.length).toBe(IPFS_GATEWAYS.length);
    expect(urls[0]).toBe(`${IPFS_GATEWAYS[0]}QmX/fish.glb`);
    expect(new Set(urls).size).toBe(urls.length);
  });
  it('passes non-ipfs urls through as a single candidate', () => {
    expect(resolveIpfsUrls('/assets/fish.glb')).toEqual(['/assets/fish.glb']);
  });
  it('resolveIpfsUrl stays the first candidate (compat)', () => {
    expect(resolveIpfsUrl('ipfs://QmX/f.glb')).toBe(resolveIpfsUrls('ipfs://QmX/f.glb')[0]);
  });
});

describe('NPC breeds (unminted set)', () => {
  it('covers all eight designed breeds with synthetic ids above the supply', () => {
    expect(NPC_CATALOG.map((f) => f.breed).sort()).toEqual(
      ['babyfish', 'blowfish', 'crab', 'dori', 'glowfish', 'hackerfish', 'jellyfish', 'shark'],
    );
    for (const f of NPC_CATALOG) {
      expect(f.id).toBeGreaterThan(512); // never collides with a minted token
      expect(f.localGlb).toMatch(/^\/assets\/metaquarium\//);
      expect(f.ipfs3d).toBe(''); // no pin yet — hosts map localGlb in
    }
  });
  it('a mapped catalog resolves NPC breeds; an unmapped one says not hosted', () => {
    const mapped = NPC_CATALOG.map((f) => ({ ...f, ipfs3d: `http://x${f.localGlb}` }));
    const ok = parseFishMix('shark:2,jellyfish:1', mapped);
    expect(ok.problems).toEqual([]);
    expect(ok.entries.map((e) => e.count)).toEqual([2, 1]);
    const un = parseFishMix('shark:1', NPC_CATALOG);
    expect(un.entries).toEqual([]);
    expect(un.problems[0]).toContain('not hosted here');
  });
  it('the breed error names what the ACTIVE catalog offers', () => {
    const r = parseFishMix('unicorn:1', NPC_CATALOG.map((f) => ({ ...f, ipfs3d: 'x' })));
    expect(r.problems[0]).toContain('shark');
    expect(r.problems[0]).toContain('jellyfish');
  });
});
