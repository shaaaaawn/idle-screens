import { MeshBasicMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { emptyPoolUniforms } from './crystal-mesh';
import { FLORA_FEED, FLORA_LIGHT_TAG, FLORA_LIGHT_VERTEX, installFloraLight } from './flora-light';
import { hasPatch } from './hooks';

const compile = (m: MeshBasicMaterial) => {
  const shader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: 'void main() {\n#include <project_vertex>\n}', fragmentShader: '' };
  m.onBeforeCompile(shader as never, {} as never);
  return shader;
};

describe('flora light', () => {
  it('binds the tank\'s own pool uniforms, once', () => {
    const m = new MeshBasicMaterial({ vertexColors: true }), pools = emptyPoolUniforms();
    expect(installFloraLight(m, pools)).toBe(true);
    expect(installFloraLight(m, pools)).toBe(false);
    expect(hasPatch(m, FLORA_LIGHT_TAG)).toBe(true);
    const sh = compile(m);
    // The same objects: a re-layout rewrites them in place, no recompile.
    for (const k of ['uMqPoolN', 'uMqPoolPos', 'uMqPoolCol', 'uMqPoolPhase', 'uMqPoolGain', 'uMqPoolTime', 'uMqPoolPulse', 'uMqSpot', 'uMqSpotColor']) expect(sh.uniforms[k]).toBe(pools[k]);
    expect(sh.vertexShader).toContain('uniform vec4 uMqPoolPos[');
    expect(sh.vertexShader.match(/#include <project_vertex>/g)).toHaveLength(1);
    expect(m.customProgramCacheKey()).toContain(FLORA_LIGHT_TAG);
  });

  it('multiplies the plant\'s colour, capped, and keeps its hue past 1', () => {
    expect(FLORA_LIGHT_VERTEX).toMatch(/vColor\.rgb \*= 1\.0 \+ min\(/); // multiply, not add
    expect(FLORA_LIGHT_VERTEX).not.toMatch(/vColor\.rgb \+= feed/);
    expect(FLORA_LIGHT_VERTEX).toMatch(/vColor\.rgb \/= mqTop/); // scaled back whole
    expect(FLORA_FEED.cap).toBeLessThanOrEqual(1);
    // Same falloff as the floor pools and the fish tint.
    expect(FLORA_LIGHT_VERTEX).toMatch(/\/ \(1\.0 \+ q\)/);
    // Sheen only where a vertex asks for it.
    expect(FLORA_LIGHT_VERTEX).toMatch(/if \(aMat\.y > 0\.0\)/);
    expect(FLORA_LIGHT_VERTEX).not.toMatch(/random|noise\(/);
  });

  it('leaves a shader it cannot patch alone', () => {
    const m = new MeshBasicMaterial();
    installFloraLight(m, emptyPoolUniforms());
    const shader = { uniforms: {}, vertexShader: 'void main() {}', fragmentShader: '' };
    m.onBeforeCompile(shader as never, {} as never);
    expect(shader.vertexShader).toBe('void main() {}');
  });

  it('lights a geode too, without the flora\'s sheen (a geode has no aMat)', () => {
    const plain = new MeshBasicMaterial({ vertexColors: true }), pools = emptyPoolUniforms();
    expect(installFloraLight(plain, pools, false)).toBe(true);
    const sh = compile(plain);
    expect(sh.vertexShader).toContain('uniform vec4 uMqPoolPos[');
    expect(sh.vertexShader).not.toContain('#define MQ_SHEEN');
    const leafy = new MeshBasicMaterial({ vertexColors: true });
    installFloraLight(leafy, pools);
    expect(compile(leafy).vertexShader).toContain('#define MQ_SHEEN');
    expect(plain.customProgramCacheKey()).not.toBe(leafy.customProgramCacheKey());
  });
});
