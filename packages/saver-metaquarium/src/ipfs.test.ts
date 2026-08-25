import { describe, it, expect } from 'vitest';
import { resolveIpfsUrl, resolveIpfsUrls, IPFS_GATEWAYS, FISH_CATALOG, DEFAULT_FISH, parseFishMix, expandFishMix , NPC_CATALOG } from './ipfs';

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
  it('parses ids, breed aliases, and counts', () => {
    const r = parseFishMix('257:2, betafish, seaturtle:1');
    expect(r.problems).toEqual([]);
    expect(r.entries.map((e) => [e.id, e.count])).toEqual([[257, 2], [100, 1], [497, 1]]);
    expect(r.entries[0]!.url).toContain('fish_257');
  });
  it('degrades on bad tokens instead of failing the mix', () => {
    const r = parseFishMix('257:2, nope:1, 100:0, 258:x, 259:1:9');
    expect(r.entries.map((e) => e.id)).toEqual([257]);
    expect(r.problems).toHaveLength(4);
  });
  it('clamps oversized counts to 24 instead of dropping the token', () => {
    const r = parseFishMix('seahorse:30');
    expect(r.entries.map((e) => [e.id, e.count])).toEqual([[457, 24]]);
    expect(r.problems).toEqual(['"seahorse:30": count clamped to 24']);
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
    const { entries } = parseFishMix('257:2,100:2');
    expect(expandFishMix(entries, 3).map((u) => /fish_(\d+)/.exec(u)![1])).toEqual(['257', '257', '100']);
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
