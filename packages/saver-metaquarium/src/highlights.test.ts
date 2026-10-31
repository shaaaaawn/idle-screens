import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { SRGBColorSpace, WebGLRenderTarget } from 'three';
import { describe, expect, it } from 'vitest';
import { KNEE, displaySpace, shoulder } from './highlights';

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
