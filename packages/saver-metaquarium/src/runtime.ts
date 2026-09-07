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
