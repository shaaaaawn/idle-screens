import { describe, expect, it } from 'vitest';
import { buildLofiField } from './lofi';
import {
  applyRoom, buildLofiExtras, critterPose, CRITTERS, DEFAULT_LOFI_PARAMS, duneY, GEODE_PALETTE, hexRgb,
  lanternPos, lofiParamsFrom, lofiParamsKey, motePos, shoalCentre, shoalColors,
} from './lofi-extras';
import { NPC_ICONS } from './lofi-npc-icons';
import { NPC_CATALOG } from './ipfs';

describe('lofi extras — the TV tank’s room and atmosphere', () => {
  it('applies room overrides only for authored keys, as the TV sees them', () => {
    const values = { fogColor: '#030009', floorColor: '#0a1d33', floraDensity: 0, interior: 'none', marineSnow: 0 };
    const none = lofiParamsFrom(values, new Set());
    expect(none.fogColor).toBeUndefined();
    expect(none.floorColor).toBeUndefined();
    expect(none.floraDensity).toBeUndefined();
    const all = lofiParamsFrom(values, new Set(Object.keys(values)));
    expect(all.fogColor).toBe('#030009');
    expect(all.floraDensity).toBe(0);
    expect(lofiParamsFrom({ fogColor: 'teal' }, new Set(['fogColor'])).fogColor).toBeUndefined();
  });

  it('clamps and defaults the atmosphere params', () => {
    const p = lofiParamsFrom({ marineSnow: 4, skyLanterns: -1, shoal: '0.5', shoalSpeed: 9 }, new Set());
    expect(p).toMatchObject({ marineSnow: 1, skyLanterns: 0, shoal: 0.5, shoalKind: 'neon', shoalSpeed: 2 });
    expect(lofiParamsKey(p)).not.toBe(lofiParamsKey(DEFAULT_LOFI_PARAMS));
  });

  it('reads hex colours like the TV', () => {
    expect(hexRgb('#fff')).toEqual({ r: 1, g: 1, b: 1 });
    expect(hexRgb('#000000')).toEqual({ r: 0, g: 0, b: 0 });
    expect(hexRgb('red')).toBeNull();
    expect(hexRgb(undefined)).toBeNull();
  });

  it('a mix of only unminted breeds swims critters, not a random minted cast', () => {
    const f = buildLofiField(7, true, 'reef', 'dot:1,dolphin:1,babyfish:3');
    expect(f.fish).toHaveLength(0);
    expect(f.extras.critters.map((c) => c.breed)).toEqual(['dot', 'dolphin', 'babyfish', 'babyfish', 'babyfish']);
    // No mix at all still casts the seeded minted fish.
    expect(buildLofiField(7, true, 'reef', '').fish).toHaveLength(13);
  });

  it('never disturbs the original stream: the minted layout is unchanged by extras', () => {
    const plain = buildLofiField(42, false, 'kelp', '300:4');
    const busy = buildLofiField(42, false, 'kelp', '300:4,crab:3', { ...DEFAULT_LOFI_PARAMS, marineSnow: 1, skyLanterns: 1, shoal: 1 });
    expect(busy.fish).toEqual(plain.fish);
    expect(busy.kelp).toEqual(plain.kelp);
    expect(busy.bubbles).toEqual(plain.bubbles);
    expect(busy.extras.critters).toHaveLength(3);
  });

  it('caps critters by tier and counts atmosphere by density', () => {
    const p = { ...DEFAULT_LOFI_PARAMS, marineSnow: 0.5, skyLanterns: 0.5, shoal: 0.5 };
    expect(buildLofiExtras(1, true, 'crab:24', p).critters).toHaveLength(6);
    expect(buildLofiExtras(1, false, 'crab:24', p).critters).toHaveLength(4);
    const rich = buildLofiExtras(1, true, '', p);
    expect([rich.snow.length, rich.lanterns.length, rich.shoal.length]).toEqual([30, 3, 12]);
  });

  it('poses are closed-form: floor critters stand on the dune, swimmers in their lane', () => {
    const e = buildLofiExtras(5, true, 'crab:1,shark:1', DEFAULT_LOFI_PARAMS);
    const crab = e.critters.find((c) => c.breed === 'crab')!;
    const shark = e.critters.find((c) => c.breed === 'shark')!;
    for (const t of [0, 5_000, 123_456]) {
      const p = critterPose(crab, t, 1920, 1080);
      expect(p.y).toBeCloseTo(duneY(p.x, 1080) - p.side * 0.42, 9);
      const s = critterPose(shark, t, 1920, 1080);
      expect(s.y / 1080).toBeGreaterThan(0.1);
      expect(s.y / 1080).toBeLessThan(0.8);
    }
    expect(critterPose(crab, 1000, 1920, 1080)).toEqual(critterPose(crab, 1000, 1920, 1080));
  });

  it('snow falls, lanterns drift and the shoal crosses', () => {
    const e = buildLofiExtras(9, true, '', { ...DEFAULT_LOFI_PARAMS, marineSnow: 1, skyLanterns: 1, shoal: 1 });
    const m = e.snow[0]!;
    expect(motePos(m, 1000, 1920, 1080).y).not.toBe(motePos(m, 0, 1920, 1080).y);
    const l = e.lanterns[0]!;
    const lp = lanternPos(l, 500_000, 1920, 1080);
    expect(lp.x).toBeGreaterThanOrEqual(0);
    expect(lp.x).toBeLessThan(1920);
    expect(lp.glow).toBeGreaterThanOrEqual(0.6);
    expect(shoalCentre(0.4, 1, 0, 1920, 1080).x).toBeCloseTo(-384, 9);
    for (const k of ['neon', 'rummynose', 'ember', 'other']) expect(shoalColors(k).body.r).toBeGreaterThan(0);
  });

  it('room overrides: geode, then water, then floor', () => {
    const base = buildLofiField(1, true, 'reef').palette;
    const geode = applyRoom(base, { ...DEFAULT_LOFI_PARAMS, interior: 'geode' });
    expect(geode.shaftAlpha).toBe(0);
    expect(geode.top).toEqual(GEODE_PALETTE.top);
    const fog = applyRoom(base, { ...DEFAULT_LOFI_PARAMS, fogColor: '#000000', floorColor: '#ffffff' });
    expect(fog.mid).toEqual({ r: 0, g: 0, b: 0 });
    expect(fog.top.r).toBeCloseTo(0.06, 9);
    expect(fog.dune).toEqual({ r: 1, g: 1, b: 1 });
  });

  it('every unminted breed has a critter entry and a bundled icon', () => {
    for (const npc of NPC_CATALOG) {
      expect(CRITTERS[npc.breed]?.id).toBe(npc.id);
      expect(NPC_ICONS[npc.id]).toMatch(/^data:image\/png;base64,/);
    }
  });

  it('floraDensity rides on the field', () => {
    expect(buildLofiField(3, true, 'kelp', '', { ...DEFAULT_LOFI_PARAMS, floraDensity: 0 }).flora).toBe(0);
    expect(buildLofiField(3, true, 'kelp', '').flora).toBeUndefined();
  });
});
