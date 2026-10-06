/**
 * Fullscreen host page for the macOS wrapper. Mounts one saver at a time into
 * a fullscreen div, cycling through the registry on a timer unless a specific
 * saver is pinned via ?saver=<id>. The Swift shell can also steer it through
 * window.__idleScreensMac (setSaver / next / setPaused).
 */
import { SAVERS as REGISTERED_SAVERS } from './savers';
import { createMacHostController, saverIndex } from './host-controller';
import { renderActivity } from './activity';
import {
  clampCapabilities,
  gateSavers,
  isBackendName,
  probeCapabilitiesSync,
} from './capability-ladder';
import { attachFrameWatchdog, createFrameWatchdog } from './frame-watchdog';

const params = new URLSearchParams(location.search);
const pinned = params.get('saver');
const cycleMinutes = Number(params.get('cycle') ?? '10');
const baseSeed = Number(params.get('seed') ?? Date.now()) >>> 0;
const brightness = Math.max(0.1, Math.min(1, Number(params.get('brightness') ?? '1')));

// Capability ladder. `?maxBackend=` is the native host telling us what this box
// can really drive — feature detection cannot see a *weak* GPU, only a missing
// one, and a Raspberry Pi answers "yes" to WebGL2 while rendering three.js at a
// crawl. Linux derives it from /proc/device-tree (Broadcom V3D), macOS from
// hw.model. Absent the parameter, nothing is clamped and behaviour is unchanged.
const ceilingParam = params.get('maxBackend');
const ceiling = ceilingParam && isBackendName(ceilingParam) ? ceilingParam : null;
if (ceilingParam && !ceiling) console.warn(`ignoring unknown ?maxBackend=${ceilingParam}`);

const gate = gateSavers(REGISTERED_SAVERS, clampCapabilities(probeCapabilitiesSync(), ceiling));
const ALL_SAVERS = gate.playable;
if (gate.blocked.length > 0) {
  console.info(
    `capability tier ${gate.tier} (budget ${gate.budget}` +
      `${ceiling ? `, host ceiling ${ceiling}` : ''}): ` +
      `${ALL_SAVERS.length}/${REGISTERED_SAVERS.length} savers playable`,
  );
  for (const b of gate.blocked) console.info(`  skipping ${b.id}: ${b.reasons.join('; ')}`);
}
if (gate.fallback) {
  // Gating would have left an empty list. Rendering something badly beats
  // rendering nothing, so the cheapest saver is kept and the watchdog below is
  // what stops it from being a slideshow.
  console.warn('no saver fits this device; keeping the cheapest and relying on step-down');
}

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
  hintEl.replaceChildren(document.createTextNode(label));
  if (showBrowseHint) {
    const sep = document.createElement('span');
    sep.className = 'sep';
    sep.textContent = '·';
    const keys = document.createElement('span');
    keys.className = 'keys';
    keys.textContent = '← → browse · Esc exit';
    hintEl.append(sep, keys);
  }
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
      setActivity(sections: unknown): void;
    };
  }
}
// System-activity HUD: the Swift shell pushes sections (docker / apple
// containers / MCP processes / dev servers) while the saver is showing.
const activityEl = document.getElementById('activity');
const showActivity = params.get('activity') !== '0';
window.__idleScreensMac = {
  ...controller.createBridge(showToast),
  setActivity(sections: unknown) {
    if (activityEl && showActivity) renderActivity(activityEl, sections);
  },
};

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

// Runtime step-down. Preflight gating works from what the device claims; this
// works from what it actually delivers — a channel can publish an arbitrarily
// heavy scene, and a Pi reports WebGL2 truthfully while rendering it at 4fps.
// On sustained overrun, move to a cheaper saver; at the floor, stop cycling so
// we cannot rotate back into something heavy.
const costRank = (id: string): number =>
  ['idle', 'low', 'medium', 'high'].indexOf(
    ALL_SAVERS.find((sv) => sv.manifest.id === id)?.manifest.costTier ?? 'idle',
  );

const watchdog = createFrameWatchdog({
  onLevel: (level, reason) => {
    console.warn(`frame watchdog: ${reason}`);
    const here = costRank(controller.currentId());
    // Cheapest first, and strictly cheaper than what is on screen now.
    const cheaper = [...ALL_SAVERS]
      .sort((a, b) => costRank(a.manifest.id) - costRank(b.manifest.id))
      .find((sv) => costRank(sv.manifest.id) < here);

    if (level === 'cheapest' && cycleTimer) {
      clearInterval(cycleTimer);
      cycleTimer = null;
    }
    if (!cheaper) return; // already the cheapest thing we have
    const i = saverIndex(cheaper.manifest.id, ALL_SAVERS);
    if (i >= 0) void controller.mountSaver(i, true, { skipOnFail: true }).catch(() => {});
  },
});
attachFrameWatchdog(watchdog);

const start = pinned ? Math.max(0, saverIndex(pinned, ALL_SAVERS)) : Math.floor(Math.random() * ALL_SAVERS.length);
void controller
  .mountSaver(start, true, { skipOnFail: !pinned })
  .then(() => watchdog.reset())
  .catch(() => {});
startCycle();
