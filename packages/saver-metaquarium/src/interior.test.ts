import { createRng } from '@idle-screens/core';
import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { buildGeodeInterior, ROOM_HEIGHT, ROOM_RADIUS, sideAxisFor } from './interior';

const room = (seed = 4, over = {}) => buildGeodeInterior(createRng(seed), { tint: '#7a3cff', scale: 1, floorY: 0, ...over });
const pos = (r: ReturnType<typeof room>): number[] => Array.from(r.room[0]!.getAttribute('position').array);
// A room is a detail-5 icosphere, thousands of packed crystals and hundreds of
// voxels — build the reference one ONCE and let every read-only case share it.
const r = room();

describe('geode interior', () => {
  it('is the same room from the same seed', () => {
    expect(pos(room())).toEqual(pos(r));
    expect(pos(room(5))).not.toEqual(pos(r));
  });

  it('is ONE geometry — dome, lining, floor, furniture, lamps in a single draw', () => {
    expect(r.room).toHaveLength(1);
    const g = r.room[0]!;
    expect(g.getAttribute('color').count).toBe(g.getAttribute('position').count);
    expect(pos(r).every(Number.isFinite)).toBe(true);
    // Not `r.triangles === position.count / 3`: `triangles` is defined as
    // exactly that (interior.ts: `triangles: pos.length / 9`), so the
    // comparison is an identity that can never fail — only the budget below
    // actually guards anything.
    expect(r.triangles).toBeLessThan(90_000);
  });

  it('holds the swim volume and the orbit camera indoors', () => {
    expect(r.radius).toBe(ROOM_RADIUS);
    expect(ROOM_RADIUS).toBeGreaterThan(120 + 30); // swim radius + furniture depth
    expect(ROOM_HEIGHT).toBeGreaterThan(72 + 20); //  swim ceiling + chandelier
    const y = pos(r).filter((_, i) => i % 3 === 1);
    // reduce, not Math.min(...y): a room is ~200k numbers and spread overflows the stack.
    expect(y.reduce((a, b) => Math.min(a, b))).toBeGreaterThan(-ROOM_HEIGHT * 0.2); // skirting crystals root a little below the floor line
    expect(y.reduce((a, b) => Math.max(a, b))).toBeGreaterThan(ROOM_HEIGHT * 0.9);
  });

  it('is lined with thousands of packed crystals, half of them on a weak device', () => {
    expect(r.crystals).toBeGreaterThan(4000);
    expect(room(4, { detail: 0.5 }).crystals).toBeLessThan(r.crystals * 0.6);
  });

  it('is furnished and lit: warm lights plus a cool window, vents, things to swim over', () => {
    expect(r.boxes).toBeGreaterThan(250); // floor, rug, furniture
    // Not `emitters.length === lights.length`: every lamp pushes to both
    // arrays on the same lines (interior.ts), so this is also an identity.
    expect(r.emitters.length).toBeGreaterThanOrEqual(7);
    // The window's own emitter, not just "some emitter happens to be cool":
    // three potted-plant lamps already tint cool (room tint #7a3cff, b > r)
    // and the >= 4 warm count is already met by the chandelier, bedside lamp,
    // stove and floor lamp alone, so a broader `.some()`/count check can't
    // catch the window itself regressing to a warm color. Locate it by its
    // world position instead — `piece(128, 158)` in interior.ts, the round
    // window onto "the blue outside" — and assert directly on it.
    const windowAngle = (128 * Math.PI) / 180;
    const windowX = Math.cos(windowAngle) * 158, windowZ = Math.sin(windowAngle) * 158;
    const windowEmitter = r.emitters.find((e) => Math.hypot(e.x - windowX, e.z - windowZ) < 30);
    expect(windowEmitter, 'no emitter found near the window\'s position').toBeDefined();
    expect(windowEmitter!.b).toBeGreaterThan(windowEmitter!.r); // the window is cool
    expect(r.emitters.filter((e) => e.r > e.b).length).toBeGreaterThanOrEqual(4); // the rest are warm
    expect(r.vents.length).toBe(2); // teapot and kettle
    expect(r.obstacles.length).toBeGreaterThanOrEqual(8);
    for (const o of r.obstacles) expect(Math.hypot(o.x, o.z)).toBeLessThan(ROOM_RADIUS);
  });

  it('falls back to a fixed side axis at the dome\'s poles, exactly or nearly on Y_UP', () => {
    // Three's own Vector3.normalize() guards an exactly-zero length (divides
    // by 1, not 0), so an exactly-parallel axis can't produce NaN either way
    // — but that guard is also why checking lengthSq() AFTER normalizing
    // can't work at all: normalize() always leaves length ~1 unless the input
    // was exactly zero, so a merely near-zero cross product (axis close to
    // but not exactly Y_UP) sails through a post-normalize check and comes
    // out as an arbitrary, ill-conditioned direction instead of the fallback.
    // Check the raw cross product's length before normalizing.
    const out = new Vector3();
    expect(sideAxisFor(new Vector3(0, 1, 0), out)).toBe(out);
    expect(out.equals(new Vector3(1, 0, 0))).toBe(true);
    sideAxisFor(new Vector3(0, -1, 0), out);
    expect(out.equals(new Vector3(1, 0, 0))).toBe(true);
    // Not exactly parallel — a raw cross product of length 0.05, comfortably
    // under the 0.01 lengthSq threshold, but not the zero vector.
    sideAxisFor(new Vector3(0.05, Math.sqrt(1 - 0.05 ** 2), 0), out);
    expect(out.equals(new Vector3(1, 0, 0))).toBe(true);
    // Non-degenerate branch: stays level with Y_UP, unit length, and
    // perpendicular to the axis — otherwise a dropped .normalize(), or a
    // side that isn't actually perpendicular, would ship with this suite
    // still green (it only ever drove the near-zero fallback branch above).
    const axis = new Vector3(0.3, 0.95, 0.1).normalize();
    sideAxisFor(axis, out);
    expect(Math.abs(out.y)).toBeLessThan(1e-6);
    expect(out.length()).toBeCloseTo(1, 6);
    expect(out.dot(axis)).toBeCloseTo(0, 6);
  });
});
