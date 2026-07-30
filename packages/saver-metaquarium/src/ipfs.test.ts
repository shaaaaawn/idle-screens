import { describe, it, expect } from 'vitest';
import { resolveIpfsUrl, FISH_CATALOG, DEFAULT_FISH, type FishEntry } from './ipfs';

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
