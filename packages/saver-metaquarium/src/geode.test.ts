import { createRng } from '@idle-screens/core';
import { describe, expect, it } from 'vitest';
import { buildGeode, GEODE_HABITS, type GeodeSpec } from './geode';

const spec = (habit: GeodeSpec['habit'], over: Partial<GeodeSpec> = {}): GeodeSpec =>
  ({ x: 10, y: 2, z: -30, facing: 0.3, habit, tint: '#ff3f9e', scale: 1, ...over });
const flat = (gs: ReturnType<typeof buildGeode>['stone']): number[] =>
  gs.flatMap((g) => Array.from(g.getAttribute('position').array));

describe('geode homes', () => {
  it('is the same home from the same seed, and a different one from another', () => {
    const a = buildGeode(spec('cottage'), createRng(5));
    expect(flat(a.stone)).toEqual(flat(buildGeode(spec('cottage'), createRng(5)).stone));
    expect(flat(a.stone)).not.toEqual(flat(buildGeode(spec('cottage'), createRng(6)).stone));
  });

  it('every habit is a broken stone: an open shell, a lit throat, a voxel house', () => {
    for (const habit of GEODE_HABITS) {
      const g = buildGeode(spec(habit), createRng(9));
      const shell = g.stone[0]!.getAttribute('position').count / 3;
      expect(shell).toBeGreaterThan(100); // most of the boulder survives the break…
      expect(shell).toBeLessThan(300); //    …but it IS broken (a whole one is 320)
      expect(g.glow.length).toBeGreaterThanOrEqual(4); // rind+teeth, knob, window, lamp
      expect(g.voxels.length).toBeGreaterThan(20); // planks, door, steps, chimney
      for (const part of [...g.stone, ...g.glow, ...g.voxels]) {
        expect(Array.from(part.getAttribute('position').array).every(Number.isFinite)).toBe(true);
        expect(part.getAttribute('color').count).toBe(part.getAttribute('position').count);
      }
      expect(g.triangles).toBeLessThan(2500);
    }
  });

  it('the hall is the wide one, the tower the tall one', () => {
    const hall = buildGeode(spec('hall'), createRng(3)).obstacle;
    const tower = buildGeode(spec('tower'), createRng(3)).obstacle;
    expect(hall.r).toBeGreaterThan(tower.r * 1.3);
    expect(tower.h).toBeGreaterThan(hall.h);
  });

  it('vents above its own roof and lights the floor in front of its door', () => {
    const s = spec('cottage', { facing: 0 });
    const g = buildGeode(s, createRng(4));
    expect(g.vent.y).toBeGreaterThan(g.obstacle.y + g.obstacle.h * 0.9);
    expect(g.emitter.z).toBeGreaterThan(s.z); // facing 0 looks down +z
    expect(g.emitter.r).toBeGreaterThan(g.emitter.b); // warm
    expect(g.emitter.reach).toBeGreaterThan(g.radius);
  });

  it('scales as a whole', () => {
    const one = buildGeode(spec('tower'), createRng(8));
    const two = buildGeode(spec('tower', { scale: 2 }), createRng(8));
    expect(two.radius).toBeCloseTo(one.radius * 2, 5);
  });
});
