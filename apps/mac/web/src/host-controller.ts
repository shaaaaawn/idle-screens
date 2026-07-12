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
  mountSaver(index: number, fade?: boolean): Promise<void>;
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
    viewport = { width: 800, height: 600 },
    fadeMs = 220,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  } = opts;

  let instance: SaverInstance | null = null;
  let current = -1;

  const mountSaver = async (index: number, fade = true): Promise<void> => {
    const doFade = fade && !reduceMotion && instance !== null;
    if (doFade) {
      host.style.opacity = '0';
      await sleep(fadeMs);
    }
    instance?.dispose();
    instance = null;
    host.innerHTML = '';
    current = normalizeSaverIndex(index, savers.length);
    const plugin = savers[current]!;
    const seed = (baseSeed + current) >>> 0;
    const inst = await plugin.mount({
      host,
      dpr,
      width: viewport.width,
      height: viewport.height,
      rng: createRng(seed),
      seed,
      reducedMotion: reduceMotion,
    });
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
          if (i >= 0) void mountSaver(i);
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
