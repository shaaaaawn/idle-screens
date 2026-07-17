import { describe, it, expect } from 'vitest';
import { createRng } from '@idle-screens/core';
import { farmMetadata, pickFarmFish, resolveAssetUrl, tokenOf, type FarmFish } from './farm';

const fish = (token: number, model = true): FarmFish => ({
  name: `Fish ${token} of the Metaquarium`,
  external_url: `https://eth.metaquarium.xyz/${token}`,
  ...(model ? { '3d': `ipfs://Qm${token}/fish_${token}_3d.glb` } : {}),
});

describe('metaquarium farm', () => {
  it('resolves ipfs:// through the gateway, passes other URLs through', () => {
    expect(resolveAssetUrl('ipfs://Qm1/f.glb', 'https://ipfs.io/ipfs/')).toBe('https://ipfs.io/ipfs/Qm1/f.glb');
    expect(resolveAssetUrl('ipfs://Qm1/f.glb', '/assets/metaquarium')).toBe('/assets/metaquarium/Qm1/f.glb');
    expect(resolveAssetUrl('/local/f.glb', 'https://ipfs.io/ipfs/')).toBe('/local/f.glb');
    expect(resolveAssetUrl('https://cdn.example/f.glb', 'g/')).toBe('https://cdn.example/f.glb');
  });

  it('reads the token from external_url, falling back to the name', () => {
    expect(tokenOf(fish(257))).toBe('257');
    expect(tokenOf({ name: 'Fish 42 of the Metaquarium' })).toBe('42');
    expect(tokenOf({})).toBe('');
  });

  it('unwraps both the farm envelope and a bare array', () => {
    const list = [fish(1)];
    expect(farmMetadata(list)).toEqual(list);
    expect(farmMetadata({ message: { metadata: list } })).toEqual(list);
    expect(farmMetadata({ error: 'nope' })).toEqual([]);
    expect(farmMetadata(null)).toEqual([]);
  });

  it('pins exact fish when tokens are given', () => {
    const meta = [fish(1), fish(2), fish(3), fish(4)];
    const picked = pickFarmFish(meta, ['2', '4'], createRng(1), 24);
    expect(picked.map(tokenOf)).toEqual(['2', '4']);
  });

  it('seeded selection is deterministic and skips model-less fish', () => {
    const meta = [fish(1), fish(2, false), fish(3), fish(4), fish(5)];
    const a = pickFarmFish(meta, [], createRng(9).fork(0xfa12), 3);
    const b = pickFarmFish(meta, [], createRng(9).fork(0xfa12), 3);
    expect(a).toEqual(b);
    expect(a).toHaveLength(3);
    expect(a.map(tokenOf)).not.toContain('2');
  });
});
