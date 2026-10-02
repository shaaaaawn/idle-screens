import { AnimationClip, BoxGeometry, Bone, Color, Group, Mesh, NumberKeyframeTrack, Vector4 } from 'three';
import { describe, expect, it } from 'vitest';
import { BOOT, DEAD, GLITCH, HACKER_CLIPS, TYPE, hackerCrashes, hackerCycle, hackerFrame, hackerMoment, moodAt, rigHacker } from './hacker';
import { GLYPH_NAMES, GLYPHS, PHOSPHORS, rigScreen, screenMaterial, setScreen, type ScreenState } from './screen';

const DUR: Record<string, number> = { swim: 1, type: 2.4, glitch: 1 };
const puppet = (): Group => { const g = new Group(); const b = new Bone(); b.name = 'body'; g.add(b); return g; };
const clips = (names: readonly string[] = HACKER_CLIPS): AnimationClip[] =>
  names.map((n) => new AnimationClip(n, DUR[n]!, [new NumberKeyframeTrack('body.position[x]', [0, DUR[n]!], [0, 1])]));
const key = (s: ScreenState): string => `${s.mode}|${s.from}|${s.to}|${s.wipe > 0 && s.wipe < 1 ? 'wiping' : ''}`;

describe('the hackerfish screen (screen.ts)', () => {
  it('every glyph is 10×10, and the neutral face is the designer\'s 5×5 face doubled', () => {
    for (const name of GLYPH_NAMES) {
      expect(GLYPHS[name], name).toHaveLength(10);
      for (const row of GLYPHS[name]) expect(row, name).toMatch(/^[.#]{10}$/);
    }
    // The delivered face: eyes in cells (1,1) and (3,1), a mouth across row 3, of a 5×5 screen.
    const five = ['.....', '.#.#.', '.....', '.###.', '.....'];
    const doubled = five.flatMap((r) => { const w = [...r].map((c) => c + c).join(''); return [w, w]; });
    expect(GLYPHS.neutral).toEqual(doubled);
  });

  it('measures the screen, faces it out of the front, and sets what it shows', () => {
    const body = new Group();
    const glass = new Mesh(new BoxGeometry(10, 10, 2).translate(0, 0, 14), screenMaterial('SCREEN-Glass', new Color(PHOSPHORS[0])));
    const other = new Mesh(new BoxGeometry(14, 14, 34));
    body.add(glass, other);
    const rig = rigScreen(body, 0.25)!;
    expect(rig.uniforms).toHaveLength(1);
    const u = rig.uniforms[0]!;
    expect(u.uScrRect!.value.toArray()).toEqual([5, -5, 10, 10]); // seen from in front, its left is +x
    expect(u.uScrTime!.value.z).toBe(15);                           // the front plane
    setScreen(rig, 3.5, { from: 'happy', to: 'love', wipe: 0.4, mode: 'face', level: 0.8 });
    expect(u.uScrState!.value.equals(new Vector4(GLYPH_NAMES.indexOf('happy'), GLYPH_NAMES.indexOf('love'), 0.4, 0))).toBe(true);
    expect(u.uScrColor!.value.w).toBe(0.8);
    expect(u.uScrTime!.value.x).toBe(3.5);
    expect(rigScreen(new Group(), 0)).toBeNull();
  });

  it('one shared program for every screen, with the display patched in', () => {
    const a = screenMaterial('SCREEN-Glass', new Color('#39ff88')), b = screenMaterial('SCREEN-Pixels', new Color('#ffb43a'));
    expect(a.customProgramCacheKey()).toBe(b.customProgramCacheKey());
    const shader = { uniforms: {}, vertexShader: '#include <begin_vertex>', fragmentShader: '#include <color_fragment>' };
    a.onBeforeCompile(shader as never, undefined as never);
    expect(shader.vertexShader).toContain('vScrP = position');
    expect(shader.fragmentShader).toContain('mqScreen(diffuseColor.rgb)');
    expect(Object.keys(shader.uniforms)).toEqual(expect.arrayContaining(['uScrAtlas', 'uScrRect', 'uScrState', 'uScrColor', 'uScrTime']));
    expect(a.userData.mqScreen).toBe(true);
  });
});

describe('the hackerfish (hacker.ts)', () => {
  it('rigs only a model that carries its three clips', () => {
    expect(rigHacker(puppet(), clips())).not.toBeNull();
    expect(rigHacker(puppet(), clips(['swim']))).toBeNull();
  });

  it('hacks once a cycle under code rain, crashes on some, reboots, and comes back happy', () => {
    let found = -1;
    for (let k = 0; k < 20 && found < 0; k++) if (hackerCrashes(0, k)) found = k;
    const c = hackerCycle(0);
    const at = (u: number): number => found * c.period - c.offset + c.at + u;
    expect(hackerMoment(0, at(1)).screen.mode).toBe('rain');
    expect(hackerMoment(0, at(1)).doing).toBe('hack');
    expect(hackerMoment(0, at(1)).weights.type).toBeCloseTo(1, 6);
    const g = TYPE + 1.5; // the crash starts 1.5 s after the typing
    expect(hackerMoment(0, at(g + GLITCH / 2)).screen.mode).toBe('glitch');
    expect(hackerMoment(0, at(g + GLITCH + DEAD / 2)).screen.to).toBe('dead');
    expect(hackerMoment(0, at(g + GLITCH + DEAD + BOOT / 2)).screen.mode).toBe('boot');
    const back = hackerMoment(0, at(g + GLITCH + DEAD + BOOT + 0.5)).screen;
    expect([back.mode, back.to]).toEqual(['face', 'happy']);
    const strikes = Array.from({ length: 40 }, (_, k) => hackerCrashes(2, k));
    expect(strikes).toContain(true);
    expect(strikes).toContain(false);
  });

  it('wears every mood, and the designer\'s own face most', () => {
    const seen = new Map<string, number>();
    for (let s = 0; s < 400; s++) seen.set(moodAt(1, s), (seen.get(moodAt(1, s)) ?? 0) + 1);
    expect([...seen.keys()].sort()).toEqual(['cool', 'happy', 'love', 'neutral', 'sleepy', 'surprised', 'wink']);
    expect(seen.get('neutral')!).toBe(Math.max(...seen.values()));
  });

  it('the body clips share one whole, and it is pure in (index, t)', () => {
    const a = rigHacker(puppet(), clips())!, b = rigHacker(puppet(), clips())!;
    for (let t = 0; t < 60; t += 0.13) {
      const w = hackerMoment(3, t).weights;
      expect(w.swim + w.type + w.glitch).toBeCloseTo(1, 9);
    }
    for (const t of [1.1, 17.5, 33.3]) {
      const ma = hackerFrame(a, t, 3, 50); hackerFrame(a, t + 4, 3, 90);
      expect(hackerFrame(a, t, 3, 50)).toEqual(ma);
      expect(hackerFrame(b, t, 3, 50)).toEqual(ma);
      for (const n of HACKER_CLIPS) expect(b.actions[n].time).toBe(a.actions[n].time);
    }
  });

  it('the screen never flashes: at most three changes in any second', () => {
    for (const i of [0, 1, 4, 9]) {
      const changes: number[] = [];
      let prev = key(hackerMoment(i, 0).screen);
      for (let t = 0.01; t < 120; t += 0.01) {
        const k = key(hackerMoment(i, t).screen);
        if (k !== prev) changes.push(t);
        prev = k;
      }
      for (let j = 0; j < changes.length; j++) {
        expect(changes.filter((t) => t >= changes[j]! && t < changes[j]! + 1).length).toBeLessThanOrEqual(3 * 2); // 3 flashes a second, each a pair of key changes (a wipe starts and ends)
      }
    }
  });
});
