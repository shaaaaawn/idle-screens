import { MeshBasicMaterial, Scene } from 'three';
import { describe, expect, it } from 'vitest';
import { BURP_DRAG, BURP_LIFE, BURP_TRAIL, BurpLayer, burpAt, type BurpPose } from './burps';

const pose = (): BurpPose => ({ visible: false, x: 0, y: 0, z: 0, s: 0 });

describe('hiccup bubbles (burps.ts)', () => {
  const b = { t: 10, x: 1, y: 20, z: -3, r: 0.8, seed: 0.3, vx: 0, vy: 0, vz: 0 };

  it('rises from where it was let go, quickening, and is gone after its life', () => {
    expect(burpAt(b, 9.9, Infinity, pose()).visible).toBe(false);
    const ys = [0.05, 0.5, 1, 1.5, 2].map((a) => burpAt(b, 10 + a, Infinity, pose()).y);
    expect(ys[0]).toBeCloseTo(20, 0);
    for (let i = 2; i < ys.length; i++) expect(ys[i]! - ys[i - 1]!).toBeGreaterThan(ys[i - 1]! - ys[i - 2]!);
    expect(burpAt(b, 10 + BURP_LIFE + 0.01, Infinity, pose()).visible).toBe(false);
  });

  it('leaves with the baby\'s speed and loses it to the water: spat out ahead, then left behind', () => {
    const fast = { ...b, vx: 15 };
    const at = (a: number): number => burpAt(fast, 10 + a, Infinity, pose()).x - burpAt(b, 10 + a, Infinity, pose()).x;
    expect(at(0.1)).toBeGreaterThan(15 * 0.1 * 0.8);
    expect(at(2)).toBeCloseTo(15 * BURP_DRAG, 1);
    expect(at(3) - at(2)).toBeLessThan(0.05);
  });

  it('pops at the ceiling', () => {
    const p = pose();
    let last = 0;
    for (let a = 0; a < BURP_LIFE; a += 0.01) if (burpAt(b, 10 + a, 26, p).visible) { last = a; expect(p.y).toBeLessThanOrEqual(26 + 1e-9); }
    expect(last).toBeLessThan(BURP_LIFE * 0.6);
  });

  it('pops out small and swells before it pops', () => {
    expect(burpAt(b, 10.02, Infinity, pose()).s).toBeLessThan(0.8 * 0.5);
    expect(burpAt(b, 10 + BURP_LIFE - 0.01, Infinity, pose()).s).toBeGreaterThan(0.8 * 1.2);
  });

  it('a hiccup is one big bubble and a tiny one after, once per key; seeking back forgets them', () => {
    const layer = new BurpLayer(new Scene());
    layer.emit('3:12.000', 12.2, 0, 30, 0, 0.8, 0.1);
    layer.emit('3:12.000', 12.25, 5, 30, 0, 0.8, 0.1);
    expect(layer.size).toBe(2);
    expect(layer.update(12.2 + BURP_TRAIL / 2, Infinity)).toBe(1);
    expect(layer.update(13, Infinity)).toBe(2);
    expect(layer.mesh.visible).toBe(true);
    expect(layer.update(12, Infinity)).toBe(0);
    expect(layer.size).toBe(0);
    expect(layer.mesh.visible).toBe(false);
  });

  it('forgets bubbles once they have popped', () => {
    const layer = new BurpLayer(new Scene());
    layer.emit('1:1.000', 1.2, 0, 30, 0, 0.8, 0.1);
    layer.update(2, Infinity);
    layer.update(1.2 + BURP_TRAIL + BURP_LIFE + 0.1, Infinity);
    expect(layer.size).toBe(0);
  });

  it('lists its bubbles for inspect, and draws them as bubbles — a bright rim, a clear middle, a catchlight', () => {
    const layer = new BurpLayer(new Scene());
    layer.emit('2:5.000', 5.2, 1.04, 30, -2, 0.8, 0.1);
    expect(layer.list()).toEqual([
      { key: '2:5.000', t: 5.2, x: 1, y: 30, z: -2 },
      { key: '2:5.000+', t: 5.3, x: 1.3, y: 30.2, z: -2 },
    ]);
    const shader = {
      uniforms: {}, vertexShader: '#include <common>\n#include <project_vertex>', fragmentShader: '#include <common>\n#include <alphamap_fragment>',
    };
    (layer.mesh.material as MeshBasicMaterial).onBeforeCompile(shader as never, undefined as never);
    expect(shader.vertexShader).toContain('vBurpN = normalize(normalMatrix * n)');
    expect(shader.fragmentShader).toContain('float rim = pow(');
    expect(shader.fragmentShader).toContain('diffuseColor.a *= max(');
  });

  it('a bubble whose big one is long gone is forgotten too', () => {
    const layer = new BurpLayer(new Scene());
    layer.emit('4:1.000', 1.2, 0, 30, 0, 0.8, 0.1);
    layer.update(1.2 + BURP_LIFE + 0.05, Infinity);   // the big one popped and is forgotten
    expect(layer.size).toBe(1);
    layer.update(1.2 + BURP_TRAIL + BURP_LIFE + 0.05, Infinity);
    expect(layer.size).toBe(0);
  });
});
