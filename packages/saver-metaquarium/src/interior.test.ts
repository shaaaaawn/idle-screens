import { createRng } from '@idle-screens/core';
import { describe, expect, it } from 'vitest';
import { buildGeodeInterior, ROOM_HEIGHT, ROOM_RADIUS } from './interior';

const room = (seed = 4, over = {}) => buildGeodeInterior(createRng(seed), { tint: '#7a3cff', scale: 1, floorY: 0, ...over });
const pos = (r: ReturnType<typeof room>): number[] => Array.from(r.room[0]!.getAttribute('position').array);

describe('geode interior', () => {
  it('is the same room from the same seed', () => {
    expect(pos(room())).toEqual(pos(room()));
    expect(pos(room(5))).not.toEqual(pos(room()));
  });

  it('is ONE geometry — dome, lining, floor, furniture, lamps in a single draw', () => {
    const r = room();
    expect(r.room).toHaveLength(1);
    const g = r.room[0]!;
    expect(g.getAttribute('color').count).toBe(g.getAttribute('position').count);
    expect(pos(r).every(Number.isFinite)).toBe(true);
    expect(r.triangles).toBe(g.getAttribute('position').count / 3);
    expect(r.triangles).toBeLessThan(90_000);
  });

  it('holds the swim volume and the orbit camera indoors', () => {
    const r = room();
    expect(r.radius).toBe(ROOM_RADIUS);
    expect(ROOM_RADIUS).toBeGreaterThan(120 + 30); // swim radius + furniture depth
    expect(ROOM_HEIGHT).toBeGreaterThan(72 + 20); //  swim ceiling + chandelier
    const y = pos(r).filter((_, i) => i % 3 === 1);
    // reduce, not Math.min(...y): a room is ~200k numbers and spread overflows the stack.
    expect(y.reduce((a, b) => Math.min(a, b))).toBeGreaterThan(-ROOM_HEIGHT * 0.2); // skirting crystals root a little below the floor line
    expect(y.reduce((a, b) => Math.max(a, b))).toBeGreaterThan(ROOM_HEIGHT * 0.9);
  });

  it('is lined with thousands of packed crystals, half of them on a weak device', () => {
    expect(room().crystals).toBeGreaterThan(4000);
    expect(room(4, { detail: 0.5 }).crystals).toBeLessThan(room().crystals * 0.6);
  });

  it('is furnished and lit: warm lights plus a cool window, vents, things to swim over', () => {
    const r = room();
    expect(r.boxes).toBeGreaterThan(250); // floor, rug, furniture
    expect(r.emitters.length).toBe(r.lights.length);
    expect(r.emitters.length).toBeGreaterThanOrEqual(7);
    expect(r.emitters.some((e) => e.b > e.r)).toBe(true); // the window is cool
    expect(r.emitters.filter((e) => e.r > e.b).length).toBeGreaterThanOrEqual(4); // the rest are warm
    expect(r.vents.length).toBe(2); // teapot and kettle
    expect(r.obstacles.length).toBeGreaterThanOrEqual(8);
    for (const o of r.obstacles) expect(Math.hypot(o.x, o.z)).toBeLessThan(ROOM_RADIUS);
  });
});
