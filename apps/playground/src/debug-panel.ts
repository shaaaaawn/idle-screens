import type { SaverPlugin } from '@idle-screens/core';
import {
  computeTier,
  costBudget,
  detectCapabilities,
  evaluateSaver,
  type Capabilities,
  type SaverEligibility,
  type SaverInfo,
} from '@idle-screens/capabilities';
import { formatBackendLabel } from './preview-backend';

export interface DebugContext {
  saver: SaverPlugin | null;
  previewActive: boolean;
  previewSize?: { w: number; h: number };
}

export interface DebugHandle {
  setContext(ctx: DebugContext): void;
  dispose(): void;
}

const toInfo = (s: SaverPlugin): SaverInfo => ({
  id: s.manifest.id,
  minBackend: s.manifest.minBackend,
  costTier: s.manifest.costTier,
  motionIntensity: s.manifest.motionIntensity,
  reducedMotionFallback: s.manifest.reducedMotionFallback,
});

function chip(label: string, on: boolean, title?: string): string {
  const cls = on ? 'dbg-chip on' : 'dbg-chip';
  return `<span class="${cls}"${title ? ` title="${title}"` : ''}>${label}</span>`;
}

function stat(label: string, value: string, title?: string): string {
  return `<span class="dbg-stat"${title ? ` title="${title}"` : ''}><span class="dbg-k">${label}</span><span class="dbg-v">${value}</span></span>`;
}

function eligClass(status: SaverEligibility['status']): string {
  if (status === 'ok') return 'dbg-ok';
  if (status === 'degraded') return 'dbg-warn';
  return 'dbg-bad';
}

export function buildDebugPanel(mount: HTMLElement): DebugHandle {
  let caps: Capabilities | null = null;
  let ctx: DebugContext = { saver: null, previewActive: false };
  let rafId = 0;
  let frames = 0;
  let fps = 0;
  let frameMs = 0;
  let longTasks = 0;
  let fpsAnchor = performance.now();
  let longAnchor = performance.now();

  const bar = document.createElement('div');
  bar.className = 'dbg-grid';
  bar.innerHTML = '<span class="dbg-loading">probing device…</span>';
  mount.append(bar);

  const longObserver =
    typeof PerformanceObserver !== 'undefined'
      ? new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            if (e.duration >= 50) longTasks++;
          }
        })
      : null;
  try {
    longObserver?.observe({ entryTypes: ['longtask'] });
  } catch {
    // Safari / older browsers
  }

  void detectCapabilities().then((c) => {
    caps = c;
    paint();
  });

  const overlayThread = (): string => {
    const el = document.querySelector('idle-screen') as { isWorker?: boolean } | null;
    if (!el) return '—';
    return el.isWorker ? 'worker' : 'main';
  };

  const engineState = (): string => {
    const api = (window as unknown as { __idleScreens?: { state(): string } }).__idleScreens;
    return api?.state() ?? '—';
  };

  const paint = (): void => {
    if (!caps) return;
    const tier = computeTier(caps);
    const budget = costBudget(tier);
    const b = caps.backends;

    const saver = ctx.saver;
    const elig = saver ? evaluateSaver(toInfo(saver), caps) : null;
    const eligLabel = elig
      ? `${elig.status}${elig.reasons.length ? ` · ${elig.reasons[0]}` : ''}`
      : '—';

    const previewThread = ctx.previewActive ? 'main' : '—';
    const size = ctx.previewSize ? `${ctx.previewSize.w}×${ctx.previewSize.h}` : '—';
    const workerReady = saver?.manifest.workerReady ? 'yes' : 'no';
    const workerCap = b.offscreenCanvas && typeof Worker !== 'undefined';
    const previewHost = ctx.previewActive ? document.getElementById('viewport-host') : null;
    const activeBackend = saver && ctx.previewActive
      ? formatBackendLabel(saver.manifest.id, saver.manifest.minBackend ?? 'css', previewHost)
      : '—';

    bar.innerHTML = [
      '<section class="dbg-section">',
      '<div class="dbg-section-title">Runtime</div>',
      '<div class="dbg-metrics">',
      stat('fps', ctx.previewActive ? String(fps) : '—', 'Display refresh while preview runs'),
      stat('frame', ctx.previewActive && fps > 0 ? `${frameMs.toFixed(1)}ms` : '—'),
      stat('jank', longTasks > 0 ? String(longTasks) : '0', 'Long tasks ≥50ms / sec'),
      stat('preview', previewThread),
      stat('backend', activeBackend, 'Runtime backend in inline preview'),
      stat('overlay', overlayThread(), 'Saver thread when sleep dialog is open'),
      stat('state', engineState()),
      stat('size', size),
      '</div></section>',
      '<section class="dbg-section">',
      '<div class="dbg-section-title">Device</div>',
      '<div class="dbg-metrics">',
      stat('tier', tier),
      stat('budget', budget),
      stat('dpr', caps.dpr !== undefined ? String(caps.dpr) : '—'),
      stat('cores', caps.hardwareConcurrency !== undefined ? String(caps.hardwareConcurrency) : '—'),
      saver
        ? `<span class="dbg-stat"><span class="dbg-k">elig</span><span class="dbg-v ${eligClass(elig!.status)}">${eligLabel}</span></span>`
        : stat('elig', '—'),
      stat('w-ready', workerReady, 'manifest.workerReady'),
      caps.reducedMotion ? stat('a11y', 'reduced') : '',
      '</div>',
      '<div class="dbg-chips">',
      chip('2d', b.canvas2d, 'canvas2d'),
      chip('gl2', b.webgl2, 'webgl2'),
      chip('gpu', b.webgpu, 'webgpu'),
      chip('off', b.offscreenCanvas, 'OffscreenCanvas'),
      chip('worker', workerCap, 'Worker available'),
      '</div></section>',
    ].join('');
  };

  const tick = (now: number): void => {
    frames++;
    const elapsed = now - fpsAnchor;
    if (elapsed >= 1000) {
      fps = Math.round((frames * 1000) / elapsed);
      frameMs = fps > 0 ? 1000 / fps : 0;
      frames = 0;
      fpsAnchor = now;
      if (now - longAnchor >= 1000) {
        longAnchor = now;
        longTasks = 0;
      }
      paint();
    }
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);

  return {
    setContext(next) {
      ctx = next;
      paint();
    },
    dispose() {
      cancelAnimationFrame(rafId);
      longObserver?.disconnect();
    },
  };
}
