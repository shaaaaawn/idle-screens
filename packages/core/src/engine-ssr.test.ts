// Default (node) environment: there is NO window/document here, so this file is
// the honest SSR/prerender test — importing + constructing + init/destroy must be
// inert, never touching the DOM.
import { describe, it, expect } from 'vitest';
import { IdleScreensEngine } from './engine';
import type { SaverPlugin } from './types';

const plugin = (id: string): SaverPlugin => ({
  manifest: { id, label: id },
  mount: () => ({ setPaused() {}, resize() {}, dispose() {} }),
});

describe('IdleScreensEngine — SSR / no window (E1)', () => {
  it('confirms there is no window in this environment', () => {
    expect(typeof window).toBe('undefined');
  });

  it('constructs without throwing and resolves initial state', () => {
    const store = new Map<string, string>();
    const e = new IdleScreensEngine(
      { defaultPluginId: 'b', storage: { get: (k) => store.get(k) ?? null, set: (k, v) => void store.set(k, v) } },
      [plugin('a'), plugin('b')],
    );
    expect(e.state.value).toBe('awake');
    expect(e.activePlugin.value?.manifest.id).toBe('b');
    expect(e.pluginList).toEqual([
      { id: 'a', label: 'a' },
      { id: 'b', label: 'b' },
    ]);
  });

  it('init() and destroy() are no-ops (no window.__idleScreens, no throw)', () => {
    const e = new IdleScreensEngine({}, [plugin('a')]);
    expect(() => {
      e.init();
      e.destroy();
    }).not.toThrow();
    expect((globalThis as { __idleScreens?: unknown }).__idleScreens).toBeUndefined();
  });

  it('default storage is safe without window (returns null / swallows writes)', () => {
    const e = new IdleScreensEngine({}, [plugin('a')]); // no injected storage
    expect(() => e.setPlugin('a')).not.toThrow();
  });
});
