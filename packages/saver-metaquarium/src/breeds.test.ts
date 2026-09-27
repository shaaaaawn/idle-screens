import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BUNDLED_BREEDS } from './breeds';
import { NPC_CATALOG } from './ipfs';

const here = (p: string): URL => new URL(p, import.meta.url);
const manifest = JSON.parse(readFileSync(here('../breeds/breeds.json'), 'utf8')) as { breeds: Record<string, { kind: string }> };

/** The JSON chunk of a GLB. */
function gltfJson(bytes: Uint8Array): { extensionsUsed?: string[]; materials?: { name?: string }[]; meshes: { primitives: { indices?: number; attributes: { POSITION: number } }[] }[]; accessors: { count: number }[] } {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(dv.getUint32(0, true)).toBe(0x46546c67); // 'glTF'
  const len = dv.getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + len)));
}
const ROLE = /eye|glow|^KEEP-|primary|secondary/i;

describe('bundled breeds (breeds/README.md)', () => {
  const names = Object.keys(manifest.breeds);

  it('every intake breed is bundled, catalogued, and nothing else is', () => {
    expect(Object.keys(BUNDLED_BREEDS).sort()).toEqual([...names].sort());
    expect(NPC_CATALOG.map((f) => f.breed).sort()).toEqual([...names].sort());
  });

  for (const name of names) {
    it(`${name}: the chunk IS the reviewed GLB, decoder-free, every part a role, within budget`, async () => {
      const b64 = (await BUNDLED_BREEDS[name]!()).default;
      const bytes = Uint8Array.from(Buffer.from(b64, 'base64'));
      // Drift guard: the lab reviews breeds/<name>.glb; the wall must swim the same bytes.
      expect(Buffer.compare(Buffer.from(bytes), readFileSync(here(`../breeds/${name}.glb`)))).toBe(0);
      const json = gltfJson(bytes);
      expect(json.extensionsUsed ?? []).not.toContain('KHR_draco_mesh_compression');
      // A material with no role is painted a random coat at runtime.
      for (const m of json.materials ?? []) expect(m.name ?? '').toMatch(ROLE);
      let tris = 0;
      for (const mesh of json.meshes) for (const p of mesh.primitives) tris += json.accessors[p.indices ?? p.attributes.POSITION]!.count / 3;
      // About twice a minted fish (~2.7k) at most: the intake's job.
      expect(tris).toBeLessThanOrEqual(6000);
    });
  }

  it('the server-side manifest never pulls model bytes in', () => {
    // manifest.ts → ipfs.ts is what idle-server imports to validate a mix.
    for (const file of ['./manifest.ts', './ipfs.ts']) {
      expect(readFileSync(here(file), 'utf8')).not.toMatch(/from '\.\/breeds'/);
    }
  });
});
