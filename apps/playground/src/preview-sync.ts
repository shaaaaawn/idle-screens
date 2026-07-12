import type { SaverInstance } from '@idle-screens/core';

/** Drive inline preview time from the timeline scrubber. */
export function syncPreviewTime(
  inst: SaverInstance | null,
  t: number,
  seed: number,
  duration: number,
  loop: boolean,
): boolean {
  if (!inst) return false;
  const ms = loop ? ((t % duration) + duration) % duration : Math.min(Math.max(0, t), duration);

  if (inst.renderFrame) {
    inst.setPaused(true);
    inst.renderFrame(ms, seed);
    return true;
  }

  if (inst.previewAt) {
    inst.setPaused(true);
    inst.previewAt(ms);
    return true;
  }

  return false;
}

/** Whether the timeline can steer this instance (vs free-running live loop). */
export function isPreviewDriven(inst: SaverInstance | null): boolean {
  if (!inst) return false;
  return !!(inst.renderFrame || inst.previewAt);
}
