import { MeshBasicMaterial, MeshLambertMaterial, ShaderLib, ShaderMaterial, type Material } from 'three';
import { describe, expect, it } from 'vitest';
import { NEAR_FADE, ROOM_FADE, bayer4, nearFadeRange, patchNearFade, patchRoomFade } from './nearfade';
import { METAQUARIUM_PARAMS } from './manifest';
import { PARAM_DOCS } from './guide';

type Shader = { uniforms: Record<string, unknown>; vertexShader: string; fragmentShader: string };
const compile = (m: Material, s: Shader): Shader => { m.onBeforeCompile(s as never, null as never); return s; };

describe('nearFade', () => {
  it('is off by default and documented', () => {
    expect(METAQUARIUM_PARAMS.nearFade).toMatchObject({ type: 'number', default: 0, min: 0, max: 1, ease: 'smooth' });
    expect(PARAM_DOCS.nearFade).toMatch(/lens/);
  });

  it('fades nothing at 0, and inside about a fish and a half at 1', () => {
    expect(nearFadeRange(0)).toEqual([0, 0]);
    const [gone, whole] = nearFadeRange(1);
    expect(whole).toBe(22);
    expect(gone).toBeCloseTo(7.92, 6);
    expect(nearFadeRange(0.5)[1]).toBeLessThan(whole);
  });

  it('never fades the follow camera\'s own subject', () => {
    // A snail followed from 40: its eyes on stalks stand out toward the lens, a third of the way at most.
    const [, whole] = nearFadeRange(1, 40);
    expect(whole).toBeLessThanOrEqual(0.55 * 40);
    expect(nearFadeRange(1, 18)[1]).toBeCloseTo(9.9, 6);
    expect(nearFadeRange(1, 200)[1]).toBe(22);
  });

  it('dithers through 16 distinct steps on a 4x4 tile, mid-step', () => {
    const steps = new Set<number>();
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) steps.add(Math.round((bayer4(x, y) - 1 / 32) * 16));
    expect([...steps].sort((a, b) => a - b)).toEqual([...Array(16).keys()]);
    expect(bayer4(4, 4)).toBe(bayer4(0, 0));
  });

  it('patches built-in materials once, sharing one uniform; leaves bare shaders alone', () => {
    const m = new MeshLambertMaterial();
    expect(patchNearFade(m)).toBe(true);
    expect(patchNearFade(m)).toBe(false);
    const s = compile(m, { uniforms: {}, vertexShader: ShaderLib.lambert.vertexShader, fragmentShader: ShaderLib.lambert.fragmentShader });
    expect(s.uniforms.uMqNearFade).toBe(NEAR_FADE);
    expect(s.vertexShader).toMatch(/vMqNearDepth = -mvPosition\.z;/);
    expect(s.fragmentShader).toMatch(/mqBayer4\(gl_FragCoord\.xy\) >= mqNearK\) discard/);
    const b = new MeshBasicMaterial();
    patchNearFade(b);
    expect(compile(b, { uniforms: {}, vertexShader: ShaderLib.basic.vertexShader, fragmentShader: ShaderLib.basic.fragmentShader }).uniforms.uMqNearFade).toBe(NEAR_FADE);
    const raw = new ShaderMaterial({ vertexShader: 'void main(){}', fragmentShader: 'void main(){}' });
    patchNearFade(raw);
    const r = compile(raw, { uniforms: {}, vertexShader: 'void main(){}', fragmentShader: 'void main(){}' });
    expect(r.uniforms.uMqNearFade).toBeUndefined();
    expect(r.fragmentShader).toBe('void main(){}');
  });

  it('dissolves a room crystal at the lens whole, by its own reach; untagged geometry never fades', () => {
    const m = new MeshBasicMaterial({ vertexColors: true });
    expect(patchRoomFade(m)).toBe(true);
    expect(patchRoomFade(m)).toBe(false);
    const s = compile(m, { uniforms: {}, vertexShader: ShaderLib.basic.vertexShader, fragmentShader: ShaderLib.basic.fragmentShader });
    expect(s.uniforms.uMqRoomFade).toBe(ROOM_FADE);
    // One value per crystal (its centre's distance less its reach), so every fragment of it shares the dither step.
    expect(s.vertexShader).toMatch(/aMqFade\.w > 0\.0 \? length\(\(modelViewMatrix \* vec4\(aMqFade\.xyz, 1\.0\)\)\.xyz\) - aMqFade\.w : 1e6/);
    expect(s.fragmentShader).toMatch(/mqRoomBayer4\(gl_FragCoord\.xy\) >= mqRoomK\) discard/);
    expect(ROOM_FADE.value.x).toBeLessThan(ROOM_FADE.value.y);
  });
});
