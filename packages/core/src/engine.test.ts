// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IdleScreensEngine } from './engine';
import type { IdleScreensConfig, SaverPlugin } from './types';

const FAKE = {
  toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'],
} as Parameters<typeof vi.useFakeTimers>[0];

const setURL = (u: string): void =>
  (window as unknown as { happyDOM: { setURL(u: string): void } }).happyDOM.setURL(u);

const plugin = (id: string, opts: { label?: string; passthrough?: boolean } = {}): SaverPlugin => ({
  manifest: { id, label: opts.label ?? id.toUpperCase(), passthrough: opts.passthrough },
  mount: () => ({ setPaused() {}, resize() {}, dispose() {} }),
});

const mapStorage = () => {
  const map = new Map<string, string>();
  return { get: (k: string) => map.get(k) ?? null, set: (k: string, v: string) => void map.set(k, v), map };
};

interface MMControl {
  set(v: boolean): void;
  restore(): void;
}
const installMatchMedia = (initial: boolean): MMControl => {
  const listeners = new Set<(e: { matches: boolean }) => void>();
  let matches = initial;
  const mql = {
    get matches() {
      return matches;
    },
    media: '(prefers-reduced-motion: reduce)',
    addEventListener: (_t: string, cb: (e: { matches: boolean }) => void) => listeners.add(cb),
    removeEventListener: (_t: string, cb: (e: { matches: boolean }) => void) => listeners.delete(cb),
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => true,
    onchange: null,
  };
  const orig = window.matchMedia;
  (window as unknown as { matchMedia: unknown }).matchMedia = () => mql;
  return {
    set(v: boolean) {
      matches = v;
      listeners.forEach((cb) => cb({ matches: v }));
    },
    restore() {
      (window as unknown as { matchMedia: unknown }).matchMedia = orig;
    },
  };
};

