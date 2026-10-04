import { readFileSync } from 'node:fs';
import { BoxGeometry, Color, Group, Mesh, MeshLambertMaterial, Quaternion, Scene, Vector3, type AnimationClip, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { INK_LIFE, InkLayer, inkPuffAt } from './ink';
import {
  newOctopusOutput, OCTOPUS_CLIPS, OCTOPUS_COATS, OCTOPUS_SHIFT, octopusCoat, octopusRepertoire, octopusCycle, octopusFrame, octopusGait, octopusHeading, octopusIdle,
  octopusLook, octopusMoment, octopusPlaced, octopusSkin, octopusSpot, octopusStart, octopusStopAt, rigOctopus, setOctopusSkin, type OctopusOutput, type OctopusRig, type OctopusStop,
} from './octopus';
import { createRng } from '@idle-screens/core';
import { compileSwimPlan } from './plan';

/** The real octopus, as the tank loads it. */
async function load(): Promise<{ scene: Object3D; clips: AnimationClip[] }> {
  const buf = readFileSync(new URL('../breeds/octopus.glb', import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
  return { scene: gltf.scene, clips: gltf.animations };
}
async function rigged(): Promise<{ g: Group; rig: OctopusRig; body: Object3D }> {
  const { scene, clips } = await load();
  const rig = rigOctopus(scene, clips, 0.4, 3)!;
  const g = new Group(); g.add(scene);
  return { g, rig, body: scene };
}
const plan = compileSwimPlan(createRng(3).fork(1), { radius: 120, yMin: 15, yMax: 72 });
const flat = (): number => 0;

describe('the octopus (octopus.ts)', () => {
  it('rigs the real model: every clip, both eyes with their pupils and brows, the siphon', async () => {
    const { rig } = await rigged();
    expect(Object.keys(rig.actions).sort()).toEqual([...OCTOPUS_CLIPS].sort());
    expect(rig.eyes.map((e) => [e.side, e.eye.name, e.pupil.name, e.brow?.name])).toEqual([[1, 'eyeL', 'pupilL', 'browL'], [-1, 'eyeR', 'pupilR', 'browR']]);
    expect(rig.siphon?.name).toBe('siphon');
  });

  it('keeps its pupils level with the world: rolled 30°, they turn back 30°; on its side, as far as an eye can (80°); pitched, level still', async () => {
    const { g, rig } = await rigged();
    const state = newOctopusOutput();
    const level = (): number => {
      // The pupil's own right (its bar) in the world: level means no rise.
      const e = rig.eyes[0]!, q = e.pupil.getWorldQuaternion(new Quaternion());
      const right = new Vector3(1, 0, 0).applyQuaternion(q.multiply(e.pupilAxes.clone().invert()));
      return Math.abs(right.y) / Math.hypot(right.x, right.y, right.z);
    };
    const at = (roll: number, pitch: number) => {
      g.quaternion.setFromAxisAngle(new Vector3(0, 0, 1), roll).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), pitch));
      g.updateMatrixWorld(true);
      const l = octopusLook(rig, 0.1, 3, { viewer: null, state });
      g.updateMatrixWorld(true);
      return l;
    };
    const r30 = at(Math.PI / 6, 0);
    expect(r30.bodyRoll).toBeCloseTo(30, -0.5);
    expect(r30.pupilRoll).toBeCloseTo(-30, -0.5);
    expect(level()).toBeLessThan(0.03);
    const side = at(Math.PI / 2, 0);
    expect(side.pupilRoll).toBe(-80);
    const pitched = at(0, Math.PI / 3);
    // Pitched, only the eye's own small swivel tilts its face: the pupil turns a little, and the bar is level.
    expect(Math.abs(pitched.pupilRoll)).toBeLessThan(15);
    expect(level()).toBeLessThan(0.03);
  });

  it('moves three ways, stops eight, and every cycle has room for its longest stop', () => {
    const gaits = new Set<string>(), stops = new Set<string>();
    for (let i = 0; i < 20; i++) for (let k = 0; k < 40; k++) { gaits.add(octopusGait(i, k)); stops.add(octopusStopAt(i, k)); }
    expect([...gaits].sort()).toEqual(['crawl', 'inkjet', 'jet', 'tiptoe']);
    expect([...stops].sort()).toEqual(['beckon', 'idle', 'look', 'peek', 'pounce', 'reach', 'sleep', 'wave']);
    for (let i = 0; i < 30; i++) expect(octopusCycle(i).stop).toBeGreaterThan(1 + 8 + 1 + 1.2);
  });

  it('goes along its route without a jump — crawled or jetted, every bout covers its share — and only a jet leaves the floor', () => {
    for (const i of [0, 1, 2, 5]) {
      let prev = octopusSpot(i, 0, plan, 0);
      for (let t = 0.05; t < 120; t += 0.05) {
        const s = octopusSpot(i, t, plan, 0);
        expect(Math.hypot(s.x - prev.x, s.z - prev.z)).toBeLessThan(2.5);
        prev = s;
        const m = octopusMoment(i, t);
        if (m.gait !== 'jet' && m.gait !== 'inkjet') expect(m.lift).toBe(0);
      }
    }
  });

  it('jets and tiptoes backwards (mantle first; on its rear arms), crawls mostly ahead', () => {
    for (let i = 0; i < 10; i++) for (let k = 0; k < 20; k++) {
      const g = octopusGait(i, k), h = octopusHeading(i, k);
      if (g !== 'crawl') expect(h).toBe(Math.PI);
      else expect(Math.abs(h)).toBeLessThan(1.2);
    }
  });

  it('its clips always make one whole, and it turns to face you to wave', async () => {
    const { rig } = await rigged();
    const out = newOctopusOutput();
    let faced = false;
    for (let t = 0; t < 200; t += 0.21) {
      octopusFrame(rig, { t, index: 4, plan, start: 0, len: 21, scale: 1, ground: flat, camX: 0, camZ: 300 }, out);
      expect(OCTOPUS_CLIPS.reduce((s, n) => s + rig.actions[n].getEffectiveWeight(), 0)).toBeCloseTo(1, 6);
      if (out.doing === 'wave' || out.doing === 'beckon' || out.doing === 'look') {
        const toCam = Math.atan2(0 - out.x, 300 - out.z), face = Math.atan2(out.fx, out.fz);
        expect(Math.abs(Math.atan2(Math.sin(toCam - face), Math.cos(toCam - face)))).toBeLessThan(0.05);
        faced = true;
      }
    }
    expect(faced).toBe(true);
  });

  it('a jet lifts it and sets it back down; an inked jet lets go one cloud', async () => {
    const { rig } = await rigged();
    let i = 0, k = 1;
    outer: for (i = 0; i < 40; i++) for (k = 1; k < 30; k++) if (octopusGait(i, k) === 'inkjet') break outer;
    const c = octopusCycle(i), start = k * (c.move + c.stop) - c.offset;
    const out = newOctopusOutput();
    const keys = new Set<string>();
    let high = 0;
    for (let u = 0; u < c.move + 0.5; u += 0.05) {
      octopusFrame(rig, { t: start + u, index: i, plan, start: 0, len: 21, scale: 1, ground: flat, camX: 0, camZ: 300 }, out);
      high = Math.max(high, out.y - out.groundY);
      if (out.ink) keys.add(out.ink.key);
    }
    expect(high).toBeGreaterThan(21);
    expect(out.y).toBeCloseTo(out.groundY, 6);
    expect(keys.size).toBe(1);
  });
});

