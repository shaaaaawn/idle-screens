import { createRng } from '@idle-screens/core';
import type { BufferAttribute, Mesh } from 'three';
import { describe, expect, it } from 'vitest';
import { buildRays } from './tank';

describe('light shafts (X122)', () => {
  it('each shaft breathes and sways on its own phase, where the room has always put it', () => {
    const { group, material } = buildRays(5, '#bfe8ff', 400, 0.6, createRng(9).fork(0x8a1));
    const phases = group.children.map((m) => ((m as Mesh).geometry.getAttribute('aPhase') as BufferAttribute).getX(0));
    expect(new Set(phases.map((p) => p.toFixed(4))).size).toBe(5);
    for (const p of phases) expect(p).toBeGreaterThanOrEqual(0);
    // The breathe and the sway both read the phase, and the sway moves the vertex.
    expect(material.fragmentShader).toMatch(/sin\(uTime \* 0\.4 \+ vPhase\)/);
    expect(material.vertexShader).toMatch(/w\.x \+= sin\(uTime \* 0\.15 \+ aPhase\)/);
    // The phase is a hash, not an rng draw: the shafts stand where they did (same rng draws as before).
    const rng = createRng(9).fork(0x8a1);
    for (const m of group.children) {
      const a = rng.next() * Math.PI * 2, r = 45 + rng.next() * 130;
      expect(m.position.x).toBeCloseTo(Math.cos(a) * r, 9);
      expect(m.position.z).toBeCloseTo(Math.sin(a) * r, 9);
      expect(m.rotation.y).toBeCloseTo(rng.next() * Math.PI, 9);
      expect(m.rotation.x).toBeCloseTo((rng.next() - 0.5) * 0.18, 9);
    }
  });
});
