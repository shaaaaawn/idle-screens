/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Capabilities } from './types';

// happy-dom provides document, navigator, matchMedia, screen — so the module's
// hasDoc/hasNav guards evaluate to true and the DOM code path is exercised.

describe('detectCapabilities', () => {
  // Fresh-import the module for each test so that vi.stubGlobal changes to
  // matchMedia / navigator / etc. are picked up by the helper closures.
  // (The module-level `hasDoc` / `hasNav` are captured once, but helper
  // functions like `mm()` call `matchMedia` at invocation time.)
  async function detect(): Promise<Capabilities> {
    const mod = await import('./detect');
    return mod.detectCapabilities();
  }

  // ---- baseline (happy-dom defaults) ----

  describe('happy-dom baseline', () => {
    it('returns a valid Capabilities object with all expected fields', async () => {
      const caps = await detect();

      // backends is always present
      expect(caps.backends).toBeDefined();
      expect(typeof caps.backends.css).toBe('boolean');
      expect(typeof caps.backends.canvas2d).toBe('boolean');
      expect(typeof caps.backends.webgl2).toBe('boolean');
      expect(typeof caps.backends.webgpu).toBe('boolean');
      expect(typeof caps.backends.offscreenCanvas).toBe('boolean');

      // css is always true in a DOM environment
      expect(caps.backends.css).toBe(true);
    });

    it('reports webgpu as false (happy-dom has no GPU adapter)', async () => {
      const caps = await detect();
      expect(caps.backends.webgpu).toBe(false);
    });

    it('returns colorScheme as one of the valid values', async () => {
      const caps = await detect();
      expect(['light', 'dark', 'no-preference']).toContain(caps.colorScheme);
    });

    it('returns reducedMotion as a boolean', async () => {
      const caps = await detect();
      expect(typeof caps.reducedMotion).toBe('boolean');
    });
  });

  // ---- matchMedia probes ----

  describe('matchMedia probes', () => {
    let originalMatchMedia: typeof matchMedia;

    beforeEach(() => {
      originalMatchMedia = globalThis.matchMedia;
    });

    afterEach(() => {
      vi.stubGlobal('matchMedia', originalMatchMedia);
    });

    it('detects prefers-reduced-motion: reduce', async () => {
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: query === '(prefers-reduced-motion: reduce)',
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        onchange: null,
        dispatchEvent: vi.fn(),
      }));

      const caps = await detect();
      expect(caps.reducedMotion).toBe(true);
    });

    it('detects prefers-color-scheme: dark', async () => {
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: query === '(prefers-color-scheme: dark)',
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        onchange: null,
        dispatchEvent: vi.fn(),
      }));

      const caps = await detect();
      expect(caps.colorScheme).toBe('dark');
    });

    it('detects prefers-color-scheme: light', async () => {
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: query === '(prefers-color-scheme: light)',
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        onchange: null,
        dispatchEvent: vi.fn(),
      }));

      const caps = await detect();
      expect(caps.colorScheme).toBe('light');
    });

    it('returns no-preference when neither light nor dark matches', async () => {
      vi.stubGlobal('matchMedia', (_query: string) => ({
        matches: false,
        media: _query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        onchange: null,
        dispatchEvent: vi.fn(),
      }));

      const caps = await detect();
      expect(caps.colorScheme).toBe('no-preference');
    });

    it('detects coarse pointer', async () => {
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: query === '(pointer: coarse)',
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        onchange: null,
        dispatchEvent: vi.fn(),
      }));

      const caps = await detect();
      expect(caps.coarsePointer).toBe(true);
    });

    it('gracefully handles matchMedia not being a function', async () => {
      vi.stubGlobal('matchMedia', undefined);

      const caps = await detect();
      // Should not throw; reduced motion and coarse pointer default to false
      expect(caps.reducedMotion).toBe(false);
      expect(caps.coarsePointer).toBe(false);
      expect(caps.colorScheme).toBe('no-preference');
    });
  });

  // ---- OffscreenCanvas ----

  describe('OffscreenCanvas detection', () => {
    it('reports offscreenCanvas true when transferControlToOffscreen is available', async () => {
      const original = HTMLCanvasElement.prototype.transferControlToOffscreen;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (HTMLCanvasElement.prototype as any).transferControlToOffscreen = () => ({});
      try {
        const caps = await detect();
        expect(caps.backends.offscreenCanvas).toBe(true);
      } finally {
        if (original) {
          HTMLCanvasElement.prototype.transferControlToOffscreen = original;
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          delete (HTMLCanvasElement.prototype as any).transferControlToOffscreen;
        }
      }
    });

    it('reports offscreenCanvas false when transferControlToOffscreen is absent', async () => {
      const original = HTMLCanvasElement.prototype.transferControlToOffscreen;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (HTMLCanvasElement.prototype as any).transferControlToOffscreen;
      try {
        const caps = await detect();
        expect(caps.backends.offscreenCanvas).toBe(false);
      } finally {
        if (original) {
          HTMLCanvasElement.prototype.transferControlToOffscreen = original;
        }
      }
    });
  });

  // ---- navigator properties ----

  describe('navigator properties', () => {
    it('picks up hardwareConcurrency', async () => {
      Object.defineProperty(navigator, 'hardwareConcurrency', {
        value: 8,
        configurable: true,
      });
      try {
        const caps = await detect();
        expect(caps.hardwareConcurrency).toBe(8);
      } finally {
        Object.defineProperty(navigator, 'hardwareConcurrency', {
          value: undefined,
          configurable: true,
        });
      }
    });

    it('picks up deviceMemory', async () => {
      Object.defineProperty(navigator, 'deviceMemory', {
        value: 4,
        configurable: true,
      });
      try {
        const caps = await detect();
        expect(caps.deviceMemoryGb).toBe(4);
      } finally {
        Object.defineProperty(navigator, 'deviceMemory', {
          value: undefined,
          configurable: true,
        });
      }
    });

    it('picks up connection.saveData and effectiveType', async () => {
      Object.defineProperty(navigator, 'connection', {
        value: { saveData: true, effectiveType: '3g' },
        configurable: true,
      });
      try {
        const caps = await detect();
        expect(caps.saveData).toBe(true);
        expect(caps.effectiveType).toBe('3g');
      } finally {
        Object.defineProperty(navigator, 'connection', {
          value: undefined,
          configurable: true,
        });
      }
    });

    it('leaves optional fields undefined when navigator properties are absent', async () => {
      // In a clean happy-dom, deviceMemory and connection may not exist
      Object.defineProperty(navigator, 'deviceMemory', {
        value: undefined,
        configurable: true,
      });
      Object.defineProperty(navigator, 'connection', {
        value: undefined,
        configurable: true,
      });
      try {
        const caps = await detect();
        expect(caps.deviceMemoryGb).toBeUndefined();
        expect(caps.saveData).toBeUndefined();
        expect(caps.effectiveType).toBeUndefined();
      } finally {
        Object.defineProperty(navigator, 'deviceMemory', {
          value: undefined,
          configurable: true,
        });
        Object.defineProperty(navigator, 'connection', {
          value: undefined,
          configurable: true,
        });
      }
    });
  });

  // ---- devicePixelRatio ----

  describe('devicePixelRatio', () => {
    let original: number | undefined;

    beforeEach(() => {
      original = globalThis.devicePixelRatio;
    });

    afterEach(() => {
      if (original !== undefined) {
        vi.stubGlobal('devicePixelRatio', original);
      }
    });

    it('reads devicePixelRatio when present', async () => {
      vi.stubGlobal('devicePixelRatio', 2);
      const caps = await detect();
      expect(caps.dpr).toBe(2);
    });

    it('returns undefined dpr when devicePixelRatio is not a number', async () => {
      vi.stubGlobal('devicePixelRatio', 'not-a-number');
      const caps = await detect();
      expect(caps.dpr).toBeUndefined();
    });
  });

  // ---- screen dimensions ----

  describe('screen dimensions', () => {
    it('reads screen width and height when screen object exists', async () => {
      const originalScreen = globalThis.screen;
      vi.stubGlobal('screen', { width: 1920, height: 1080 });
      try {
        const caps = await detect();
        expect(caps.screen).toEqual({ w: 1920, h: 1080 });
      } finally {
        vi.stubGlobal('screen', originalScreen);
      }
    });
  });

  // ---- WebGPU ----

  describe('WebGPU detection', () => {
    afterEach(() => {
      // Clean up any navigator.gpu stub
      Object.defineProperty(navigator, 'gpu', {
        value: undefined,
        configurable: true,
      });
    });

    it('returns webgpu true when requestAdapter resolves to a non-null adapter', async () => {
      Object.defineProperty(navigator, 'gpu', {
        value: { requestAdapter: () => Promise.resolve({ /* mock adapter */ }) },
        configurable: true,
      });

      const caps = await detect();
      expect(caps.backends.webgpu).toBe(true);
    });

    it('returns webgpu false when requestAdapter resolves to null', async () => {
      Object.defineProperty(navigator, 'gpu', {
        value: { requestAdapter: () => Promise.resolve(null) },
        configurable: true,
      });

      const caps = await detect();
      expect(caps.backends.webgpu).toBe(false);
    });

    it('returns webgpu false when requestAdapter throws', async () => {
      Object.defineProperty(navigator, 'gpu', {
        value: { requestAdapter: () => Promise.reject(new Error('GPU blocked')) },
        configurable: true,
      });

      const caps = await detect();
      expect(caps.backends.webgpu).toBe(false);
    });

    it('returns webgpu false when navigator.gpu exists but requestAdapter is absent', async () => {
      Object.defineProperty(navigator, 'gpu', {
        value: {},
        configurable: true,
      });

      const caps = await detect();
      expect(caps.backends.webgpu).toBe(false);
    });
  });

  // ---- canvas context probing ----

  describe('canvas context probing', () => {
    it('reports canvas2d based on getContext("2d") support', async () => {
      const caps = await detect();
      // In happy-dom, canvas.getContext may return null, but it should not throw
      expect(typeof caps.backends.canvas2d).toBe('boolean');
    });

    it('does not throw when getContext fails', async () => {
      const originalCreateElement = document.createElement.bind(document);
      vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        const el = originalCreateElement(tag);
        if (tag === 'canvas') {
          (el as HTMLCanvasElement).getContext = (() => {
            throw new Error('context creation failed');
          }) as HTMLCanvasElement['getContext'];
        }
        return el;
      });

      try {
        const caps = await detect();
        // probeContext catches the error and returns false
        expect(caps.backends.canvas2d).toBe(false);
        expect(caps.backends.webgl2).toBe(false);
      } finally {
        vi.restoreAllMocks();
      }
    });
  });

  // ---- SSR / no-DOM path ----

  describe('SSR fallback (no document)', () => {
    it('returns a minimal css-only snapshot when document is absent', async () => {
      // We must re-import the module in a context where `document` doesn't exist.
      // Use vi.resetModules + remove globals before dynamic import.
      vi.resetModules();

      const savedDocument = globalThis.document;
      const savedNavigator = globalThis.navigator;
      const savedMatchMedia = globalThis.matchMedia;
      const savedScreen = globalThis.screen;
      // @ts-expect-error -- intentionally removing DOM globals for SSR test
      delete globalThis.document;
      // @ts-expect-error -- intentionally removing navigator for SSR test
      delete globalThis.navigator;
      // @ts-expect-error -- intentionally removing matchMedia for SSR test
      delete globalThis.matchMedia;
      // @ts-expect-error -- intentionally removing screen for SSR test
      delete globalThis.screen;

      try {
        const mod = await import('./detect');
        const caps = await mod.detectCapabilities();
        expect(caps).toEqual({
          backends: {
            css: true,
            canvas2d: false,
            webgl2: false,
            webgpu: false,
            offscreenCanvas: false,
          },
        });
        // No optional fields should be present
        expect(caps.reducedMotion).toBeUndefined();
        expect(caps.dpr).toBeUndefined();
        expect(caps.screen).toBeUndefined();
        expect(caps.colorScheme).toBeUndefined();
      } finally {
        globalThis.document = savedDocument;
        globalThis.navigator = savedNavigator;
        globalThis.matchMedia = savedMatchMedia;
        globalThis.screen = savedScreen;
        vi.resetModules();
      }
    });
  });

  // ---- never throws ----

  describe('resilience', () => {
    it('never throws regardless of broken APIs', async () => {
      const originalCreateElement = document.createElement.bind(document);
      vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        const el = originalCreateElement(tag);
        if (tag === 'canvas') {
          (el as HTMLCanvasElement).getContext = (() => {
            throw new TypeError('no canvas for you');
          }) as HTMLCanvasElement['getContext'];
        }
        return el;
      });

      Object.defineProperty(navigator, 'gpu', {
        value: { requestAdapter: () => Promise.reject(new Error('GPU exploded')) },
        configurable: true,
      });

      try {
        // Should complete without throwing
        const caps = await detect();
        expect(caps).toBeDefined();
        expect(caps.backends).toBeDefined();
        expect(caps.backends.css).toBe(true);
      } finally {
        vi.restoreAllMocks();
        Object.defineProperty(navigator, 'gpu', {
          value: undefined,
          configurable: true,
        });
      }
    });
  });
});