describe('the octopus\'s skin', () => {
  it('goes pale, flushes, fades toward the floor and back to itself; the passing clouds are a shader on the coat', () => {
    const body = new Group();
    const mat = new MeshLambertMaterial({ color: new Color('#c03020') }); mat.name = 'PrimaryColor';
    body.add(new Mesh(new BoxGeometry(1, 1, 1), mat));
    const skin = octopusSkin(body);
    expect(skin.parts).toHaveLength(1);
    const mood = newOctopusOutput().mood;
    setOctopusSkin(skin, { ...mood, pale: 1 }, null);
    expect(mat.color.r + mat.color.g + mat.color.b).toBeGreaterThan(new Color('#c03020').r + new Color('#c03020').g + new Color('#c03020').b + 0.5);
    setOctopusSkin(skin, { ...mood, camo: 1 }, new Color('#0000ff'));
    expect(mat.color.b).toBeGreaterThan(0.4);
    setOctopusSkin(skin, mood, null);
    expect(mat.color.getHex()).toBe(new Color('#c03020').getHex());
    setOctopusSkin(skin, { ...mood, cloud: 0.8, cloudPhase: 2 }, null);
    expect(skin.cloud.value).toBe(0.8);
    const shader = { uniforms: {} as Record<string, unknown>, vertexShader: '#include <common>\n#include <begin_vertex>', fragmentShader: '#include <common>\n#include <color_fragment>' };
    mat.onBeforeCompile(shader as never, undefined as never);
    expect(shader.fragmentShader).toContain('uMqCloud');
    expect(shader.uniforms.uMqCloud).toBe(skin.cloud);
  });
});

