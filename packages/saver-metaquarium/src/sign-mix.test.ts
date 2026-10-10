import { describe, expect, it } from 'vitest';
import { drawable, rasterText } from './pixel-font';
import { MAX_SIGNS, parseSignMix } from './sign-mix';

describe('parseSignMix', () => {
  it('reads kind, place, target, colour, size and text', () => {
    const { entries, problems } = parseSignMix('plank@gate:"Welcome, friends", neon@home1/#ff4fa0*1.5:OPEN, arrow@hub>gate:Castle, porthole');
    expect(problems).toEqual([]);
    expect(entries).toEqual([
      { kind: 'plank', place: 'gate', target: null, color: null, size: 1, text: 'Welcome, friends' },
      { kind: 'neon', place: 'home1', target: null, color: '#ff4fa0', size: 1.5, text: 'OPEN' },
      { kind: 'arrow', place: 'hub', target: 'gate', color: null, size: 1, text: 'Castle' },
      { kind: 'porthole', place: null, target: null, color: null, size: 1, text: '' },
    ]);
  });

  it('keeps the first colon as the split, so text may hold one', () => {
    expect(parseSignMix('led@plaza:TIDE: 4.2M').entries[0]?.text).toBe('TIDE: 4.2M');
  });

  it('keeps commas in unquoted words as part of the words', () => {
    const { entries, problems } = parseSignMix('led@plaza:NOW SHOWING - TANGS, BLOWFISH, AN OCTOPUS AND FRIENDS, ring:Lifeguard, porthole');
    expect(problems).toEqual([]);
    expect(entries.map((e) => [e.kind, e.text])).toEqual([
      ['led', 'NOW SHOWING - TANGS, BLOWFISH, AN OCTOPUS AND FRIENDS'], ['ring', 'Lifeguard'], ['porthole', ''],
    ]);
    // A sign with no words, or quoted words, is closed: what follows must be a sign.
    expect(parseSignMix('porthole, plank:"A", billboard').problems[0]).toMatch(/"billboard" is not a sign/);
    // A mistyped sign after words is reported, with the way to keep it as words.
    const typo = parseSignMix('plank:Hi there, billboard:HI');
    expect(typo.entries.map((e) => e.text)).toEqual(['Hi there']);
    expect(typo.problems[0]).toMatch(/not a sign .*"quotes"/);
  });

  it('says what it dropped or changed, and keeps going', () => {
    const { entries, problems } = parseSignMix('billboard:HI, plank@moon:Hello, ring>gate:Hi, neon*9:X, porthole:ABCDEFG, plank:日本');
    expect(entries.map((e) => e.kind)).toEqual(['plank', 'ring', 'neon', 'porthole', 'plank']);
    expect(entries[0]!.place).toBeNull();
    expect(entries[1]!.target).toBeNull();
    expect(entries[2]!.size).toBe(3);
    expect(entries[3]!.text).toBe('ABCD');
    expect(problems.join('\n')).toMatch(/"billboard" is not a sign/);
    expect(problems.join('\n')).toMatch(/"@moon" is not a place/);
    expect(problems.join('\n')).toMatch(/only an arrow points/);
    expect(problems.join('\n')).toMatch(/size is 0.5–3/);
    expect(problems.join('\n')).toMatch(/room for 4 characters/);
    expect(problems.join('\n')).toMatch(/cannot be drawn/);
  });

  it('caps the count', () => {
    const { entries, problems } = parseSignMix(Array.from({ length: MAX_SIGNS + 2 }, () => 'plank:A').join(','));
    expect(entries).toHaveLength(MAX_SIGNS);
    expect(problems).toHaveLength(2);
  });
});

describe('pixel font', () => {
  it('draws capitals for lower case and a gap between letters', () => {
    const a = rasterText('ab'), b = rasterText('AB');
    expect(a).toEqual(b);
    expect(a.w).toBe(11);
    expect(a.h).toBe(7);
    for (let y = 0; y < 7; y++) expect(a.bits[y * 11 + 5]).toBe(0); // the blank column
  });

  it('knows what it can draw', () => {
    expect(drawable('q')).toBe(true);
    expect(drawable('°')).toBe(true);
    expect(drawable('日')).toBe(false);
    expect(rasterText('').w).toBe(0);
  });
});
