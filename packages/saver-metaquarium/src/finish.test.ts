import { describe, expect, it } from 'vitest';
import { FinishPass } from './finish';
import { METAQUARIUM_PARAMS } from './manifest';
import { PARAM_DOCS } from './guide';

describe('finish', () => {
  it('is off by default and documented', () => {
    expect(METAQUARIUM_PARAMS.finish).toMatchObject({ type: 'number', default: 0, min: 0, max: 1 });
    expect(PARAM_DOCS.finish).toMatch(/dither/);
  });
  it('builds and disposes without a GL context (the tank makes it lazily)', () => {
    const p = new FinishPass({ bloom: true });
    expect(() => p.dispose()).not.toThrow();
  });
});

describe('finish render path (a stand-in renderer)', () => {
  const fake = () => {
    const calls: string[] = [];
    let target: unknown = null;
    const r = {
      autoClear: true,
      getDrawingBufferSize: (v: { set: (x: number, y: number) => void }) => { v.set(640, 360); return v; },
      getRenderTarget: () => target,
      setRenderTarget: (t: unknown) => { target = t; calls.push(t ? 'target' : 'canvas'); },
      copyFramebufferToTexture: () => { calls.push('copy'); },
      clear: () => { calls.push('clear'); },
    };
    return { r, calls };
  };
  it('draws the scene, copies it, blooms on the high tier, then composites over the canvas', () => {
    const { r, calls } = fake();
    const draws: string[] = [];
    const raw = (s: { name?: string; children: unknown[] }) => { draws.push(s.children.length ? 'quad' : 'scene'); };
    const p = new FinishPass({ bloom: true });
    p.render(r as never, raw as never, { children: [] } as never, {} as never, 0.8);
    expect(draws[0]).toBe('scene');
    expect(calls).toContain('copy');
    expect(draws.filter((d) => d === 'quad')).toHaveLength(6); // 5 bloom passes + composite
    expect(calls.at(-1)).toBe('canvas');
    expect(r.autoClear).toBe(true);
    // Same size again: no reallocation, and without bloom only the composite.
    const q = new FinishPass({ bloom: false });
    draws.length = 0;
    q.render(r as never, raw as never, { children: [] } as never, {} as never, 0.5);
    q.render(r as never, raw as never, { children: [] } as never, {} as never, 0.5);
    expect(draws.filter((d) => d === 'quad')).toHaveLength(2);
    p.dispose(); q.dispose();
  });
  it('leaves a frame drawn into a render target alone', () => {
    const { r, calls } = fake();
    r.setRenderTarget({});
    const draws: number[] = [];
    new FinishPass({ bloom: true }).render(r as never, (() => draws.push(1)) as never, { children: [] } as never, {} as never, 1);
    expect(draws).toHaveLength(1);
    expect(calls).not.toContain('copy');
  });
});

describe('tilt-shift (in the finish)', () => {
  const fake = () => {
    const calls: string[] = [];
    let target: unknown = null;
    const r = {
      autoClear: true,
      getDrawingBufferSize: (v: { set: (x: number, y: number) => void }) => { v.set(640, 360); return v; },
      getRenderTarget: () => target,
      setRenderTarget: (t: unknown) => { target = t; calls.push(t ? 'target' : 'canvas'); },
      copyFramebufferToTexture: () => { calls.push('copy'); },
      clear: () => { calls.push('clear'); },
    };
    return { r, calls };
  };

  it('is off by default and documented', () => {
    expect(METAQUARIUM_PARAMS.tiltShift).toMatchObject({ type: 'number', default: 0, min: 0, max: 1 });
    expect(PARAM_DOCS.tiltShift).toMatch(/model/);
  });

  it('adds its own three-step blur only when on, and composites over the canvas', () => {
    const { r } = fake();
    const draws: string[] = [];
    const raw = (s: { children: unknown[] }) => { draws.push(s.children.length ? 'quad' : 'scene'); };
    const p = new FinishPass({ bloom: false });
    p.render(r as never, raw as never, { children: [] } as never, {} as never, 0.5);
    const without = draws.filter((d) => d === 'quad').length;
    draws.length = 0;
    p.tilt = 0.8;
    p.render(r as never, raw as never, { children: [] } as never, {} as never, 0.5);
    expect(draws.filter((d) => d === 'quad').length).toBe(without + 3);
    p.dispose();
  });
});

describe('depth of field (in the finish)', () => {
  const fake = () => {
    let target: unknown = null;
    return {
      autoClear: true,
      getDrawingBufferSize: (v: { set: (x: number, y: number) => void }) => { v.set(640, 360); return v; },
      getRenderTarget: () => target, setRenderTarget: (t: unknown) => { target = t; },
      copyFramebufferToTexture: () => {}, clear: () => {},
    };
  };
  it('is off by default and documented', () => {
    expect(METAQUARIUM_PARAMS.depthOfField).toMatchObject({ type: 'number', default: 0, min: 0, max: 1 });
    expect(PARAM_DOCS.depthOfField).toMatch(/subject/);
  });
  it('blurs only with a depth to read: a frame with one gets the blur chain, one without does not', () => {
    const draws: string[] = [];
    const raw = (s: { children: unknown[] }) => { draws.push(s.children.length ? 'quad' : 'scene'); };
    const p = new FinishPass({ bloom: false });
    p.dof = 1;
    const plain = { texture: {}, depthTexture: null, width: 640, height: 360 };
    p.renderFrom(fake() as never, raw as never, plain as never, 0.5, 0);
    const without = draws.length;
    draws.length = 0;
    p.renderFrom(fake() as never, raw as never, { ...plain, depthTexture: {} } as never, 0.5, 0);
    expect(draws.length).toBe(without + 3);
    p.dispose();
  });
});
