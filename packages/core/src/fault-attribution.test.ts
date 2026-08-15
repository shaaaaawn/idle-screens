import { describe, expect, it } from 'vitest';
import { isSaverFaultFilename, isSaverFaultRejectionHint } from './fault-attribution';

const ORIGIN = 'http://localhost:5173';

describe('isSaverFaultFilename (ErrorEvent path)', () => {
  it('claims inline / synthetic throws (no filename)', () => {
    expect(isSaverFaultFilename('', ORIGIN)).toBe(true);
    expect(isSaverFaultFilename(undefined, ORIGIN)).toBe(true);
  });

  it('claims scripts that name saver/engine code, on any origin', () => {
    expect(
      isSaverFaultFilename(`${ORIGIN}/@fs/repo/idle-screens/packages/core/src/engine.ts`, ORIGIN),
    ).toBe(true);
    expect(isSaverFaultFilename('https://cdn.example.com/@idle-screens/schema/dist/index.js', ORIGIN)).toBe(true);
    expect(isSaverFaultFilename('https://cdn.example.com/three.module.js', ORIGIN)).toBe(true);
  });

  it('claims same-origin scripts even without name markers — a production bundle chunk or a dev harness file is where saver code actually runs (the crash.spec CR1/CR2 regression)', () => {
    expect(isSaverFaultFilename(`${ORIGIN}/src/main.ts`, ORIGIN)).toBe(true);
    expect(isSaverFaultFilename(`${ORIGIN}/assets/index-Dq3fA2.js`, ORIGIN)).toBe(true);
  });

  it('skips foreign scripts with no saver markers: extensions and third-party CDNs', () => {
    expect(
      isSaverFaultFilename('chrome-extension://abcdef/content.js', ORIGIN),
    ).toBe(false);
    expect(isSaverFaultFilename('https://cdn.analytics.example.com/tag.js', ORIGIN)).toBe(false);
  });

  it('treats opaque origins as their own origin (file:// native wrappers)', () => {
    expect(isSaverFaultFilename('file:///app/bundle.js', 'null')).toBe(true);
  });
});

describe('isSaverFaultRejectionHint (unhandledrejection path)', () => {
  it('claims empty or URL-free hints (inline / synthetic reasons)', () => {
    expect(isSaverFaultRejectionHint('', ORIGIN)).toBe(true);
    expect(isSaverFaultRejectionHint('Error: tank ran dry', ORIGIN)).toBe(true);
  });

  it('claims hints naming saver code', () => {
    expect(
      isSaverFaultRejectionHint(
        'Error: boom\n    at https://cdn.example.com/saver-metaquarium/dist/index.js:10:2',
        ORIGIN,
      ),
    ).toBe(true);
  });

  it('claims hints with any same-origin frame', () => {
    expect(
      isSaverFaultRejectionHint(`Error: boom\n    at mount (${ORIGIN}/assets/index-Dq3fA2.js:1:9000)`, ORIGIN),
    ).toBe(true);
  });

  it('skips hints made solely of foreign, unmarked script URLs', () => {
    expect(
      isSaverFaultRejectionHint(
        'Error: boom\n    at https://cdn.analytics.example.com/tag.js:3:1',
        ORIGIN,
      ),
    ).toBe(false);
  });
});
