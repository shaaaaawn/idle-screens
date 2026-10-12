import { describe, expect, it } from 'vitest';
import { parseTownProps } from './town-mix';

describe('parseTownProps', () => {
  it('parses kinds, counts and styles, with or without spaces around : and /', () => {
    const { props, problems } = parseTownProps('fence/coral, mailbox / clam, bench : 6 / stone, sock:2');
    expect(problems).toEqual([]);
    expect(props.fence).toEqual({ style: 'coral' });
    expect(props.mailbox).toEqual({ style: 'clam' });
    expect(props.bench).toEqual({ count: 6, style: 'stone' });
    expect(props.sock).toEqual({ count: 2 });
  });

  it('keeps the defaults and clamps', () => {
    const { props } = parseTownProps('bench, sock:99, fence');
    expect(props.bench).toEqual({ count: 4, style: null });
    expect(props.sock).toEqual({ count: 4 });
    expect(props.fence).toEqual({ style: null });
  });

  it('rejects a space inside a word or number instead of joining it', () => {
    expect(parseTownProps('fen ce').problems).toHaveLength(1);
    expect(parseTownProps('bench:1 2').problems).toHaveLength(1);
  });

  it('stays linear on a long run of spaces (CodeQL js/polynomial-redos)', () => {
    const evil = `a${' '.repeat(50_000)}!`;
    const t0 = performance.now();
    const { problems } = parseTownProps(evil);
    expect(performance.now() - t0).toBeLessThan(200);
    expect(problems).toHaveLength(1);
  });
});
