import { describe, expect, it } from 'vitest';
import {
  overlayAuthoredScreens,
  screensForArtistRun,
  screensForCompareRun,
} from './screens-view';
import type { EvalScreen } from './types';

const screen = (id: string, title = id): EvalScreen =>
  ({
    id,
    artistId: id.split('--')[0]!,
    kind: id.includes('signature') ? 'signature' : 'benchmark',
    screenId: id.split('--').at(-1)!,
    title,
    intent: 'test',
    recipe: 'benchmark',
    spec: {
      schemaVersion: 1,
      id,
      label: title,
      seed: 1,
      background: { type: 'solid', color: '#000' },
      layers: [],
    },
  }) as EvalScreen;

describe('overlayAuthoredScreens', () => {
  const body = [
    screen('monet--benchmark--calm-horizon', 'catalog calm'),
    screen('monet--benchmark--pulse-field', 'catalog pulse'),
  ];

  it('returns the catalog slice when there is no authored evidence', () => {
    expect(overlayAuthoredScreens(body, null)).toEqual(body);
  });
});

describe('screensForArtistRun', () => {
  const catalog = [
    screen('monet--benchmark--calm-horizon', 'catalog calm'),
    screen('monet--benchmark--pulse-field', 'catalog pulse'),
    screen('monet--signature--water-lilies', 'catalog sig'),
  ];

  it('shows the full catalog body when no run evidence is loaded', () => {
    expect(screensForArtistRun(catalog, null, 'monet')).toEqual(catalog);
  });

  it('shows only what the run authored for that artist — no blank benchmarks', () => {
    const authored = [
      screen('monet--benchmark--calm-horizon', 'authored calm'),
      screen('kusama--benchmark--calm-horizon', 'kusama'),
    ];
    const out = screensForArtistRun(catalog, authored, 'monet');
    expect(out).toHaveLength(1);
    expect(out[0]!.title).toBe('authored calm');
  });

  it('returns an empty wall when the run never touched that artist', () => {
    const authored = [screen('kusama--benchmark--calm-horizon', 'kusama')];
    expect(screensForArtistRun(catalog, authored, 'monet')).toEqual([]);
  });
});

describe('screensForCompareRun', () => {
  const catalog = [
    screen('monet--benchmark--calm-horizon'),
    screen('kusama--benchmark--calm-horizon'),
    screen('rothko--benchmark--calm-horizon'),
  ];

  it('falls back to the catalog when there is no authored set', () => {
    expect(screensForCompareRun(catalog, null, 'calm-horizon')).toEqual(catalog);
  });

  it('keeps only authored tiles for the benchmark', () => {
    const authored = [
      screen('monet--benchmark--calm-horizon', 'authored'),
      screen('monet--benchmark--pulse-field', 'other bench'),
    ];
    const out = screensForCompareRun(catalog, authored, 'calm-horizon');
    expect(out).toHaveLength(1);
    expect(out[0]!.title).toBe('authored');
  });
});
