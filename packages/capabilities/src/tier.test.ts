import { describe, it, expect } from 'vitest';
import {
  computeTier,
  costBudget,
  backendSupported,
  evaluateSaver,
  playableSavers,
} from './tier';
import type { Backend, Capabilities, SaverInfo } from './types';

const RANK: Record<Backend, number> = { css: 0, canvas2d: 1, webgl2: 2, webgpu: 3 };

/** A device whose best backend is `top` (and thus supports all lower ones). */
function device(top: Backend, extra: Partial<Capabilities> = {}): Capabilities {
  return {
    backends: {
      css: true,
      canvas2d: RANK[top] >= 1,
      webgl2: RANK[top] >= 2,
      webgpu: RANK[top] >= 3,
    },
    ...extra,
  };
}

describe('backendSupported (separate axis)', () => {
  it('a canvas2d device supports css + canvas2d, not webgl2/webgpu', () => {
    const d = device('canvas2d');
    expect(backendSupported(d, 'css')).toBe(true);
    expect(backendSupported(d, 'canvas2d')).toBe(true);
    expect(backendSupported(d, 'webgl2')).toBe(false);
    expect(backendSupported(d, 'webgpu')).toBe(false);
  });
  it('a higher backend implies the lower ones', () => {
    expect(backendSupported(device('webgpu'), 'canvas2d')).toBe(true);
    expect(backendSupported(device('webgl2'), 'canvas2d')).toBe(true);
  });
});

describe('computeTier', () => {
  it('base tier follows the best backend', () => {
    expect(computeTier(device('webgpu'))).toBe('high');
    expect(computeTier(device('webgl2'))).toBe('standard');
    expect(computeTier(device('canvas2d'))).toBe('basic');
    expect(computeTier(device('css'))).toBe('minimal');
  });

  it('absent optional signals never lower the tier', () => {
    expect(computeTier(device('canvas2d'))).toBe('basic'); // no memory/cores/saveData given
    expect(computeTier(device('webgl2'))).toBe('standard');
  });

  it('optional signals only lower, never raise', () => {
    expect(computeTier(device('webgpu', { saveData: true }))).toBe('standard');
    expect(computeTier(device('webgl2', { deviceMemoryGb: 2 }))).toBe('basic');
    expect(computeTier(device('webgpu', { deviceMemoryGb: 2, hardwareConcurrency: 2 }))).toBe('basic');
    // saveData on a css-only device can't go below the floor
    expect(computeTier(device('css', { saveData: true }))).toBe('minimal');
  });

  it('a small coarse-pointer (mobile) screen lowers one step', () => {
    expect(computeTier(device('webgl2', { coarsePointer: true, screen: { w: 390, h: 844 } }))).toBe('basic');
    // a large coarse screen (tablet) does not
    expect(computeTier(device('webgl2', { coarsePointer: true, screen: { w: 1024, h: 1366 } }))).toBe('standard');
  });
});

describe('costBudget', () => {
  it('maps tier to a max cost', () => {
    expect(costBudget('high')).toBe('high');
    expect(costBudget('standard')).toBe('medium');
    expect(costBudget('basic')).toBe('low');
    expect(costBudget('minimal')).toBe('idle');
  });
});

describe('evaluateSaver', () => {
  const blackHole: SaverInfo = { id: 'black-hole', minBackend: 'canvas2d', costTier: 'medium', motionIntensity: 'calm' };

  it('runs at full fidelity on a capable device', () => {
    expect(evaluateSaver(blackHole, device('webgpu')).status).toBe('ok');
    expect(evaluateSaver(blackHole, device('webgl2')).status).toBe('ok'); // budget medium
  });

  it('is blocked when the backend is missing', () => {
    const r = evaluateSaver(blackHole, device('css'));
    expect(r.status).toBe('blocked');
    expect(r.reasons.join(' ')).toMatch(/needs canvas2d/);
  });

  it('is blocked when cost exceeds the device budget', () => {
    const r = evaluateSaver(blackHole, device('canvas2d')); // basic -> budget low < medium
    expect(r.status).toBe('blocked');
    expect(r.reasons.join(' ')).toMatch(/exceeds the device budget/);
  });

  it('reduced-motion DEGRADES a moving saver with a non-hide fallback (respects a11y intent)', () => {
    const warp: SaverInfo = { id: 'warp', minBackend: 'canvas2d', costTier: 'low', motionIntensity: 'energetic' };
    const r = evaluateSaver(warp, device('webgpu', { reducedMotion: true }));
    expect(r.status).toBe('degraded');
    expect(r.reasons.join(' ')).toMatch(/reduced-motion/);
  });

  it('reduced-motion BLOCKS only a saver whose fallback is "hide"', () => {
    const hides: SaverInfo = { id: 'x', minBackend: 'css', costTier: 'idle', reducedMotionFallback: 'hide' };
    expect(evaluateSaver(hides, device('canvas2d', { reducedMotion: true })).status).toBe('blocked');
  });

  it('a calm saver with no fallback stays ok under reduced-motion', () => {
    const calm: SaverInfo = { id: 'c', minBackend: 'css', costTier: 'idle', motionIntensity: 'calm' };
    expect(evaluateSaver(calm, device('canvas2d', { reducedMotion: true })).status).toBe('ok');
  });
});

describe('playableSavers', () => {
  it('drops blocked savers but keeps degraded ones', () => {
    const savers: SaverInfo[] = [
      { id: 'css-idle', minBackend: 'css', costTier: 'idle' },
      { id: 'canvas-medium', minBackend: 'canvas2d', costTier: 'medium' },
      { id: 'energetic', minBackend: 'css', costTier: 'idle', motionIntensity: 'energetic' },
    ];
    // minimal device (css only): canvas-medium blocked (backend+cost); others playable
    const playable = playableSavers(savers, device('css', { reducedMotion: true })).map((s) => s.id);
    expect(playable).toEqual(['css-idle', 'energetic']);
  });
});
