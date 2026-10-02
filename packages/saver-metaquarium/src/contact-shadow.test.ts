import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3, type Material } from 'three';
import { ContactShadows, contactShade } from './contact-shadow';

describe('contact shadows', () => {
  it('dark under the body and out to the feet, gone just past them', () => {
    expect(contactShade(0)).toBe(1);
    expect(contactShade(0.4)).toBe(1);
    expect(contactShade(0.75)).toBeGreaterThan(0.3);
    expect(contactShade(1)).toBe(0);
    for (let r = 0; r < 1; r += 0.05) expect(contactShade(r + 0.05)).toBeLessThanOrEqual(contactShade(r));
  });

  it('places one per walker and draws only the ones set', () => {
    const s = new ContactShadows(2);
    expect(s.mesh.count).toBe(0);
    s.set(0, 1, 2, 3, new Quaternion(), 10, 8);
    s.set(5, 0, 0, 0, new Quaternion(), 1, 1); // past capacity: ignored
    s.commit(1);
    expect(s.mesh.count).toBe(1);
    s.commit(9); // clamped to the capacity
    expect(s.mesh.count).toBe(2);
    const at = new Vector3(), m = s.mesh.instanceMatrix.array;
    at.set(m[12]!, m[13]!, m[14]!);
    expect(at.toArray()).toEqual([1, 2, 3]);
    expect(m[0]).toBeCloseTo(10);
    expect(m[10]).toBeCloseTo(8);
    expect((s.mesh.material as Material).userData.mqOwned).toBe(true);
  });
});
