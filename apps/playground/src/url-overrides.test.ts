// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { mountOverrideBadge, mqOverrides, overrideLabel, withoutOverrides } from './url-overrides';

describe('mq URL overrides', () => {
  const search = '?saver=metaquarium-recipe-snail-garden&seed=42&mq.environment=reef&mq.fishMix=shark%3A1%40chase&mq.autoRotate=1';

  it('reads them, numbers as numbers', () => {
    expect(mqOverrides(search)).toEqual({ environment: 'reef', fishMix: 'shark:1@chase', autoRotate: 1 });
    expect(mqOverrides('?saver=warp')).toEqual({});
  });

  it('clears them and keeps everything else', () => {
    expect(withoutOverrides(search)).toBe('?saver=metaquarium-recipe-snail-garden&seed=42');
    expect(withoutOverrides('?mq.water=1')).toBe('');
  });

  it('labels the first few', () => {
    expect(overrideLabel(['a', 'b'])).toBe('a, b');
    expect(overrideLabel(['a', 'b', 'c', 'd', 'e'])).toBe('a, b, c +2');
  });

  it('shows a badge only when there are overrides, and its button clears them', () => {
    const host = document.createElement('span');
    host.hidden = true;
    let went = '';
    const loc = { search, hash: '#dev', pathname: '/', assign: (u: string) => { went = u; } };
    mountOverrideBadge(host, loc);
    expect(host.hidden).toBe(false);
    expect(host.textContent).toContain('mq overrides: environment, fishMix, autoRotate');
    expect(host.title).toContain('fishMix = shark:1@chase');
    host.querySelector('button')!.click();
    expect(went).toBe('/?saver=metaquarium-recipe-snail-garden&seed=42#dev');
    const quiet = document.createElement('span');
    quiet.hidden = true;
    mountOverrideBadge(quiet, { ...loc, search: '?saver=warp' });
    expect(quiet.hidden).toBe(true);
  });
});
