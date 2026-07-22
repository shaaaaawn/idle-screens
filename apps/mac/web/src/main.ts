/**
 * Fullscreen host page for the macOS wrapper. Mounts one saver at a time into
 * a fullscreen div, cycling through the registry on a timer unless a specific
 * saver is pinned via ?saver=<id>. The Swift shell can also steer it through
 * window.__idleScreensMac (setSaver / next / setPaused).
 */
import { SAVERS as ALL_SAVERS } from './savers';
import { createMacHostController, saverIndex } from './host-controller';

const params = new URLSearchParams(location.search);
const pinned = params.get('saver');
const cycleMinutes = Number(params.get('cycle') ?? '10');
const baseSeed = Number(params.get('seed') ?? Date.now()) >>> 0;
const brightness = Math.max(0.1, Math.min(1, Number(params.get('brightness') ?? '1')));

const host = document.getElementById('host')!;
if (brightness < 1) host.style.filter = `brightness(${brightness})`;

host.style.transition = 'opacity 220ms ease';
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const showHints = params.get('hints') !== '0';
const showBrowseHint = params.get('browse') !== '0';

const hintEl = document.getElementById('hint');
let hintTimer: ReturnType<typeof setTimeout> | null = null;
function showHint(label: string): void {
  if (!hintEl || !showHints) return;
  hintEl.innerHTML = showBrowseHint
    ? `${label}<span class="sep">·</span><span class="keys">← → browse · Esc exit</span>`
    : label;
  hintEl.classList.add('show');
  if (hintTimer) clearTimeout(hintTimer);
  hintTimer = setTimeout(() => hintEl.classList.remove('show'), 3500);
}

const toastEl = document.getElementById('toast');
let toastTimer: ReturnType<typeof setTimeout> | null = null;
function showToast(text: string): void {
  if (!toastEl) return;
  toastEl.textContent = text;
  toastEl.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1400);
}

const controller = createMacHostController({
  host,
  savers: ALL_SAVERS,
  baseSeed,
  reduceMotion,
  showHint,
  dpr: window.devicePixelRatio || 1,
  viewport: { width: window.innerWidth, height: window.innerHeight },
});

window.addEventListener('resize', () => controller.resize());

let cycleTimer: ReturnType<typeof setInterval> | null = null;
function startCycle(): void {
  if (cycleTimer) clearInterval(cycleTimer);
  if (pinned || cycleMinutes <= 0) return;
  cycleTimer = setInterval(
    () => void controller.mountSaver(controller.currentIndex() + 1),
    cycleMinutes * 60_000,
  );
}

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
window.__idleScreensMac = controller.createBridge(showToast);

// Hosts without native key routing (Linux windowed dev) handle browse + quit here.
// Mac handles ←/→ in Swift; duplicate calls are harmless (same saver index).
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    window.location.href = 'idle-screens://quit';
    return;
  }
  if (!showBrowseHint) return;
  if (e.key === 'ArrowLeft') {
    e.preventDefault();
    window.__idleScreensMac.prev();
  } else if (e.key === 'ArrowRight') {
    e.preventDefault();
    window.__idleScreensMac.next();
  }
});

const start = pinned ? Math.max(0, saverIndex(pinned, ALL_SAVERS)) : Math.floor(Math.random() * ALL_SAVERS.length);
void controller.mountSaver(start);
startCycle();
