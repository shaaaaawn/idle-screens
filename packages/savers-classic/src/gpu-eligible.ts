import type { SaverContext } from '@idle-screens/core';

/** Whether a dual-path saver should attempt WebGPU on the main thread. */
export function gpuMainThreadEligible(ctx: SaverContext): boolean {
  // Workers always use the canvas2d CPU path (no GPU device lifecycle).
  if (ctx.surface) return false;
  // WKWebView in the macOS wrapper: WebGPU init often succeeds but the
  // canvas never presents — fall back to canvas2d so screensaver mode works.
  if (typeof window !== 'undefined' && '__idleScreensMac' in window) return false;
  return true;
}
