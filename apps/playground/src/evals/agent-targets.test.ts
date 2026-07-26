import { describe, expect, it } from 'vitest';
import { getCatalog } from './catalog';
import { resolveAgentTargets } from './agent-targets';

describe('resolveAgentTargets', () => {
  const catalog = getCatalog();
  const base = {
    catalog,
    artistId: 'monet',
    benchmarkId: 'calm-horizon',
    screenId: 'monet--benchmark--calm-horizon',
  };

  it('benchmark scope covers every artist for that intent', () => {
    const targets = resolveAgentTargets(base, 'benchmark');
    expect(targets.length).toBe(catalog.artists.length);
    expect(targets.every((t) => t.screen.screenId === 'calm-horizon')).toBe(true);
  });

  it('artist scope covers that artist’s benchmarks only', () => {
    const targets = resolveAgentTargets(base, 'artist');
    expect(targets.length).toBe(catalog.benchmarks.length);
    expect(targets.every((t) => t.screen.artistId === 'monet')).toBe(true);
    expect(targets.every((t) => t.screen.kind === 'benchmark')).toBe(true);
  });

  it('screen scope is exactly one target', () => {
    const targets = resolveAgentTargets(base, 'screen');
    expect(targets).toHaveLength(1);
    expect(targets[0]!.screen.id).toBe('monet--benchmark--calm-horizon');
  });

  it('honours an explicit artist override (not grid selection)', () => {
    const targets = resolveAgentTargets({ ...base, artistId: 'kusama' }, 'artist');
    expect(targets.every((t) => t.screen.artistId === 'kusama')).toBe(true);
    expect(targets.some((t) => t.screen.artistId === 'monet')).toBe(false);
  });
});
