import { describe, expect, it } from 'vitest';
import {
  authoredCountByArtist,
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

describe('screensForArtistRun', () => {
  const catalog = [
    screen('monet--benchmark--calm-horizon', 'catalog calm'),
    screen('monet--benchmark--pulse-field', 'catalog pulse'),
    screen('monet--signature--water-lilies', 'catalog sig'),
  ];

  it('catalog evidence shows the full body (authored overlaid)', () => {
    const authored = [screen('monet--benchmark--calm-horizon', 'authored calm')];
    const out = screensForArtistRun(catalog, authored, 'monet', 'catalog');
    expect(out).toHaveLength(3);
    expect(out[0]!.title).toBe('authored calm');
  });

  it('run evidence shows only authored screens for that artist', () => {
    const authored = [
      screen('monet--benchmark--calm-horizon', 'authored calm'),
      screen('kusama--benchmark--calm-horizon', 'kusama'),
    ];
    const out = screensForArtistRun(catalog, authored, 'monet', 'run');
    expect(out).toHaveLength(1);
    expect(out[0]!.title).toBe('authored calm');
  });
});

describe('screensForCompareRun', () => {
  const catalog = [
    screen('monet--benchmark--calm-horizon'),
    screen('kusama--benchmark--calm-horizon'),
  ];

  it('run evidence keeps only authored tiles for the benchmark', () => {
    const authored = [screen('monet--benchmark--calm-horizon', 'authored')];
    expect(screensForCompareRun(catalog, authored, 'calm-horizon', 'run')).toHaveLength(1);
  });

  it('catalog evidence keeps every artist', () => {
    const authored = [screen('monet--benchmark--calm-horizon', 'authored')];
    expect(screensForCompareRun(catalog, authored, 'calm-horizon', 'catalog')).toHaveLength(2);
  });
});

describe('authoredCountByArtist', () => {
  it('counts per artist', () => {
    const authored = [
      screen('monet--benchmark--calm-horizon'),
      screen('monet--benchmark--pulse-field'),
      screen('kusama--benchmark--calm-horizon'),
    ];
    const map = authoredCountByArtist(authored);
    expect(map.get('monet')).toBe(2);
    expect(map.get('kusama')).toBe(1);
  });
});

describe('overlayAuthoredScreens', () => {
  it('returns the catalog slice when there is no authored evidence', () => {
    const body = [screen('monet--benchmark--calm-horizon')];
    expect(overlayAuthoredScreens(body, null)).toEqual(body);
  });
});
