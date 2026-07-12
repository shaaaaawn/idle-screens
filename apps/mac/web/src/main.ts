/**
 * Fullscreen host page for the macOS wrapper. Mounts one saver at a time into
 * a fullscreen div, cycling through the registry on a timer unless a specific
 * saver is pinned via ?saver=<id>. The Swift shell can also steer it through
 * window.__idleScreensMac (setSaver / next / setPaused).
 */
import { createRng } from '@idle-screens/core';
import type { SaverInstance } from '@idle-screens/core';
import { SAVERS as ALL_SAVERS } from './savers';

const params = new URLSearchParams(location.search);
const pinned = params.get('saver');
const cycleMinutes = Number(params.get('cycle') ?? '10');
const baseSeed = Number(params.get('seed') ?? Date.now()) >>> 0;

const host = document.getElementById('host')!;
let instance: SaverInstance | null = null;
let current = -1;
let cycleTimer: ReturnType<typeof setInterval> | null = null;

function saverIndex(id: string): number {
  return ALL_SAVERS.findIndex((s) => s.manifest.id === id);
}

async function mountSaver(index: number): Promise<void> {
  instance?.dispose();
  instance = null;
  host.innerHTML = '';
  current = ((index % ALL_SAVERS.length) + ALL_SAVERS.length) % ALL_SAVERS.length;
  const plugin = ALL_SAVERS[current]!;
  const seed = (baseSeed + current) >>> 0;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const inst = await plugin.mount({
    host,
    dpr: window.devicePixelRatio || 1,
    width: window.innerWidth,
    height: window.innerHeight,
    rng: createRng(seed),
    seed,
    reducedMotion,
  });
  instance = inst;
  inst.setPaused(reducedMotion);
}

window.addEventListener('resize', () => {
  instance?.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
});

function startCycle(): void {
  if (cycleTimer) clearInterval(cycleTimer);
  if (pinned || cycleMinutes <= 0) return;
  cycleTimer = setInterval(() => void mountSaver(current + 1), cycleMinutes * 60_000);
}

// Native bridge for the Swift shell.
declare global {
  interface Window {
    __idleScreensMac: {
      savers: string[];
      setSaver(id: string): void;
      next(): void;
      setPaused(paused: boolean): void;
    };
  }
}
window.__idleScreensMac = {
  savers: ALL_SAVERS.map((s) => s.manifest.id),
  setSaver(id) {
    const i = saverIndex(id);
    if (i >= 0) void mountSaver(i);
  },
  next() {
    void mountSaver(current + 1);
  },
  setPaused(paused) {
    instance?.setPaused(paused);
  },
};

const start = pinned ? Math.max(0, saverIndex(pinned)) : Math.floor(Math.random() * ALL_SAVERS.length);
void mountSaver(start);
startCycle();
