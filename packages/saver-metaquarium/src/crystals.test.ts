import { createRng } from '@idle-screens/core';
import { describe, expect, it } from 'vitest';
import {
  clusterClearance, emittersOf, ENV_PROP_MIX, growCluster, layoutCrystals, MAX_CLUSTERS,
  parsePropMix, pulseAt, sampleLight, shardGeometry, SHARD_RADIUS,
} from './crystals';
import { ENVIRONMENT_NAMES } from './environments';

const OPTS = { environment: 'void' as const, clusterCap: 12, shardCap: 32, variants: 3, scale: 1 };

describe('parsePropMix', () => {
  it('reads kind#id:count@habit/palette', () => {
    const r = parsePropMix('crystal#hero:1@lotus/hotpink, crystal:5@druse');
    expect(r.problems).toEqual([]);
    expect(r.entries).toEqual([
      { kind: 'crystal', id: 'hero', count: 1, habit: 'lotus', palette: 'hotpink' },
      { kind: 'crystal', id: null, count: 5, habit: 'druse', palette: 'env' },
    ]);
  });

  it('empty input is no entries and no problems', () => {
    expect(parsePropMix('')).toEqual({ entries: [], problems: [] });
    expect(parsePropMix(' , ')).toEqual({ entries: [], problems: [] });
  });

  it('drops what it cannot read and says why, never throws', () => {
    const r = parsePropMix('kelp:3, crystal@nope/mauve, !!, crystal#a, crystal#a');
    expect(r.entries.map((e) => [e.habit, e.palette, e.id])).toEqual([['lotus', 'env', null], ['lotus', 'env', 'a']]);
    expect(r.problems.join('|')).toMatch(/unknown prop kind "kelp"/);
    expect(r.problems.join('|')).toMatch(/unknown habit "nope"/);
    expect(r.problems.join('|')).toMatch(/unknown palette "mauve"/);
    expect(r.problems.join('|')).toMatch(/"!!" is not/);
    expect(r.problems.join('|')).toMatch(/"a" is already taken/);
  });

  it('clamps the scene to MAX_CLUSTERS', () => {
    const r = parsePropMix('crystal:9, crystal:9');
    expect(r.entries.reduce((a, e) => a + e.count, 0)).toBe(MAX_CLUSTERS);
    expect(r.problems[0]).toMatch(/clamped to 3/);
  });

  it('every environment default parses clean', () => {
    for (const env of ENVIRONMENT_NAMES) expect(parsePropMix(ENV_PROP_MIX[env]).problems).toEqual([]);
    expect(ENV_PROP_MIX.void).toBe('');
  });
});

describe('shardGeometry', () => {
  it('is a small flat-shaded spindle on the measured profile', () => {
    for (let seed = 1; seed < 20; seed += 1) {
      const g = shardGeometry(createRng(seed));
      expect(g.triangles).toBeGreaterThanOrEqual(35);
      expect(g.triangles).toBeLessThanOrEqual(49);
      expect(g.positions.length).toBe(g.triangles * 9);
      let maxR = 0, maxY = 0, minY = 1;
      for (let i = 0; i < g.positions.length; i += 3) {
        maxR = Math.max(maxR, Math.hypot(g.positions[i]!, g.positions[i + 2]!));
        maxY = Math.max(maxY, g.positions[i + 1]!);
        minY = Math.min(minY, g.positions[i + 1]!);
      }
      expect(minY).toBe(0);
      expect(maxY).toBe(1);
      // The originals' ≈4:1 aspect, within the per-side jitter.
      expect(maxR).toBeGreaterThan(SHARD_RADIUS * 0.85);
      expect(maxR).toBeLessThan(SHARD_RADIUS * 1.3);
    }
  });

  it('facet normals are unit, shared per triangle, and face away from the axis', () => {
    const g = shardGeometry(createRng(7));
    for (let t = 0; t < g.triangles; t += 1) {
      const o = t * 9;
      const n = [g.normals[o]!, g.normals[o + 1]!, g.normals[o + 2]!];
      expect(Math.hypot(n[0]!, n[1]!, n[2]!)).toBeCloseTo(1, 5);
      for (let k = 1; k < 3; k += 1) {
        expect(g.normals[o + k * 3]).toBe(n[0]);
        expect(g.normals[o + k * 3 + 2]).toBe(n[2]);
      }
      const mx = (g.positions[o]! + g.positions[o + 3]! + g.positions[o + 6]!) / 3;
      const mz = (g.positions[o + 2]! + g.positions[o + 5]! + g.positions[o + 8]!) / 3;
      expect(n[0]! * mx + n[2]! * mz).toBeGreaterThanOrEqual(-1e-6);
    }
  });

  it('is deterministic per seed', () => {
    expect(shardGeometry(createRng(3)).positions).toEqual(shardGeometry(createRng(3)).positions);
    expect(shardGeometry(createRng(3)).positions).not.toEqual(shardGeometry(createRng(4)).positions);
  });
});

