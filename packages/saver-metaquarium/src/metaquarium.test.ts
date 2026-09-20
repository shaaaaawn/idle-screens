import { describe, expect, it } from 'vitest';
import { createMetaquarium } from './metaquarium';

describe('createMetaquarium manifest wiring', () => {
  it('defaults to the webgl2 tank manifest', () => {
    const { manifest } = createMetaquarium();
    expect(manifest.minBackend).toBe('webgl2');
    expect(manifest.costTier).toBe('medium');
  });

  it('the lofi backend only claims what its Canvas2D renderer needs, so capability gating never blocks it on WebGL2-less devices', () => {
    const { manifest } = createMetaquarium({ backend: 'lofi' });
    expect(manifest.minBackend).toBe('canvas2d');
    expect(manifest.costTier).toBe('low');
  });
});
