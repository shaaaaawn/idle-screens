import { describe, it, expect } from 'vitest';
import { resolveIpfsUrl, FISH_CATALOG, DEFAULT_FISH, parseFishMix, expandFishMix } from './ipfs';

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
  it('empty string parses to an empty mix', () => {
    expect(parseFishMix('')).toEqual({ entries: [], problems: [] });
  });
  it('resolves against an injected catalog', () => {
    const r = parseFishMix('9:1', [{ id: 9, name: 'X', breed: 'x', ipfs3d: '/x.glb', localGlb: '' }]);
    expect(r.entries[0]!.url).toBe('/x.glb');
  });
});

describe('expandFishMix', () => {
  it('expands in DSL order and clamps to the cap', () => {
    const { entries } = parseFishMix('257:2,100:2');
    expect(expandFishMix(entries, 3).map((u) => /fish_(\d+)/.exec(u)![1])).toEqual(['257', '257', '100']);
  });
});
