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
const brightness = Math.max(0.1, Math.min(1, Number(params.get('brightness') ?? '1')));

const host = document.getElementById('host')!;
// Night mode: dim the whole field (works for canvas and DOM savers alike).
if (brightness < 1) host.style.filter = `brightness(${brightness})`;
let instance: SaverInstance | null = null;
let current = -1;
let cycleTimer: ReturnType<typeof setInterval> | null = null;

function saverIndex(id: string): number {
  return ALL_SAVERS.findIndex((s) => s.manifest.id === id);
}

host.style.transition = 'opacity 220ms ease';
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const showHints = params.get('hints') !== '0';

// Auto-fading "<Saver> · ← → to browse" label so users discover the gallery.
const hintEl = document.getElementById('hint');
let hintTimer: ReturnType<typeof setTimeout> | null = null;
function showHint(label: string): void {
  if (!hintEl || !showHints) return;
  hintEl.innerHTML = `${label}<span class="sep">·</span><span class="keys">← → to browse</span>`;
  hintEl.classList.add('show');
  if (hintTimer) clearTimeout(hintTimer);
  hintTimer = setTimeout(() => hintEl.classList.remove('show'), 3500);
}

// Brief top toast for actions like favoriting.
const toastEl = document.getElementById('toast');
let toastTimer: ReturnType<typeof setTimeout> | null = null;
function showToast(text: string): void {
  if (!toastEl) return;
  toastEl.textContent = text;
  toastEl.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1400);
}

async function mountSaver(index: number, fade = true): Promise<void> {
  // Cross-fade: dip the field out, swap the saver, fade back in. Skipped on the
  // very first mount and under reduced-motion.
  const doFade = fade && !reduceMotion && instance !== null;
  if (doFade) {
    host.style.opacity = '0';
    await new Promise((r) => setTimeout(r, 220));
  }
  instance?.dispose();
  instance = null;
  host.innerHTML = '';
  current = ((index % ALL_SAVERS.length) + ALL_SAVERS.length) % ALL_SAVERS.length;
  const plugin = ALL_SAVERS[current]!;
  const seed = (baseSeed + current) >>> 0;
  const inst = await plugin.mount({
    host,
    dpr: window.devicePixelRatio || 1,
    width: window.innerWidth,
    height: window.innerHeight,
    rng: createRng(seed),
    seed,
    reducedMotion: reduceMotion,
  });
  instance = inst;
  inst.setPaused(reduceMotion);
  host.style.opacity = '1';
  showHint(plugin.manifest.label);
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
      prev(): void;
      setPaused(paused: boolean): void;
      toast(text: string): void;
      currentId(): string;
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
  prev() {
    void mountSaver(current - 1);
  },
  setPaused(paused) {
    instance?.setPaused(paused);
  },
  toast(text) {
    showToast(text);
  },
  currentId() {
    return ALL_SAVERS[current]?.manifest.id ?? '';
  },
};

const start = pinned ? Math.max(0, saverIndex(pinned)) : Math.floor(Math.random() * ALL_SAVERS.length);
void mountSaver(start);
startCycle();
