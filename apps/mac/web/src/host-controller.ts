import { createRng } from '@idle-screens/core';
import type { SaverInstance, SaverPlugin } from '@idle-screens/core';

export function normalizeSaverIndex(index: number, length: number): number {
  return ((index % length) + length) % length;
}

export function saverIndex(id: string, savers: readonly SaverPlugin[]): number {
  return savers.findIndex((s) => s.manifest.id === id);
}

export interface MacHostBridge {
  savers: string[];
  setSaver(id: string): void;
  next(): void;
  prev(): void;
  setPaused(paused: boolean): void;
  toast(text: string): void;
  currentId(): string;
}

export interface MacHostController {
  mountSaver(index: number, fade?: boolean, opts?: { skipOnFail?: boolean }): Promise<void>;
  setPaused(paused: boolean): void;
  resize(): void;
  currentId(): string;
  currentIndex(): number;
  getInstance(): SaverInstance | null;
  createBridge(onToast: (text: string) => void): MacHostBridge;
}

export interface MacHostOptions {
  host: HTMLElement;
  savers: readonly SaverPlugin[];
  baseSeed: number;
  reduceMotion: boolean;
  showHint?: (label: string) => void;
  dpr?: number;
  viewport?: { width: number; height: number };
  fadeMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export function createMacHostController(opts: MacHostOptions): MacHostController {
  const {
    host,
    savers,
    baseSeed,
    reduceMotion,
    showHint = () => {},
    dpr = 1,
    fadeMs = 220,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  } = opts;
  let viewport = opts.viewport ?? { width: 800, height: 600 };

  let instance: SaverInstance | null = null;
  let current = -1;
  let generation = 0;

  const mountSaver = async (
    index: number,
    fade = true,
    opts?: { skipOnFail?: boolean; remaining?: number },
  ): Promise<void> => {
    const skipOnFail = opts?.skipOnFail ?? true;
    const remaining = opts?.remaining ?? savers.length - 1;
    const gen = ++generation;
    const doFade = fade && !reduceMotion && instance !== null;
    if (doFade) {
      host.style.opacity = '0';
      await sleep(fadeMs);
    }
    if (gen !== generation) return;
    instance?.dispose();
    instance = null;
    host.innerHTML = '';
    current = normalizeSaverIndex(index, savers.length);
    const plugin = savers[current]!;
    const seed = (baseSeed + current) >>> 0;
    let inst: SaverInstance;
    try {
      inst = await plugin.mount({
        host,
        dpr,
        width: viewport.width,
        height: viewport.height,
        rng: createRng(seed),
        seed,
        reducedMotion: reduceMotion,
      });
    } catch (err) {
      if (gen !== generation) return;
      host.style.opacity = '1';
      // Move on rather than sit on a black screen. Every saver here used to be
      // canvas2d and could not really fail; the tank needs WebGL2, so on a host
      // without it a throw would leave the wrapper blank until the cycle timer
      // came round — ten minutes of nothing, which reads as a broken app.
      //
      // Skip only on the cycle path. A pin (`?saver=`) or a menu pick is an
      // explicit choice: swapping in a different saver and leaving the user
      // stuck on it (pinning also disables the cycle) is worse than a toast
      // on a blank host. `remaining` still bounds the cycle chain so a
      // machine that can run none of them stops instead of recursing forever.
      if (skipOnFail && remaining > 0) {
        console.warn(`saver ${plugin.manifest.id} failed to mount, skipping`, err);
        return mountSaver(current + 1, false, { skipOnFail: true, remaining: remaining - 1 });
      }
      console.warn(`saver ${plugin.manifest.id} failed to mount`, err);
      showHint(`${plugin.manifest.label} couldn't start`);
      throw err;
    }
    if (gen !== generation) {
      inst.dispose();
      return;
    }
    instance = inst;
    inst.setPaused(reduceMotion);
    host.style.opacity = '1';
    showHint(plugin.manifest.label);
  };

  return {
    mountSaver,
    setPaused(paused: boolean) {
      instance?.setPaused(paused);
    },
    resize() {
      viewport = { width: host.clientWidth, height: host.clientHeight };
      instance?.resize(viewport.width, viewport.height, dpr);
    },
    currentId() {
      return savers[current]?.manifest.id ?? '';
    },
    currentIndex() {
      return current;
    },
    getInstance() {
      return instance;
    },
    createBridge(onToast) {
      return {
        savers: savers.map((s) => s.manifest.id),
        setSaver(id) {
          const i = saverIndex(id, savers);
          // Explicit pick: do not silently swap in the next saver. The
          // rejection is already logged + hinted inside mountSaver.
          if (i >= 0) void mountSaver(i, true, { skipOnFail: false }).catch(() => {});
        },
        next() {
          void mountSaver(current + 1);
        },
        prev() {
          void mountSaver(current - 1);
        },
        setPaused(paused) {
          instance?.setPaused(paused);
        },
        toast: onToast,
        currentId() {
          return savers[current]?.manifest.id ?? '';
        },
      };
    },
  };
}
