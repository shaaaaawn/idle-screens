// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import type { SaverInstance, SaverPlugin } from '@idle-screens/core';
import {
  createMacHostController,
  normalizeSaverIndex,
  saverIndex,
} from './host-controller';

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
