import { describe, it, expect } from 'vitest';
import {
  ASSET_CIDS, BREEDS, TOTAL_SUPPLY, assetCid, breedOf, fishAsset, fishAssets,
  fishMetadataUrl, idFromName, idsOfBreed, isMintedId,
} from './farm';
import { parseFishMix } from './ipfs';

describe('farm manifest', () => {
  it('covers every minted token exactly once, no gaps or blanks', () => {
    expect(ASSET_CIDS).toHaveLength(TOTAL_SUPPLY);
    expect(ASSET_CIDS.every((c) => /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(c))).toBe(true);
    expect(new Set(ASSET_CIDS).size).toBe(TOTAL_SUPPLY); // each fish its own dir
  });
  it('breed ranges tile 1..512 contiguously and sum to the supply', () => {
    const minted = BREEDS.filter((b) => b.minted);
    expect(minted.reduce((n, b) => n + b.count, 0)).toBe(TOTAL_SUPPLY);
    let next = 1;
    for (const b of minted) {
      expect(b.range![0]).toBe(next);
      expect(b.range![1] - b.range![0] + 1).toBe(b.count);
      next = b.range![1] + 1;
    }
    expect(next).toBe(TOTAL_SUPPLY + 1);
  });
  it('classifies boundary ids', () => {
    expect(breedOf(256)).toBe('betafish');
    expect(breedOf(257)).toBe('angelfish');
    expect(breedOf(456)).toBe('angelfish');
    expect(breedOf(457)).toBe('seahorse');
    expect(breedOf(496)).toBe('seahorse');
    expect(breedOf(497)).toBe('seaturtle');
    expect(breedOf(0)).toBeNull();
    expect(breedOf(513)).toBeNull();
    expect(breedOf(100.5)).toBeNull();
    expect(breedOf(256.5)).toBeNull();
  });
  it('carries the unminted breeds without ranges', () => {
    const un = BREEDS.filter((b) => !b.minted);
    expect(un.length).toBeGreaterThanOrEqual(8);
    expect(un.every((b) => !b.range && b.count === 0 && !!b.model)).toBe(true);
    expect(un.map((b) => b.breed)).toContain('hackerfish');
  });
  it('builds asset urls purely, with the real CIDs', () => {
    expect(fishAsset(85)).toBe(
      'ipfs://QmUxej92evQZ5GPX8Uk9tRDnDEAPuPaXL6Sym1Yyo2jjRP/fish_85_of_the_metaquarium_3d.glb');
    expect(fishAsset(257)).toContain('QmaHbEQAP6k2zopJHJBzyaK62zNX5yH8yASDjkaG4DY9Dp');
    expect(fishAsset(2, 'transparent_icon')).toMatch(/_transparent_icon\.png$/);
    expect(fishAsset(0)).toBeNull();
    expect(fishAsset(513)).toBeNull();
  });
  it('fishAssets returns every kind plus breed', () => {
    const a = fishAssets(124)!;
    expect(a.breed).toBe('betafish');
    expect(a.cid).toBe(assetCid(124));
    for (const k of ['model', 'image', 'icon', 'favicon', 'video'] as const) {
      expect(a[k]).toContain(a.cid);
      expect(a[k]).toContain('fish_124_');
    }
    expect(fishAssets(999)).toBeNull();
  });
  it('metadata url uses the breed directory, not the asset dir', () => {
    expect(fishMetadataUrl(85)).toBe(
      'ipfs://QmZSs1ZHsW4B4ZLip8N8EqdUaXCv5ra5M5bWz1RsFSkKb4/fish_85_of_the_metaquarium.json');
    expect(fishMetadataUrl(500)).toContain('QmZTntNpvwxe8Mii7s1XTpTrbaci4ZgYUXs9sEbsBodtaF');
  });
  it('helpers: idFromName, idsOfBreed, isMintedId', () => {
    expect(idFromName('Fish 234 of the Metaquarium')).toBe(234);
    expect(idFromName('nonsense')).toBeNull();
    expect(idsOfBreed('seaturtle')).toHaveLength(16);
    expect(idsOfBreed('shark')).toEqual([]);
    expect(isMintedId(512)).toBe(true);
    expect(isMintedId(512.5)).toBe(false);
  });
});

describe('fishMix over the whole collection', () => {
  it('resolves arbitrary minted ids, not just the curated catalog', () => {
    const r = parseFishMix('2:1,85:1,124:1,234:1');
    expect(r.problems).toEqual([]);
    expect(r.entries.map((e) => e.id)).toEqual([2, 85, 124, 234]);
    expect(r.entries[1]!.url).toContain('QmUxej92evQZ5GPX8Uk9tRDnDEAPuPaXL6Sym1Yyo2jjRP');
  });
  it('rejects unminted ids with a range-aware message', () => {
    const r = parseFishMix('513:1');
    expect(r.entries).toEqual([]);
    expect(r.problems[0]).toContain('not a minted token id (1-512)');
  });
  it('still honours breed names and the curated catalog', () => {
    expect(parseFishMix('seahorse').entries).toHaveLength(1);
    expect(parseFishMix('257:2').entries[0]!.count).toBe(2);
  });
});

describe('draco detection', () => {
  const glb = (json: object): ArrayBuffer => {
    const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
    const pad = (4 - (jsonBytes.length % 4)) % 4;
    const len = 12 + 8 + jsonBytes.length + pad;
    const buf = new ArrayBuffer(len);
    const dv = new DataView(buf);
    dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, len, true);
    dv.setUint32(12, jsonBytes.length + pad, true); dv.setUint32(16, 0x4e4f534a, true);
    new Uint8Array(buf, 20).set(jsonBytes);
    return buf;
  };
  it('flags a GLB that requires Draco, and one that does not', async () => {
    const { __needsDracoForTest } = await import('./tank-draco');
    expect(__needsDracoForTest(glb({ extensionsRequired: ['KHR_draco_mesh_compression'] }))).toBe(true);
    expect(__needsDracoForTest(glb({ asset: { version: '2.0' } }))).toBe(false);
  });
  it('never throws on junk input', async () => {
    const { __needsDracoForTest } = await import('./tank-draco');
    expect(__needsDracoForTest(new ArrayBuffer(0))).toBe(false);
    expect(__needsDracoForTest(new TextEncoder().encode('not a glb at all').buffer)).toBe(false);
  });
});
