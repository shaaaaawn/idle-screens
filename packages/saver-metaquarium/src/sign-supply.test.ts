import { describe, expect, it } from 'vitest';
import { SUPPLY_BAND, SUPPLY_NONE, SUPPLY_REBOOT, SUPPLY_SLOT, SUPPLY_STUTTER, SUPPLY_TEAR, supplyEvent, supplyLevel } from './sign-supply';

/**
 * WCAG 2.3.1 as @idle-screens/validator counts it (flash.ts): a transition is a
 * maximal monotonic luminance change of ≥ 0.10 whose darker end is < 0.80; a
 * flash is a pair of opposing transitions; fail above 3 flashes in any 1 s.
 * The sign is treated as full-frame luminance here — far stricter than the
 * small part of a frame it really is.
 */
function maxFlashesPerSecond(series: number[], dt: number): number {
  const times: number[] = [];
  let anchor = series[0]!, dir = 0, extreme = anchor;
  series.forEach((v, i) => {
    if (dir >= 0 && v > extreme) extreme = v;
    if (dir <= 0 && v < extreme) extreme = v;
    const swing = extreme - anchor;
    if (Math.abs(swing) >= 0.1 && Math.min(anchor, extreme) < 0.8) {
      const d = Math.sign(swing);
      if (d !== dir) { times.push(i * dt); dir = d; anchor = extreme; }
    }
    // A reversal from the extreme starts a new leg.
    if ((dir > 0 && v < extreme) || (dir < 0 && v > extreme)) { anchor = extreme; extreme = v; dir = -dir || dir; }
  });
  let best = 0;
  for (let a = 0, b = 0; b < times.length; b++) {
    while (times[b]! - times[a]! > 1) a++;
    best = Math.max(best, Math.floor((b - a + 1) / 2));
  }
  return best;
}

describe('sign supply', () => {
  it('is steady at 0', () => {
    for (let t = 0; t < 200; t += 0.37) expect(supplyLevel(3, t, 0)).toBe(1);
    expect(supplyEvent(3, 12, 0).type).toBe(SUPPLY_NONE);
  });

  it('stays flash-safe for every supply at full flicker over ten minutes', () => {
    const dt = 1 / 60;
    for (let id = 1; id <= 24; id++) {
      const series: number[] = [];
      for (let t = 0; t < 600; t += dt) series.push(supplyLevel(id, t, 1));
      expect(maxFlashesPerSecond(series, dt), `supply ${id}`).toBeLessThanOrEqual(3);
    }
  });

  it('holds at most one event a slot, inside it, so events never stack', () => {
    const seen = new Set<number>();
    for (let id = 1; id <= 12; id++) for (let slot = 0; slot < 400; slot++) {
      const e = supplyEvent(id, slot * SUPPLY_SLOT + 2, 1);
      seen.add(e.type);
      if (e.type === SUPPLY_NONE) continue;
      expect(e.start).toBeGreaterThanOrEqual(slot * SUPPLY_SLOT + 0.5);
      expect(e.start + (e.type === SUPPLY_REBOOT ? 2.2 : e.type === SUPPLY_BAND ? 2.5 : 0.38)).toBeLessThanOrEqual((slot + 1) * SUPPLY_SLOT);
      // The same event wherever in the slot it is asked.
      expect(supplyEvent(id, slot * SUPPLY_SLOT + 0.1, 1)).toEqual(e);
    }
    expect([...seen].sort()).toEqual([SUPPLY_NONE, SUPPLY_STUTTER, SUPPLY_BAND, SUPPLY_TEAR, SUPPLY_REBOOT].sort());
  });

  it('gives most supplies a quiet life and a few a bad one', () => {
    const events = (id: number) => Array.from({ length: 300 }, (_, k) => supplyEvent(id, k * SUPPLY_SLOT + 2, 0.4).type).filter((x) => x !== SUPPLY_NONE).length;
    const counts = Array.from({ length: 20 }, (_, i) => events(i + 1)).sort((a, b) => a - b);
    expect(counts[0]).toBeLessThan(counts[19]! / 3); // steady ones and dodgy ones
    expect(counts[10]).toBeLessThan(60);              // the typical sign: an event a minute or two at most
  });

  it('reboots dark and wakes gradually, never in one step', () => {
    for (let id = 1; id <= 40; id++) for (let slot = 0; slot < 200; slot++) {
      const e = supplyEvent(id, slot * SUPPLY_SLOT + 2, 1);
      if (e.type !== SUPPLY_REBOOT) continue;
      expect(supplyLevel(id, e.start + 0.5, 1)).toBe(0);
      expect(supplyLevel(id, e.start + 1.6, 1)).toBeGreaterThan(0.3);
      expect(supplyLevel(id, e.start + 1.6, 1)).toBeLessThan(0.7);
      return;
    }
    throw new Error('no reboot found');
  });
});
