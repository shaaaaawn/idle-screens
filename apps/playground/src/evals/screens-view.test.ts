import { describe, expect, it } from 'vitest';
import { overlayAuthoredScreens } from './screens-view';
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
    screen('monet--signature--water-lilies', 'catalog sig'),
  ];

  it('returns the catalog slice when there is no authored evidence', () => {
    expect(overlayAuthoredScreens(body, null)).toEqual(body);
    expect(overlayAuthoredScreens(body, [])).toEqual(body);
  });

  it('keeps full body of work when authored is a partial agent slice', () => {
    const authored = [screen('monet--benchmark--calm-horizon', 'authored calm')];
    const out = overlayAuthoredScreens(body, authored);
    expect(out).toHaveLength(3);
    expect(out[0]!.title).toBe('authored calm');
    expect(out[1]!.title).toBe('catalog pulse');
    expect(out[2]!.title).toBe('catalog sig');
  });

  it('does not invent screens that are not in the base slice', () => {
    const authored = [
      screen('monet--benchmark--calm-horizon', 'authored'),
      screen('van-gogh--benchmark--calm-horizon', 'other artist'),
    ];
    const out = overlayAuthoredScreens(body, authored);
    expect(out.map((s) => s.id)).toEqual(body.map((s) => s.id));
  });
});
