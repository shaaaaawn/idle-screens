import { createRng } from '@idle-screens/core';
import { describe, expect, it } from 'vitest';
import { buildGeodeInterior, ROOM_HEIGHT, ROOM_RADIUS } from './interior';

const room = (seed = 4, over = {}) => buildGeodeInterior(createRng(seed), { tint: '#7a3cff', scale: 1, floorY: 0, ...over });

describe('geode interior', () => {
  it('is the same room from the same seed', () => {
    const a = room(), b = room();
    expect(Array.from(a.glow[0]!.getAttribute('position').array)).toEqual(Array.from(b.glow[0]!.getAttribute('position').array));
    expect(Array.from(room(5).glow[0]!.getAttribute('position').array)).not.toEqual(Array.from(a.glow[0]!.getAttribute('position').array));
  });

  it('holds the swim volume and the orbit camera indoors', () => {
    const r = room();
    expect(r.radius).toBe(ROOM_RADIUS);
    expect(ROOM_RADIUS).toBeGreaterThan(120 + 30); // swim radius + furniture depth
    expect(ROOM_HEIGHT).toBeGreaterThan(72 + 20); //  swim ceiling + chandelier
    // The dome is a dome: nothing of the shell below the floor, apex near full height.
    const y = Array.from(r.shell[0]!.getAttribute('position').array).filter((_, i) => i % 3 === 1);
    expect(Math.min(...y)).toBeGreaterThan(-ROOM_HEIGHT * 0.12);
    expect(Math.max(...y)).toBeGreaterThan(ROOM_HEIGHT * 0.9);
  });

  it('is lined with thousands of crystals, fewer on a weak device, all finite', () => {
    const full = room().glow[0]!.getAttribute('position').count / 9;
    const lite = room(4, { detail: 0.5 }).glow[0]!.getAttribute('position').count / 9;
    expect(full).toBeGreaterThan(4000);
    expect(lite).toBeLessThan(full * 0.6);
    for (const g of [...room().shell, ...room().glow, ...room().voxels]) {
      expect(Array.from(g.getAttribute('position').array).every(Number.isFinite)).toBe(true);
      expect(g.getAttribute('color').count).toBe(g.getAttribute('position').count);
    }
    expect(room().triangles).toBeLessThan(40_000);
  });

  it('is furnished and lit: warm lights plus a cool window, vents, things to swim over', () => {
    const r = room();
    expect(r.voxels.length).toBeGreaterThan(250); // floor, rug, furniture
    expect(r.emitters.length).toBe(r.lights.length);
    expect(r.emitters.length).toBeGreaterThanOrEqual(7);
    expect(r.emitters.some((e) => e.b > e.r)).toBe(true); // the window is cool
    expect(r.emitters.filter((e) => e.r > e.b).length).toBeGreaterThanOrEqual(4); // the rest are warm
    expect(r.vents.length).toBe(2); // teapot and kettle
    expect(r.obstacles.length).toBeGreaterThanOrEqual(8);
    for (const o of r.obstacles) expect(Math.hypot(o.x, o.z)).toBeLessThan(ROOM_RADIUS);
  });
});
