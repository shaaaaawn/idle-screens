import { integrateParam, type ControlTrack, type ParamSpace } from '@idle-screens/core';

/** Logical media clock that excludes time spent paused. */
export class LogicalClock {
  private base = 0;
  private origin: number | null = null;
  private current = 0;

  resume(): void {
    this.origin = null;
  }

  pause(): void {
    this.base = this.current;
    this.origin = null;
  }

  sample(now: number): number {
    if (this.origin === null) this.origin = now;
    this.current = this.base + now - this.origin;
    return this.current;
  }

  seek(t: number): void {
    this.base = t;
    this.current = t;
    this.origin = null;
  }
}

/** Integrate a rate parameter without rescaling all motion accumulated before a steer. */
export function rateOffset(
  space: ParamSpace,
  track: ControlTrack | null,
  path: string,
  t: number,
  sampledRate: number,
  tracked: boolean,
): number {
  if (!tracked || !track) return sampledRate * (t / 1000);
  const def = space[path];
  return integrateParam(space, track, path, t, {
    ...(def?.min !== undefined ? { min: def.min } : {}),
    ...(def?.max !== undefined ? { max: def.max } : {}),
  }) / 1000;
}
