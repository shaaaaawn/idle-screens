import type { BackendSupport, Capabilities } from './types';

const hasDoc = typeof document !== 'undefined';
const hasNav = typeof navigator !== 'undefined';

function mm(query: string): boolean {
  return typeof matchMedia === 'function' ? matchMedia(query).matches : false;
}

function probeContext(type: '2d' | 'webgl2'): boolean {
  if (!hasDoc) return false;
  try {
    // A canvas can only ever hold ONE context type, so probe each on a FRESH canvas.
    const canvas = document.createElement('canvas');
    return canvas.getContext(type) != null;
  } catch {
    return false;
  }
}

async function probeWebGpu(): Promise<boolean> {
  // `'gpu' in navigator` is a false positive — an adapter can still be null/blocklisted.
  const gpu = (hasNav ? (navigator as unknown as { gpu?: { requestAdapter?: () => Promise<unknown> } }).gpu : undefined);
  if (!gpu?.requestAdapter) return false;
  try {
    return (await gpu.requestAdapter()) != null;
  } catch {
    return false;
  }
}

function detectBackendsSync(): BackendSupport {
  return {
    css: true, // if a DOM exists at all, CSS is available
    canvas2d: probeContext('2d'),
    webgl2: probeContext('webgl2'),
    webgpu: false, // resolved asynchronously by detectCapabilities()
    offscreenCanvas: hasDoc && typeof HTMLCanvasElement.prototype.transferControlToOffscreen === 'function',
  };
}

/**
 * Probe real device capabilities. Async so it can `await` the WebGPU adapter (the only
 * honest webgpu check). SSR-safe: with no DOM it returns a minimal css-only snapshot.
 * Every optional field is left `undefined` when the platform doesn't expose it.
 */
export async function detectCapabilities(): Promise<Capabilities> {
  if (!hasDoc) {
    return { backends: { css: true, canvas2d: false, webgl2: false, webgpu: false, offscreenCanvas: false } };
  }
  const backends = detectBackendsSync();
  backends.webgpu = await probeWebGpu();

  const nav = hasNav ? (navigator as unknown as {
    hardwareConcurrency?: number;
    deviceMemory?: number;
    connection?: { saveData?: boolean; effectiveType?: string };
  }) : undefined;

  const colorScheme = mm('(prefers-color-scheme: dark)')
    ? 'dark'
    : mm('(prefers-color-scheme: light)')
      ? 'light'
      : 'no-preference';

  return {
    backends,
    reducedMotion: mm('(prefers-reduced-motion: reduce)'),
    dpr: typeof devicePixelRatio === 'number' ? devicePixelRatio : undefined,
    coarsePointer: mm('(pointer: coarse)'),
    screen: typeof screen !== 'undefined' ? { w: screen.width, h: screen.height } : undefined,
    hardwareConcurrency: nav?.hardwareConcurrency,
    deviceMemoryGb: nav?.deviceMemory,
    saveData: nav?.connection?.saveData,
    effectiveType: nav?.connection?.effectiveType,
    colorScheme,
  };
}
