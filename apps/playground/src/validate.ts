import { createRng, type SaverPlugin } from '@idle-screens/core';
import {
  analyzeFlashes,
  analyzePerf,
  tileStatsFromImageData,
  type FlashReport,
  type FlashSample,
  type PerfReport,
} from '@idle-screens/validator';

export interface ValidateResult {
  id: string;
  /** false when the saver has no renderFrame (can't sample logical time deterministically). */
  supported: boolean;
  flash?: FlashReport;
  perf?: PerfReport;
  /** the saver manifest's declared a11y.flashSafe (for the honesty check). */
  declaredFlashSafe?: boolean;
}

export interface SampleOpts {
  seconds?: number;
  fps?: number;
  grid?: number; // downscale to grid x grid tiles
  size?: number; // render size in px
}

function offscreenHost(size: number): HTMLDivElement {
  const host = document.createElement('div');
  host.style.cssText = `position:absolute;left:-99999px;top:0;width:${size}px;height:${size}px`;
  document.body.appendChild(host);
  return host;
}

/**
 * Sample a frame-addressable saver by STEPPING LOGICAL TIME through renderFrame(t) at a
 * fixed cadence (not wall-clock — that's too slow to see a 15Hz strobe), downscaling each
 * frame to a grid so the flash analysis is per-tile (localized strobes can't be masked).
 */
export async function sampleSaver(saver: SaverPlugin, opts: SampleOpts = {}): Promise<ValidateResult> {
  const seconds = opts.seconds ?? 2;
  const fps = opts.fps ?? 60;
  const grid = opts.grid ?? 32;
  const size = opts.size ?? 512;
  const id = saver.manifest.id;
  const declaredFlashSafe = saver.manifest.a11y?.flashSafe;

  const host = offscreenHost(size);
  try {
    const inst = await Promise.resolve(
      saver.mount({ host, width: size, height: size, rng: createRng(1), seed: 1, reducedMotion: true }),
    );
    const src = host.querySelector('canvas');
    if (!inst.renderFrame || !src) {
      inst.dispose();
      return { id, supported: false, declaredFlashSafe };
    }
    const small = document.createElement('canvas');
    small.width = grid;
    small.height = grid;
    const sctx = small.getContext('2d', { willReadFrequently: true })!;

    const frames = Math.round(seconds * fps);
    const dt = 1000 / fps;
    const samples: FlashSample[] = [];
    const frameTimes: number[] = [];
    for (let f = 0; f < frames; f++) {
      const t = f * dt;
      const t0 = performance.now();
      inst.renderFrame(t, 1);
      frameTimes.push(performance.now() - t0);
      sctx.clearRect(0, 0, grid, grid);
      sctx.drawImage(src, 0, 0, grid, grid);
      const img = sctx.getImageData(0, 0, grid, grid);
      const { lum, red } = tileStatsFromImageData(img);
      samples.push({ t, lum, red });
    }
    inst.dispose();
    return { id, supported: true, flash: analyzeFlashes(samples), perf: analyzePerf(frameTimes), declaredFlashSafe };
  } finally {
    host.remove();
  }
}

/**
 * Render a synthetic full-field strobe at `hz` and run it through the SAME sampling +
 * analysis pipeline — the fixture that proves the gate actually fails dangerous content
 * (not just rubber-stamps calm savers).
 */
export function sampleStrobe(hz: number, opts: SampleOpts = {}): FlashReport {
  const seconds = opts.seconds ?? 2;
  const fps = opts.fps ?? 60;
  const grid = opts.grid ?? 32;
  const size = opts.size ?? 256;

  const big = document.createElement('canvas');
  big.width = size;
  big.height = size;
  const bctx = big.getContext('2d')!;
  const small = document.createElement('canvas');
  small.width = grid;
  small.height = grid;
  const sctx = small.getContext('2d', { willReadFrequently: true })!;

  const frames = Math.round(seconds * fps);
  const dt = 1000 / fps;
  const halfFrames = fps / (2 * hz);
  const samples: FlashSample[] = [];
  for (let f = 0; f < frames; f++) {
    const on = Math.floor(f / halfFrames) % 2 === 0;
    bctx.fillStyle = on ? '#ffffff' : '#000000';
    bctx.fillRect(0, 0, size, size);
    sctx.clearRect(0, 0, grid, grid);
    sctx.drawImage(big, 0, 0, grid, grid);
    const { lum, red } = tileStatsFromImageData(sctx.getImageData(0, 0, grid, grid));
    samples.push({ t: f * dt, lum, red });
  }
  return analyzeFlashes(samples);
}
