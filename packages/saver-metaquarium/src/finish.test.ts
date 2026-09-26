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
