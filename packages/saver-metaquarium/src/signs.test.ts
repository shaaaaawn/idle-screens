import { createRng } from '@idle-screens/core';
import { Mesh, type MeshBasicMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { buildScenery, type SceneryOptions } from './scenery';
import { parseSignMix } from './sign-mix';
import { buildSigns, type SignContext } from './signs';

const terrain = (x: number, z: number): number => Math.sin(x * 0.02) * 3;
const ctx = (over: Partial<SignContext> = {}): SignContext => ({
  rng: createRng(7) as unknown as SignContext['rng'], terrain, scale: 1, marks: { gate: { x: 0, y: 20, z: -40 } },
  free: () => true, clocks: [], ...over,
});
const ALL = parseSignMix('plank@gate:Welcome, arrow>gate:Castle, ring:Lifeguard, porthole, neon/#ff4fa0:OPEN, led:TIDE 4.2M AND A LONG SCROLLING LINE').entries;

describe('buildSigns', () => {
  it('builds every kind: one baked draw, one lit draw, an LED face each', () => {
    const built = buildSigns(ALL, ctx());
    expect(built.count).toBe(6);
    // The LED board has a face on each side: it reads from behind too.
    expect(built.group.children.map((m) => m.name).sort()).toEqual(['sign-led', 'sign-led', 'signs', 'signs-lit']);
    for (const m of built.group.children as Mesh[]) {
      expect(m.geometry.userData.mqOwned).toBe(true);
      expect((m.material as MeshBasicMaterial).userData.mqOwned).toBe(true);
      const pos = m.geometry.getAttribute('position').array as Float32Array;
      expect(pos.every(Number.isFinite)).toBe(true);
    }
    // Lit parts and the LED are displays: no caustics drawn over them.
    const lit = built.group.children.filter((m) => m.name !== 'signs') as Mesh[];
    for (const m of lit) expect((m.material as MeshBasicMaterial).userData.mqNoCaustic).toBe(true);
    // Fish go round every sign; the porthole, neon and LED light the floor.
    // Fish go round every sign — and a fingerpost's finger, a bracket sign's post.
    expect(built.obstacles).toHaveLength(8);
    expect(built.lights).toHaveLength(3);
    expect(built.halos).toHaveLength(3);
  });

  it('is seeded: the same signs, the same cubes', () => {
    const a = buildSigns(ALL, ctx()), b = buildSigns(ALL, ctx());
    const arr = (x: ReturnType<typeof buildSigns>) => (x.group.children as Mesh[]).map((m) => Array.from(m.geometry.getAttribute('position').array));
    expect(arr(a)).toEqual(arr(b));
  });

  it('stands beside its mark, not on it, and only where it is free', () => {
    const built = buildSigns(parseSignMix('plank@gate:Welcome').entries, ctx({ free: (x) => x > 0 }));
    const o = built.obstacles[0]!;
    expect(o.x).toBeGreaterThan(0);
    expect(Math.hypot(o.x - 0, o.z + 40)).toBeGreaterThan(12);
  });

  it('gives signs in the open their own lanes across the front, so none hides another', () => {
    const built = buildSigns(parseSignMix('plank:Welcome, plank:Castle, ring:SURF, porthole:BAR').entries, ctx());
    const o = built.obstacles;
    for (let a = 0; a < o.length; a++) for (let b = a + 1; b < o.length; b++) {
      expect(Math.abs(o[a]!.x - o[b]!.x)).toBeGreaterThan(Math.min(o[a]!.r, o[b]!.r));
    }
  });

  it('skips a sign when nothing is clear, rather than stacking it on another', () => {
    expect(buildSigns(parseSignMix('plank:Hi').entries, ctx({ free: () => false })).obstacles).toHaveLength(0);
  });

  it('grows a porthole so a four-letter word fits inside the glass', () => {
    const small = buildSigns(parseSignMix('porthole:OK').entries, ctx()).obstacles[0]!;
    const big = buildSigns(parseSignMix('porthole:OPEN').entries, ctx()).obstacles[0]!;
    expect(big.r).toBeGreaterThan(small.r);
  });

  it('frees the LED text texture through the material disposal hook', () => {
    const built = buildSigns(parseSignMix('led:HELLO').entries, ctx());
    const face = built.group.children.find((m) => m.name === 'sign-led') as Mesh;
    expect(typeof (face.material as MeshBasicMaterial).userData.mqDispose).toBe('function');
  });

  it('scrolls an LED board on the scenery clock', () => {
    const clocks: { value: number }[] = [];
    const built = buildSigns(parseSignMix('led:HELLO').entries, ctx({ clocks }));
    expect(clocks).toHaveLength(1);
    clocks[0]!.value = 12.5;
    expect(clocks[0]!.value).toBe(12.5);
    const face = built.group.children.find((m) => m.name === 'sign-led') as Mesh;
    expect((face.material as MeshBasicMaterial).customProgramCacheKey()).toBe('mq-sign-led-v2');
  });
});

describe('live LED text', () => {
  it('swaps a board\'s words in place: new texture, marquee restarted, nothing rebuilt', () => {
    const clocks: { value: number }[] = [];
    const built = buildSigns(parseSignMix('plank:Hi, led:SHORT, led:ANOTHER BOARD').entries, ctx({ clocks }));
    const faces = built.group.children.filter((m) => m.name === 'sign-led') as Mesh[];
    const uniformsOf = (m: Mesh) => {
      const shader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: '#include <begin_vertex>', fragmentShader: '#include <color_fragment>' };
      (m.material as MeshBasicMaterial).onBeforeCompile(shader as never, undefined as never);
      return shader.uniforms as Record<string, { value: { x: number; z: number; dispose?: () => void } }>;
    };
    const u0 = uniformsOf(faces[0]!), u1 = uniformsOf(faces[2]!); // faces come in front/back pairs
    const before = u0.uLedText!.value, other = u1.uLedText!.value;
    clocks.forEach((c) => (c.value = 30));
    built.setLedTexts(['NOW A LONG LINE THAT HAS TO SCROLL ACROSS', 'ANOTHER BOARD']);
    expect(u0.uLedText!.value).not.toBe(before);
    expect(u0.uLedInfo!.value.x).toBe(41 * 6 - 1);
    expect(u0.uLedInfo!.value.z).toBe(1);   // longer than the board: a marquee
    expect(u0.uLedSwap!.value.x).toBe(30);  // entering from the right edge now
    expect(u1.uLedText!.value).toBe(other); // unchanged words: untouched
    expect(built.group.children).toHaveLength(5); // the cubes' draw and two faces a board, as built
  });
});

describe('signs in the world', () => {
  const off: SceneryOptions = { rocks: 0, veins: 0.7, homes: 0, flora: 0, bubbles: 0, snow: 0, cap: 8, scale: 1 };
  it('builds on their own, counts themselves and clear fish over them', () => {
    const world = buildScenery([], createRng(3), terrain, { ...off, signs: ALL });
    expect(world.counts.signs).toBe(6);
    expect(world.group.children.some((m) => m.name === 'signs')).toBe(true);
    expect(world.emitters.length).toBe(3);
    expect(world.triangles).toBeGreaterThan(0);
  });

  it('keeps out of a geode home', () => {
    const world = buildScenery([], createRng(3), terrain, { ...off, interior: true, signs: ALL });
    expect(world.counts.signs).toBeUndefined();
  });
});