describe('the octopus, more closely', () => {
  it('rigs only a whole model: every clip, and its crown', async () => {
    const { scene, clips } = await load();
    expect(rigOctopus(scene, clips.slice(0, 3), 1)).toBeNull();
    expect(rigOctopus(new Group(), clips, 1)).toBeNull();
  });

  it('starts somewhere along its route, and two octopuses on one spot make room for each other', async () => {
    const s0 = octopusStart(plan, 4);
    expect(s0).toBeGreaterThanOrEqual(0);
    expect(s0).toBeLessThan(plan.totalLength);
    const { rig } = await rigged();
    const alone = octopusFrame(rig, { t: 5, index: 4, plan, start: 0, len: 21, scale: 1, ground: flat, camX: 0, camZ: 300 }, newOctopusOutput());
    const spot = octopusSpot(4, 5, plan, 0);
    const crowded = octopusFrame(rig, { t: 5, index: 4, plan, start: 0, len: 21, scale: 1, ground: flat, camX: 0, camZ: 300, others: [9, spot.x + 1, spot.z] }, newOctopusOutput());
    expect(Math.hypot(crowded.x - alone.x, crowded.z - alone.z)).toBeGreaterThan(5);
  });

  it('placed by someone else, it just breathes', async () => {
    const { rig } = await rigged();
    octopusIdle(rig, 3, 2);
    expect(rig.actions.idle.getEffectiveWeight()).toBe(1);
    expect(OCTOPUS_CLIPS.filter((n) => n !== 'idle').every((n) => rig.actions[n].getEffectiveWeight() === 0)).toBe(true);
  });

  it('placed by someone else, it still keeps its pupils level and changes colour', async () => {
    const { g, rig } = await rigged();
    g.quaternion.setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 6);
    g.updateMatrixWorld(true);
    const dirty = { ...newOctopusOutput(), doing: 'jet' as const, stop: 'wave' as const, lift: 1, ink: { key: 'k', t: 0 } };
    const state = octopusPlaced(3, 400, dirty);
    expect(state).toMatchObject({ doing: 'idle', stop: null, lift: 0, ink: null });
    expect(state.coat).toEqual(octopusCoat(3, 400));
    const look = octopusLook(rig, 0.1, 3, { viewer: null, state });
    expect(look.pupilRoll).toBeCloseTo(-30, -0.5);
  });

  /** Its eyes, at a stop, a second into it, the viewer in front. */
  async function eyesAt(stop: OctopusStop | null, doing: OctopusOutput['doing'] = 'idle', into = 1.0) {
    const { g, rig } = await rigged();
    g.updateMatrixWorld(true);
    const state = { ...newOctopusOutput(), stop, doing, intoActivity: into };
    return { look: octopusLook(rig, 2.0, 3, { viewer: new Vector3(4, 8, 120), state }), rig };
  }

  it('its eyes at a stop: on you for a look (one brow up, pupils rounder), rounder still to wave and beckon', async () => {
    const look = (await eyesAt('look')).look;
    expect(look.at).toBe('viewer');
    expect(look.pupil).toBeCloseTo(1.6, 6);
    expect((await eyesAt('wave')).look.pupil).toBeCloseTo(1.8, 6);
    expect((await eyesAt('beckon')).look.at).toBe('viewer');
  });

  it('reaching or pouncing, its pupils go round; pouncing, it looks down at what it is landing on', async () => {
    expect((await eyesAt('reach')).look.pupil).toBeCloseTo(2.2, 6);
    const pounce = (await eyesAt('pounce')).look;
    expect(pounce.pupil).toBeCloseTo(2.4, 6);
    expect(pounce.at).toBe('down');
  });

  it('peeking, its eyes go up on their stalks and its brows with them', async () => {
    const { rig } = await eyesAt('peek', 'peek', 1.5);
    const e = rig.eyes[0]!;
    expect(e.eye.position.distanceTo(e.eyeRest.p)).toBeGreaterThan(2);
    expect(e.brow!.position.distanceTo(e.browRest!)).toBeGreaterThan(2);
  });

  it('asleep, its eyes are shut; jetting, its pupils narrow', async () => {
    const sleep = (await eyesAt('sleep', 'sleep', 3)).look;
    expect(sleep.lids).toEqual([1, 1]);
    expect(sleep.at).toBe('closed');
    expect((await eyesAt(null, 'jet')).look.pupil).toBeCloseTo(0.6, 6);
  });

  it('flushes deeper when excited, and its colours wander as it dreams', () => {
    const body = new Group();
    const mat = new MeshLambertMaterial({ color: new Color('#3060c0') }); mat.name = 'PrimaryColor';
    const other = new MeshLambertMaterial({ color: new Color('#ffffff') }); other.name = 'GLOW-Rings';
    body.add(new Mesh(new BoxGeometry(1, 1, 1), mat), new Mesh(new BoxGeometry(1, 1, 1), mat), new Mesh(new BoxGeometry(1, 1, 1), other));
    const skin = octopusSkin(body, 1);
    expect(skin.parts).toHaveLength(1);   // each coat material once, and only the coat
    const mood = newOctopusOutput().mood;
    const hsl = { h: 0, s: 0, l: 0 }, base = { h: 0, s: 0, l: 0 };
    new Color('#3060c0').getHSL(base);
    setOctopusSkin(skin, { ...mood, flush: 1 }, null);
    mat.color.getHSL(hsl);
    expect(hsl.l).toBeLessThan(base.l);
    setOctopusSkin(skin, { ...mood, dream: 1, dreamHue: 0.3 }, null);
    mat.color.getHSL(hsl);
    expect(Math.abs(hsl.h - base.h)).toBeGreaterThan(0.1);
  });
});