const setVisibility = (hidden: boolean): void => {
  Object.defineProperty(document, 'visibilityState', { value: hidden ? 'hidden' : 'visible', configurable: true });
  Object.defineProperty(document, 'hidden', { value: hidden, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
};

let engines: IdleScreensEngine[] = [];
const make = (config: Partial<IdleScreensConfig> = {}, plugins?: SaverPlugin[]): IdleScreensEngine => {
  const e = new IdleScreensEngine(
    { storage: mapStorage(), ...config },
    plugins ?? [plugin('a'), plugin('b'), plugin('c')],
  );
  engines.push(e);
  return e;
};

beforeEach(() => {
  vi.useFakeTimers(FAKE);
  setURL('https://example.com/');
});
afterEach(() => {
  engines.forEach((e) => e.destroy());
  engines = [];
  delete (window as unknown as { __idleScreens?: unknown }).__idleScreens;
  setVisibility(false);
  vi.useRealTimers();
});

describe('IdleScreensEngine (E2-E22)', () => {
  it('E2: initial active = stored (if registered) else defaultPluginId else first', () => {
    const st = mapStorage();
    st.map.set('idleScreens.plugin', 'b');
    expect(new IdleScreensEngine({ storage: st }, [plugin('a'), plugin('b')]).activePlugin.value?.manifest.id).toBe('b');

    expect(make({ defaultPluginId: 'c' }).activePlugin.value?.manifest.id).toBe('c');

    const st2 = mapStorage();
    st2.map.set('idleScreens.plugin', 'zzz'); // not registered
    expect(new IdleScreensEngine({ storage: st2, defaultPluginId: 'a' }, [plugin('a'), plugin('b')]).activePlugin.value?.manifest.id).toBe('a');

    expect(make({}).activePlugin.value?.manifest.id).toBe('a'); // first
  });

  it('E3/E4: awake->sleep->wake->toggle transitions', () => {
    const e = make();
    expect(e.state.value).toBe('awake');
    expect(e.isSleeping.value).toBe(false);
    e.sleep();
    expect(e.isSleeping.value).toBe(true);
    e.wake();
    expect(e.isSleeping.value).toBe(false);
    e.toggle();
    expect(e.isSleeping.value).toBe(true);
    e.toggle();
    expect(e.isSleeping.value).toBe(false);
  });

  it('E5: sleep() respects suppress; forceSleep() bypasses it', () => {
    const e = make({ suppress: () => true });
    e.sleep();
    expect(e.isSleeping.value).toBe(false); // suppressed
    e.forceSleep();
    expect(e.isSleeping.value).toBe(true); // bypasses
  });

  it('E5: suppress receives the current URL', () => {
    setURL('https://example.com/digital/x?q=1');
    const seen: string[] = [];
    const e = make({ suppress: (url: string) => (seen.push(url), url.startsWith('/digital')) });
    e.sleep();
    expect(seen).toContain('/digital/x?q=1');
    expect(e.isSleeping.value).toBe(false);
  });

  it('E6: disableOnLocalhost suppresses on localhost', () => {
    setURL('http://localhost:4200/');
    const e = make({ disableOnLocalhost: true });
    e.sleep();
    expect(e.isSleeping.value).toBe(false);
    e.forceSleep();
    expect(e.isSleeping.value).toBe(true); // forceSleep still bypasses
  });

  it('E8: selection "fixed" keeps a chosen saver across sleeps', () => {
    const e = make({ selection: 'fixed', defaultPluginId: 'a' });
    e.setPlugin('b');
    e.forceSleep();
    expect(e.activePlugin.value?.manifest.id).toBe('b');
    e.wake();
    e.forceSleep();
    expect(e.activePlugin.value?.manifest.id).toBe('b'); // did NOT revert to default 'a'
  });

  it('E9: selection "random" is seeded/deterministic', () => {
    const run = (): string[] => {
      const e = make({ selection: 'random', seed: 777 });
      const ids: string[] = [];
      for (let i = 0; i < 6; i++) {
        e.forceSleep();
        ids.push(e.activePlugin.value!.manifest.id);
        e.wake();
      }
      return ids;
    };
    expect(run()).toEqual(run());
  });

  it('E10: selection "rotate" advances and wraps', () => {
    const e = make({ selection: 'rotate' }); // active starts 'a'
    const seq: string[] = [];
    for (let i = 0; i < 4; i++) {
      e.forceSleep();
      seq.push(e.activePlugin.value!.manifest.id);
      e.wake();
    }
    expect(seq).toEqual(['b', 'c', 'a', 'b']);
  });

  it('E11: setPlugin sets + persists; unknown id ignored', () => {
    const st = mapStorage();
    const e = new IdleScreensEngine({ storage: st }, [plugin('a'), plugin('b')]);
    engines.push(e);
    e.setPlugin('b');
    expect(e.activePlugin.value?.manifest.id).toBe('b');
    expect(st.map.get('idleScreens.plugin')).toBe('b');
    e.setPlugin('nope');
    expect(e.activePlugin.value?.manifest.id).toBe('b'); // unchanged
    expect(st.map.get('idleScreens.plugin')).toBe('b');
  });

  it('E7/E14: idle fires sleep; wake restarts the countdown', () => {
    const e = make({ timeoutMs: 1000, sleepOnBlur: false });
    e.init();
    vi.advanceTimersByTime(1000);
    expect(e.isSleeping.value).toBe(true); // E14
    e.wake();
    expect(e.isSleeping.value).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(e.isSleeping.value).toBe(true); // E7: countdown restarted -> slept again
  });

  it('E12: reducedMotion mirrors matchMedia and reacts to change', () => {
    const mm = installMatchMedia(true);
    try {
      const e = make();
      e.init();
      expect(e.reducedMotion.value).toBe(true);
      mm.set(false);
      expect(e.reducedMotion.value).toBe(false);
      mm.set(true);
      expect(e.reducedMotion.value).toBe(true);
    } finally {
      mm.restore();
    }
  });

  it('E13: sleepOnBlur sleeps on window blur (respecting suppress)', () => {
    const e = make({ sleepOnBlur: true });
    e.init();
    window.dispatchEvent(new Event('blur'));
    expect(e.isSleeping.value).toBe(true);

    const e2 = make({ sleepOnBlur: false });
    e2.init();
    window.dispatchEvent(new Event('blur'));
    expect(e2.isSleeping.value).toBe(false);

    const e3 = make({ sleepOnBlur: true, suppress: () => true });
    e3.init();
    window.dispatchEvent(new Event('blur'));
    expect(e3.isSleeping.value).toBe(false); // blur honors suppression
  });

  it('E15/E16: clock ticks only while sleeping AND visible; hidden mirrors visibility', () => {
    const e = make({ sleepOnBlur: false });
    e.init();
    vi.advanceTimersByTime(5000);
    e.forceSleep();
    const t0 = e.now.value.getTime();
    vi.advanceTimersByTime(1000);
    const t1 = e.now.value.getTime();
    expect(t1).toBeGreaterThan(t0); // ticking while sleeping+visible

    setVisibility(true);
    expect(e.hidden.value).toBe(true); // E16
    const t2 = e.now.value.getTime();
    vi.advanceTimersByTime(3000);
    expect(e.now.value.getTime()).toBe(t2); // clock stopped while hidden

    setVisibility(false);
    e.wake();
    const t3 = e.now.value.getTime();
    vi.advanceTimersByTime(3000);
    expect(e.now.value.getTime()).toBe(t3); // stopped while awake
  });

  it('E17: activeIsPassthrough follows the active manifest', () => {
    const e = make({ defaultPluginId: 'p' }, [plugin('n'), plugin('p', { passthrough: true })]);
    e.setPlugin('p');
    expect(e.activeIsPassthrough.value).toBe(true);
    e.setPlugin('n');
    expect(e.activeIsPassthrough.value).toBe(false);
  });

  it('E18: config-menu API is independent of sleep/wake', () => {
    const e = make();
    expect(e.configMenuOpen.value).toBe(false);
    e.openConfigMenu();
    expect(e.configMenuOpen.value).toBe(true);
    e.toggleConfigMenu();
    expect(e.configMenuOpen.value).toBe(false);
    // open while asleep; waking does not close it
    e.forceSleep();
    e.openConfigMenu();
    expect(e.configMenuOpen.value).toBe(true);
    e.wake();
    expect(e.configMenuOpen.value).toBe(true);
    e.closeConfigMenu();
    expect(e.configMenuOpen.value).toBe(false);
  });

  it('E19: configMenu resolves to null when disabled, filled otherwise', () => {
    expect(make({ configMenu: false }).configMenu).toBeNull();
    expect(make({ configMenu: { enabled: false } }).configMenu).toBeNull();
    expect(make({}).configMenu).toMatchObject({ enabled: true, showPicker: true });
    expect(make({ configMenu: { title: 'X' } }).configMenu?.title).toBe('X');
  });

  it('E20: init installs window.__idleScreens with the full hook surface', () => {
    const e = make();
    e.init();
    const hook = (window as unknown as { __idleScreens?: Record<string, unknown> }).__idleScreens!;
    expect(Object.keys(hook).sort()).toEqual(
      ['active', 'closeMenu', 'openMenu', 'plugins', 'setPlugin', 'sleep', 'state', 'menuOpen', 'toggle', 'toggleMenu', 'wake'].sort(),
    );
    (hook.sleep as () => void)();
    expect((hook.state as () => string)()).toBe('sleeping');
    expect((hook.active as () => string)()).toBe('a');
    expect((hook.menuOpen as () => boolean)()).toBe(false);
  });

  it('E21: init is idempotent; destroy removes listeners + stops timers', () => {
    const e = make({ timeoutMs: 1000, sleepOnBlur: true });
    e.init();
    e.init(); // no-op second call
    e.destroy();
    // after destroy: blur no longer sleeps, idle timer cleared, clock stopped
    window.dispatchEvent(new Event('blur'));
    vi.advanceTimersByTime(10_000);
    expect(e.isSleeping.value).toBe(false);
  });

  it('E22: pluginList is {id,label}[] in registration order', () => {
    const e = make({}, [plugin('a', { label: 'Ay' }), plugin('b', { label: 'Bee' })]);
    expect(e.pluginList).toEqual([
      { id: 'a', label: 'Ay' },
      { id: 'b', label: 'Bee' },
    ]);
  });
});
