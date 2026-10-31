import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('shader hooks', () => {
  it('nothing chains a material\'s onBeforeCompile by hand — stackPatch does, tagged', () => {
    // A hand-made chain (`const prev = m.onBeforeCompile; m.onBeforeCompile = (s) => { prev(s); … }`) carries
    // no tags, so every tagged patch already in it sees itself missing and wraps again: the betta's eye rig did
    // this, and a betta under nearFade declared vMqNearDepth twice and failed to compile on prod (2026-10-31).
    // Assigning a FRESH hook (dropping the old one) is fine; reading the old one to call it is the trap.
    const dir = new URL('.', import.meta.url).pathname;
    const offenders = readdirSync(dir)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'hooks.ts')
      .flatMap((f) => readFileSync(join(dir, f), 'utf8').split('\n').map((line, i) => ({ f, i: i + 1, line })))
      .filter(({ line }) => /=\s*[\w.]+\.onBeforeCompile\s*(;|\.bind)/.test(line) || /\bprev(?:ious)?\.call\([^)]*shader/.test(line))
      .map(({ f, i, line }) => `${f}:${i}: ${line.trim()}`);
    expect(offenders).toEqual([]);
  });
});
