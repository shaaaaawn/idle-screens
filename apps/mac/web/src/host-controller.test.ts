// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import type { SaverInstance, SaverPlugin } from '@idle-screens/core';
import {
  createMacHostController,
  normalizeSaverIndex,
  saverIndex,
} from './host-controller';

const broken = (id: string): SaverPlugin => ({
  manifest: { id, label: id },
  mount: () => {
    throw new Error(`${id} needs a GPU this box does not have`);
  },
});

const plugin = (id: string): SaverPlugin => ({
  manifest: { id, label: id },
  mount: (ctx) => {
    ctx.host.appendChild(document.createElement('div'));
    return {
      setPaused: vi.fn(),
      resize: vi.fn(),
      dispose: vi.fn(),
    };
  },
});

describe('mac host helpers', () => {
  it('normalizeSaverIndex wraps negatives and overflow', () => {
    expect(normalizeSaverIndex(-1, 3)).toBe(2);
    expect(normalizeSaverIndex(4, 3)).toBe(1);
  });

  it('saverIndex finds plugins by id', () => {
    const savers = [plugin('a'), plugin('b')];
    expect(saverIndex('b', savers)).toBe(1);
    expect(saverIndex('missing', savers)).toBe(-1);
  });
});

describe('createMacHostController', () => {
  it('mounts a saver into the host and exposes the bridge API', async () => {
    const host = document.createElement('div');
    const savers = [plugin('alpha'), plugin('beta')];
    const hints: string[] = [];
    const controller = createMacHostController({
      host,
      savers,
      baseSeed: 10,
      reduceMotion: false,
      showHint: (label) => hints.push(label),
      sleep: async () => {},
    });

    await controller.mountSaver(1);

    expect(host.childElementCount).toBeGreaterThan(0);
    expect(host.style.opacity).toBe('1');
    expect(controller.currentId()).toBe('beta');
    expect(hints).toEqual(['beta']);

    const inst = controller.getInstance() as SaverInstance & { setPaused: ReturnType<typeof vi.fn> };
    expect(inst.setPaused).toHaveBeenCalledWith(false);

    const bridge = controller.createBridge(vi.fn());
    expect(bridge.savers).toEqual(['alpha', 'beta']);
    expect(bridge.currentId()).toBe('beta');
  });

  it('setPaused on the bridge forwards to the active instance', async () => {
    const host = document.createElement('div');
    const controller = createMacHostController({
      host,
      savers: [plugin('one')],
      baseSeed: 0,
      reduceMotion: true,
      sleep: async () => {},
    });
    await controller.mountSaver(0);
    const inst = controller.getInstance() as SaverInstance & { setPaused: ReturnType<typeof vi.fn> };
    inst.setPaused.mockClear();

    controller.createBridge(vi.fn()).setPaused(false);
    expect(inst.setPaused).toHaveBeenCalledWith(false);
  });

  it('skips cross-fade on the first mount', async () => {
    const host = document.createElement('div');
    const sleeps: number[] = [];
    const controller = createMacHostController({
      host,
      savers: [plugin('one')],
      baseSeed: 0,
      reduceMotion: false,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    await controller.mountSaver(0);
    expect(sleeps).toEqual([]);
  });

  it('bridge setSaver, next, and prev remount by saver id or index', async () => {
    const host = document.createElement('div');
    const hints: string[] = [];
    const controller = createMacHostController({
      host,
      savers: [plugin('alpha'), plugin('beta'), plugin('gamma')],
      baseSeed: 5,
      reduceMotion: true,
      showHint: (label) => hints.push(label),
      sleep: async () => {},
    });
    await controller.mountSaver(0);
    const bridge = controller.createBridge(vi.fn());

    bridge.setSaver('gamma');
    await vi.waitFor(() => expect(controller.currentId()).toBe('gamma'));
    expect(hints.at(-1)).toBe('gamma');

    bridge.next();
    await vi.waitFor(() => expect(controller.currentId()).toBe('alpha'));
    expect(controller.currentIndex()).toBe(0);

    bridge.prev();
    await vi.waitFor(() => expect(controller.currentId()).toBe('gamma'));
    expect(controller.currentIndex()).toBe(2);
  });

  it('skips a saver that cannot mount instead of leaving a black screen', async () => {
    // The tank is the first saver here that can genuinely fail — it needs
    // WebGL2. Without this the wrapper sat blank until the next cycle tick.
    const host = document.createElement('div');
    const hints: string[] = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const controller = createMacHostController({
      host,
      savers: [plugin('alpha'), broken('tank'), plugin('gamma')],
      baseSeed: 0,
      reduceMotion: true,
      showHint: (label) => hints.push(label),
      sleep: async () => {},
    });

    await controller.mountSaver(1);

    expect(controller.currentId()).toBe('gamma');
    expect(hints).toEqual(['gamma']);
    expect(host.style.opacity).toBe('1');
    warn.mockRestore();
  });

  it('gives up rather than recursing when nothing can mount', async () => {
    const host = document.createElement('div');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const controller = createMacHostController({
      host,
      savers: [broken('a'), broken('b'), broken('c')],
      baseSeed: 0,
      reduceMotion: true,
      sleep: async () => {},
    });

    await expect(controller.mountSaver(0)).rejects.toThrow(/GPU/);
    // Each saver tried exactly once: two skip-warns, then the give-up warn.
    expect(warn).toHaveBeenCalledTimes(3);
    warn.mockRestore();
  });

  it('does not silently replace an explicit pin that cannot mount', async () => {
    // ?saver=tank (or a menu pick) is a choice. Skipping to the next saver
    // would leave the user stuck on the wrong one — pinning also disables
    // the cycle, so they would never rotate off it.
    const host = document.createElement('div');
    const hints: string[] = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const controller = createMacHostController({
      host,
      savers: [plugin('alpha'), broken('tank'), plugin('gamma')],
      baseSeed: 0,
      reduceMotion: true,
      showHint: (label) => hints.push(label),
      sleep: async () => {},
    });

    await expect(controller.mountSaver(1, false, { skipOnFail: false })).rejects.toThrow(/GPU/);
    expect(controller.currentId()).toBe('tank');
    expect(controller.getInstance()).toBeNull();
    expect(hints).toEqual(["tank couldn't start"]);
    expect(host.style.opacity).toBe('1');
    warn.mockRestore();
  });

  it('bridge setSaver does not skip past a saver that fails to mount', async () => {
    const host = document.createElement('div');
    const hints: string[] = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const controller = createMacHostController({
      host,
      savers: [plugin('alpha'), broken('tank'), plugin('gamma')],
      baseSeed: 0,
      reduceMotion: true,
      showHint: (label) => hints.push(label),
      sleep: async () => {},
    });
    await controller.mountSaver(0);
    const bridge = controller.createBridge(vi.fn());

    bridge.setSaver('tank');
    await vi.waitFor(() => expect(hints.at(-1)).toBe("tank couldn't start"));
    expect(controller.currentId()).toBe('tank');
    expect(controller.getInstance()).toBeNull();
    warn.mockRestore();
  });

  it('bridge setSaver ignores unknown ids', async () => {
    const host = document.createElement('div');
    const controller = createMacHostController({
      host,
      savers: [plugin('alpha'), plugin('beta')],
      baseSeed: 0,
      reduceMotion: true,
      sleep: async () => {},
    });
    await controller.mountSaver(0);
    const bridge = controller.createBridge(vi.fn());

    bridge.setSaver('missing');
    await Promise.resolve();
    expect(controller.currentId()).toBe('alpha');
  });
});

describe('scene inputs (SaverSpec `inputs`)', () => {
  // A scene that declares a `builds` roster: one light per slot.
  const spec = {
    schemaVersion: 1, id: 'lights', label: 'Lights',
    layers: [{ key: 'lamp', count: 2, layout: { type: 'table', columns: 2, gap: 0.2 }, region: { x: [0.5, 0.5], y: [0.5, 0.5] },
      sprite: { kind: 'circle', radius: [0.05, 0.05], color: '#222222', colors: ['#222222', '#222222'] }, motion: { type: 'static' } }],
    inputs: { builds: { kind: 'roster', slots: 2, default: 'off',
      states: { off: [{ path: 'lamp.sprite.colors.{i}', value: '#222222' }], red: [{ path: 'lamp.sprite.colors.{i}', value: '#ff0000' }] } } },
  };
  const fedPlugin = (id: string, withSpec: boolean) => {
    const applyTrack = vi.fn();
    const p: SaverPlugin = {
      manifest: { id, label: id },
      ...(withSpec ? { spec: { ...spec, id } } : {}),
      mount: () => ({ setPaused: vi.fn(), resize: vi.fn(), dispose: vi.fn(), applyTrack }),
    };
    return { p, applyTrack };
  };

  it('feeds the mounted scene that declares the input, snapping on mount and gliding after', async () => {
    const a = fedPlugin('lights', true);
    const b = fedPlugin('plain', false);
    const controller = createMacHostController({ host: document.createElement('div'), savers: [b.p, a.p], baseSeed: 1, reduceMotion: false, sleep: async () => {} });

    // Fed before the scene exists: kept, and applied at dur 0 when it mounts.
    controller.feed('builds', [{ slot: 1, state: 'red' }]);
    await controller.mountSaver(0);
    expect(b.applyTrack).not.toHaveBeenCalled(); // a scene without the input is never fed
    await controller.mountSaver(1);
    expect(a.applyTrack).toHaveBeenCalledTimes(1);
    const onMount = a.applyTrack.mock.calls[0]![0];
    expect(onMount.deltas.every((d: { dur: number }) => d.dur === 0)).toBe(true);
    expect(onMount.deltas.find((d: { path: string }) => d.path === 'lamp.sprite.colors.1').value).toBe('#ff0000');

    // A later feed glides.
    controller.feed('builds', [{ slot: 0, state: 'red' }]);
    const later = a.applyTrack.mock.calls[1]![0];
    expect(later.deltas.find((d: { path: string }) => d.path === 'lamp.sprite.colors.0').value).toBe('#ff0000');
    expect(later.deltas.find((d: { path: string }) => d.path === 'lamp.sprite.colors.1').value).toBe('#222222'); // slot 1 left
    expect(later.deltas[0].dur).toBeGreaterThan(0);

    // An input the scene doesn't declare is ignored.
    controller.feed('weather', [{ slot: 0, state: 'rain' }]);
    expect(a.applyTrack).toHaveBeenCalledTimes(2);
  });

  it('the bridge exposes feed to the Swift shell', async () => {
    const a = fedPlugin('lights', true);
    const controller = createMacHostController({ host: document.createElement('div'), savers: [a.p], baseSeed: 1, reduceMotion: false, sleep: async () => {} });
    await controller.mountSaver(0);
    controller.createBridge(() => {}).feed('builds', [{ slot: 0, state: 'red' }]);
    expect(a.applyTrack).toHaveBeenCalledTimes(1);
  });
});