describe('growCluster', () => {
  it('lotus reproduces the measured rosette: 1 / 6 / 9 / 16, shorter as it leans', () => {
    const { shards } = growCluster('lotus', createRng(11), OPTS);
    expect(shards).toHaveLength(32);
    const tilt = (s: { ay: number }): number => (Math.acos(Math.min(1, s.ay)) * 180) / Math.PI;
    expect(tilt(shards[0]!)).toBeLessThan(8);
    const inner = shards.slice(1, 7), skirt = shards.slice(16);
    expect(Math.max(...inner.map(tilt))).toBeLessThan(40);
    expect(Math.min(...skirt.map(tilt))).toBeGreaterThan(70);
    const mean = (a: number[]): number => a.reduce((x, y) => x + y, 0) / a.length;
    expect(shards[0]!.length).toBeGreaterThan(mean(inner.map((s) => s.length)));
    expect(mean(inner.map((s) => s.length))).toBeGreaterThan(mean(skirt.map((s) => s.length)) * 1.4);
  });

  it('no shard ever points below the horizon, and axes are unit', () => {
    for (const habit of ['lotus', 'spire', 'druse', 'scatter'] as const) {
      for (const s of growCluster(habit, createRng(5), OPTS).shards) {
        expect(s.ay).toBeGreaterThan(0);
        expect(Math.hypot(s.ax, s.ay, s.az)).toBeCloseTo(1, 5);
        expect(s.variant).toBeGreaterThanOrEqual(0);
        expect(s.variant).toBeLessThan(3);
      }
    }
  });

  it('thins to the tier budget but keeps the spire', () => {
    const { shards } = growCluster('lotus', createRng(11), { ...OPTS, shardCap: 12 });
    expect(shards.length).toBeLessThanOrEqual(14);
    expect(shards[0]!.ay).toBeGreaterThan(0.99);
  });
});

describe('layoutCrystals', () => {
  const entries = parsePropMix('crystal#hero:1@lotus/hotpink,crystal:7@druse').entries;

  it('is deterministic, puts the first token nearest the centre, keeps clusters apart', () => {
    const a = layoutCrystals(entries, createRng(9), OPTS);
    const b = layoutCrystals(entries, createRng(9), OPTS);
    expect(a).toEqual(b);
    expect(a.clusters).toHaveLength(8);
    expect(a.clusters[0]!.id).toBe('hero');
    const r = a.clusters.map((c) => Math.hypot(c.x, c.z));
    expect(r[0]).toBe(Math.min(...r));
    for (let i = 0; i < 8; i += 1) for (let j = i + 1; j < 8; j += 1) {
      const ci = a.clusters[i]!, cj = a.clusters[j]!;
      expect(Math.hypot(ci.x - cj.x, ci.z - cj.z)).toBeGreaterThan(20);
    }
  });

  it('honours the device budget and reports the cut', () => {
    const r = layoutCrystals(entries, createRng(9), { ...OPTS, clusterCap: 4 });
    expect(r.clusters).toHaveLength(4);
    expect(r.problems[0]).toMatch(/8 clusters asked, 4 built/);
  });

  it('env palette follows the room; glass is flagged', () => {
    const ice = layoutCrystals(parsePropMix('crystal:4').entries, createRng(2), { ...OPTS, environment: 'ice' });
    expect(new Set(ice.clusters.map((c) => c.color))).toEqual(new Set(['#dff6ff', '#4fe9ff']));
    const g = layoutCrystals(parsePropMix('crystal/glass').entries, createRng(2), OPTS);
    expect(g.clusters[0]!.glass).toBe(true);
  });
});

describe('light field', () => {
  const { clusters } = layoutCrystals(parsePropMix('crystal/hotpink').entries, createRng(1), OPTS);
  const emitters = emittersOf(clusters);

  it('falls off with distance and carries the cluster colour', () => {
    const e = emitters[0]!;
    const near = sampleLight(emitters, e.x, e.y, e.z, 0, 0);
    const far = sampleLight(emitters, e.x + e.reach * 3, e.y, e.z, 0, 0);
    expect(near[0]).toBeCloseTo(e.r, 5);
    expect(far[0]).toBeCloseTo(e.r / 10, 5);
    expect(near[0]).toBeGreaterThan(near[1]); // hot pink: red over green
  });

  it('the pulse is shallow and slow — never a flash', () => {
    let lo = 1, hi = 0;
    for (let t = 0; t < 20; t += 0.05) {
      const p = pulseAt(t, 1.3, 1);
      lo = Math.min(lo, p); hi = Math.max(hi, p);
    }
    expect(hi).toBeLessThanOrEqual(1);
    expect(lo).toBeGreaterThanOrEqual(0.85);
    expect(pulseAt(3, 1.3, 0)).toBe(1);
  });

  it('clearance is a dome over the cluster and nothing elsewhere', () => {
    const c = clusters[0]!;
    expect(clusterClearance(clusters, c.x, c.z)).toBeCloseTo(c.y + c.height * 0.9, 5);
    expect(clusterClearance(clusters, c.x + c.radius * 0.6, c.z)).toBeGreaterThan(c.y + c.height * 0.5);
    expect(clusterClearance(clusters, c.x + c.radius * 2 + 10, c.z)).toBe(-Infinity);
  });
});