describe('the octopus changes colour', () => {
  it('has a repertoire of its own, and changes among it every so often — a dozen changes in five minutes', () => {
    for (const i of [0, 3, 8]) {
      const rep = octopusRepertoire(i);
      expect(new Set(rep).size).toBe(rep.length);
      for (const c of rep) expect(c).toBeLessThan(OCTOPUS_COATS.length);
      const worn = new Set<number>();
      let changes = 0, last = octopusCoat(i, 0).to;
      for (let t = 0; t < 300; t += 0.25) {
        const c = octopusCoat(i, t);
        worn.add(c.to);
        if (c.to !== last) { changes++; last = c.to; }
      }
      expect(worn.size).toBeGreaterThanOrEqual(3);
      expect(changes).toBeGreaterThan(8);
    }
  });

  it('a change sweeps in over about a second, and every frame agrees on it', () => {
    let seen = 0;
    for (let t = 1; t < 300 && seen < 5; t += 0.05) {
      const a = octopusCoat(2, t), b = octopusCoat(2, t + 0.05);
      if (a.wave < 1 && b.wave < 1) {
        expect([b.from, b.to]).toEqual([a.from, a.to]);
        expect(b.wave - a.wave).toBeCloseTo(0.05 / OCTOPUS_SHIFT, 6);
        seen++;
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('the skin wears the coat it is changing to, the old one beyond the wave, and the shader draws the sweep', () => {
    const body = new Group();
    const mat = new MeshLambertMaterial({ color: new Color('#c03020') }); mat.name = 'PrimaryColor';
    body.add(new Mesh(new BoxGeometry(1, 1, 1), mat));
    const skin = octopusSkin(body, 5);
    const mood = newOctopusOutput().mood;
    setOctopusSkin(skin, mood, null, { from: 0, to: 2, wave: 0.4 });
    expect(mat.color.getHex()).toBe(skin.coats[1]![0].getHex());
    expect(skin.parts[0]!.old.value.getHex()).toBe(new Color('#c03020').getHex());
    expect(skin.wave.value).toBe(0.4);
    setOctopusSkin(skin, mood, null, { from: 0, to: 2, wave: 1 });
    expect(skin.parts[0]!.old.value.getHex()).toBe(mat.color.getHex());
    const shader = { uniforms: {} as Record<string, unknown>, vertexShader: '#include <common>\n#include <begin_vertex>', fragmentShader: '#include <common>\n#include <color_fragment>' };
    mat.onBeforeCompile(shader as never, undefined as never);
    expect(shader.vertexShader).toContain('vMqWaveD');
    expect(shader.fragmentShader).toContain('mix(uMqOld, diffuseColor.rgb');
    expect(shader.uniforms.uMqOld).toBe(skin.parts[0]!.old);
  });
});

describe('ink (ink.ts)', () => {
  it('blooms out from the siphon, sinks, thins away; a seek back forgets it', () => {
    const c = { t: 10, x: 0, y: 20, z: 0, size: 4, seed: 0.3 };
    const p = { visible: false, x: 0, y: 0, z: 0, s: 0 };
    const early = inkPuffAt(c, 0, 10.1, { ...p }).s, mid = inkPuffAt(c, 0, 11.5, { ...p }).s, late = inkPuffAt(c, 0, 10 + INK_LIFE - 0.05, { ...p }).s;
    expect(mid).toBeGreaterThan(early);
    expect(late).toBeLessThan(mid * 0.4);
    expect(inkPuffAt(c, 0, 10 + INK_LIFE + 0.01, { ...p }).visible).toBe(false);
    const layer = new InkLayer(new Scene());
    layer.emit('1:2', 10, 0, 20, 0, 4); layer.emit('1:2', 10.5, 9, 9, 9, 4);
    expect(layer.size).toBe(1);
    expect(layer.update(11)).toBeGreaterThan(3);
    expect(layer.update(9)).toBe(0);
    expect(layer.size).toBe(0);
  });

  it('two keys of one length emitted at once do not make cloned clouds', () => {
    const at = (key: string) => {
      const layer = new InkLayer(new Scene());
      layer.emit(key, 10, 0, 20, 0, 4); layer.update(11);
      return Array.from(layer.mesh.instanceMatrix.array.slice(0, 48));
    };
    expect(at('3:7')).not.toEqual(at('5:2'));
  });
});
