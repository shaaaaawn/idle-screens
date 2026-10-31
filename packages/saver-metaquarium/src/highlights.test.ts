import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { SRGBColorSpace, WebGLRenderTarget } from 'three';
import { describe, expect, it } from 'vitest';
import { FinishPass } from './finish';
import { HighlightPass, KNEE, canHoldHighlights, displaySpace, shoulder } from './highlights';
import { METAQUARIUM_PARAMS } from './manifest';
import { PARAM_DOCS } from './guide';

describe('shoulder', () => {
  it('leaves everything below the knee alone', () => {
    for (const v of [0, 0.1, 0.5, KNEE]) expect(shoulder(v)).toBe(v);
  });

  it('eases past white into it without a crease, and never reaches it', () => {
    const e = 1e-4;
    expect((shoulder(KNEE + e) - shoulder(KNEE)) / e).toBeCloseTo(1, 2);
    let prev = shoulder(KNEE);
    for (let v = KNEE + 0.01; v < 3; v += 0.01) {
      const s = shoulder(v);
      expect(s).toBeGreaterThan(prev);
      expect(s).toBeLessThan(1);
      prev = s;
    }
    // Twice and three times white still land on different 8-bit levels: a shaft over bright sand keeps a gradient.
    expect(Math.round(shoulder(3) * 255) - Math.round(shoulder(2) * 255)).toBeGreaterThanOrEqual(1);
    expect(Math.round(shoulder(2) * 255) - Math.round(shoulder(1) * 255)).toBeGreaterThanOrEqual(3);
  });
});

describe('displaySpace', () => {
  it('marks the target so three treats it like the canvas', () => {
    const t = displaySpace(new WebGLRenderTarget(4, 4));
    expect(t.texture.colorSpace).toBe(SRGBColorSpace);
    expect((t as WebGLRenderTarget & { isXRRenderTarget?: boolean }).isXRRenderTarget).toBe(true);
  });

  it('still means "output colour space and tone mapping as the canvas" in the installed three', () => {
    // The flag is the only way to have a target hold display-space values; if a three upgrade changes what it
    // means, the highlights pass would silently draw everything darker (linear) — so read the source and fail here.
    const require = createRequire(import.meta.url);
    // `three` exports no package.json; its main file is build/three.cjs.
    const root = dirname(dirname(require.resolve('three')));
    const programs = readFileSync(join(root, 'src/renderers/webgl/WebGLPrograms.js'), 'utf8');
    expect(programs).toMatch(/currentRenderTarget\.isXRRenderTarget === true \? currentRenderTarget\.texture\.colorSpace/);
    expect(programs).toMatch(/currentRenderTarget === null \|\| currentRenderTarget\.isXRRenderTarget === true/);
  });
});

describe('highlights render path (a stand-in renderer)', () => {
  const fake = (w = 640, h = 360) => {
    const calls: string[] = [];
    let target: unknown = null;
    const size = { w, h };
    const r = {
      autoClear: true,
      capabilities: { isWebGL2: true },
      extensions: { has: (n: string) => n === 'EXT_color_buffer_float' },
      getDrawingBufferSize: (v: { set: (x: number, y: number) => void }) => { v.set(size.w, size.h); return v; },
      getRenderTarget: () => target,
      setRenderTarget: (t: unknown) => { target = t; calls.push(t ? 'target' : 'canvas'); },
      copyFramebufferToTexture: () => { calls.push('copy'); },
      clear: () => { calls.push('clear'); },
    };
    return { r, calls, size };
  };
  const scene = { children: [] };
  const draw = (log: string[]) => (s: { children: unknown[] }) => { log.push(s.children.length ? 'quad' : 'scene'); };

  it('is off by default and documented', () => {
    expect(METAQUARIUM_PARAMS.highlights).toMatchObject({ type: 'number', default: 0, min: 0, max: 1 });
    expect(PARAM_DOCS.highlights).toMatch(/clipping/);
  });

  it('needs WebGL2 with float colour buffers', () => {
    expect(canHoldHighlights(fake().r as never)).toBe(true);
    expect(canHoldHighlights({ ...fake().r, extensions: { has: () => false } } as never)).toBe(false);
    expect(canHoldHighlights({ ...fake().r, capabilities: { isWebGL2: false } } as never)).toBe(false);
  });

  it('draws the scene into its buffer, then the shoulder onto the canvas; follows the canvas size', () => {
    const { r, calls, size } = fake();
    const log: string[] = [];
    const p = new HighlightPass(4);
    p.render(r as never, draw(log) as never, scene as never, {} as never, 1);
    expect(log).toEqual(['scene', 'quad']);
    expect(calls).toEqual(['target', 'canvas']);
    const t = p.draw(r as never, draw(log) as never, scene as never, {} as never);
    expect([t.width, t.height, t.samples]).toEqual([640, 360, 4]);
    size.w = 512; size.h = 288; // the pixel governor rescales the canvas
    const u = p.draw(r as never, draw(log) as never, scene as never, {} as never);
    expect(u).toBe(t);
    expect([u.width, u.height]).toEqual([512, 288]);
    p.dispose();
  });

  it('leaves a frame drawn into a render target alone', () => {
    const { r, calls } = fake();
    r.setRenderTarget({});
    calls.length = 0;
    const log: string[] = [];
    new HighlightPass(0).render(r as never, draw(log) as never, scene as never, {} as never, 1);
    expect(log).toEqual(['scene']);
    expect(calls).toEqual([]);
  });

  it('hands its buffer to the finish, which grades it without copying the canvas', () => {
    const { r, calls } = fake();
    const log: string[] = [];
    const hl = new HighlightPass(4), fin = new FinishPass({ bloom: true });
    fin.renderFrom(r as never, draw(log) as never, hl.draw(r as never, draw(log) as never, scene as never, {} as never), 0.6, 1);
    expect(log[0]).toBe('scene');
    expect(log.filter((d) => d === 'quad')).toHaveLength(6); // 5 bloom passes + composite
    expect(calls).not.toContain('copy');
    expect(calls.at(-1)).toBe('canvas');
    hl.dispose(); fin.dispose();
  });
});

describe('the buffer keeps its depth for depth of field', () => {
  const fake = () => {
    let target: unknown = null;
    return {
      autoClear: true, capabilities: { isWebGL2: true }, extensions: { has: () => true },
      getDrawingBufferSize: (v: { set: (x: number, y: number) => void }) => { v.set(320, 180); return v; },
      getRenderTarget: () => target, setRenderTarget: (t: unknown) => { target = t; }, clear: () => {},
    };
  };
  it('adds a depth texture when asked, and drops it again (the buffer is remade either way)', () => {
    const r = fake(), p = new HighlightPass(0), raw = () => {};
    expect(p.draw(r as never, raw as never, { children: [] } as never, {} as never).depthTexture).toBeFalsy();
    p.withDepth = true;
    const d = p.draw(r as never, raw as never, { children: [] } as never, {} as never);
    expect(d.depthTexture).toBeTruthy();
    expect([d.depthTexture!.image.width, d.depthTexture!.image.height]).toEqual([320, 180]);
    p.withDepth = false;
    expect(p.draw(r as never, raw as never, { children: [] } as never, {} as never).depthTexture).toBeFalsy();
    p.dispose();
  });
});
