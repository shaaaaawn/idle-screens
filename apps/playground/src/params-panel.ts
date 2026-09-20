import type { ParamDef, ParamValue, SaverPlugin } from '@idle-screens/core';
import { sampleTrack } from '@idle-screens/core';
import type { TimelineHandle } from './timeline-panel';

export interface ParamsHandle {
  select(saver: SaverPlugin): void;
  refresh(): void;
}

const LOCAL_FISH: { label: string; url: string }[] = [
  // Base-relative: the Pages deploy serves this app under /idle-screens/.
  { label: '#257 Angelfish', url: `${import.meta.env.BASE_URL}assets/metaquarium/fish-257-angelfish.glb` },
  { label: '#100 Betafish', url: `${import.meta.env.BASE_URL}assets/metaquarium/fish-100-betafish.glb` },
];

const IPFS_FISH: { label: string; url: string }[] = [
  { label: '#257 Angelfish', url: 'ipfs://QmaHbEQAP6k2zopJHJBzyaK62zNX5yH8yASDjkaG4DY9Dp/fish_257_of_the_metaquarium_3d.glb' },
  { label: '#258 Angelfish', url: 'ipfs://QmUZGF3ge3d9rzrtxrD6V4qx2gLtGeeNLuCb8fQeNyUkwJ/fish_258_of_the_metaquarium_3d.glb' },
  { label: '#259 Angelfish', url: 'ipfs://QmfBBnNrVrkffMKoESvq3cB6nAWGpfMPjduTgw1unahvPf/fish_259_of_the_metaquarium_3d.glb' },
  { label: '#100 Betafish', url: 'ipfs://Qmb5Uu8u154QTzoGpB6ypwVfPZ8NUsU519tQmrgE8yQrWV/fish_100_of_the_metaquarium_3d.glb' },
  { label: '#457 Seahorse', url: 'ipfs://QmVvEaCa6zRp8Z9YkkZVYBn2owSdwZxupEQacjfd1b2HA2/fish_457_of_the_metaquarium_3d.glb' },
  { label: '#497 Sea Turtle', url: 'ipfs://QmTBNvoUiwPw9HSUmy1qKCWPBKkBRAensgooYVqMmsviaE/fish_497_of_the_metaquarium_3d.glb' },
];

const ALL_FISH = [...LOCAL_FISH, ...IPFS_FISH];

/**
 * Metaquarium grew from 8 params to 40; a flat alphabet-less list of 40 rows
 * is where a new param goes to be forgotten. Sections are an ORDER and a
 * heading only — anything the manifest adds that is not named here still
 * renders, under "other", so the panel can never fall behind the spec again.
 */
const PARAM_SECTIONS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['camera', ['cameraAzimuth', 'cameraElevation', 'cameraDistance', 'autoRotate']],
  ['cast', ['fishMix', 'fishCount', 'fishUrl', 'dracoPath', 'vignette']],
  // The renderer's look: on by default, listed so it can be turned off.
  ['look', ['fishLighting', 'fishGlow', 'fishMetal']],
  ['stage', ['followSpot', 'spotStrength', 'spotColor']],
  ['swim', ['swimStyle', 'swimSpeed', 'swimVariance', 'bodyWiggle', 'pathShape', 'lightSeek']],
  ['formation', ['formationShape', 'formationBreathe']],
  ['maneuver', ['maneuver', 'maneuverRate', 'maneuverIntensity']],
  ['room', ['environment', 'floorKind', 'waterY', 'rayStrength', 'envProps']],
  ['world', ['rockDensity', 'rockVeins', 'geodeHomes', 'interior', 'floraDensity', 'bubbleVents', 'marineSnow', 'skyLanterns']],
  ['crystals', ['propMix', 'crystalScale', 'crystalWild', 'crystalGlow', 'crystalPulse', 'crystalTint']],
  ['atmosphere', ['fogColor', 'fogNear', 'fogFar', 'floorColor', 'moteDensity', 'moteColor']],
];

/** Starting points for the DSL strings — a text box with no examples is a
 *  param nobody tries. Offered as suggestions; anything may be typed. */
const DSL_PRESETS: Readonly<Record<string, readonly string[]>> = {
  vignette: ['tea', 'bedtime', 'seek', 'a =table, b =door | b >table @a | a @b talk, b @a nod | b @a talk, a @b wiggle | a b circle rug'],
  propMix: [
    'crystal#hero:1@lotus/hotpink',
    'crystal#keep:1@spire/cyan*6,crystal:3@spire/purple*3.5,crystal:4@druse',
    'crystal:6@lotus/rainbow',
    'crystal#hero:1@coral/hotpink,crystal:4@coral',
    'crystal:3@spire/white,crystal:2@druse/cyan',
    'crystal:1@lotus/glass,crystal:5@druse',
    'crystal:8@scatter/purple',
  ],
  fishMix: [
    '257:2,100:1',
    'angelfish:6@school',
    'angelfish:4@school,betafish:2@drift,seahorse:2@hover,seaturtle:1@surface',
    '100:6@bottom',
    '457:3@hover,497:2@surface',
  ],
};

function sectioned(keys: readonly string[]): Array<[string, string[]]> {
  const left = new Set(keys);
  const out: Array<[string, string[]]> = [];
  for (const [label, names] of PARAM_SECTIONS) {
    const mine = names.filter((n) => left.delete(n));
    if (mine.length) out.push([label, mine]);
  }
  if (left.size) out.push([out.length ? 'other' : '', [...left]]);
  return out;
}

function buildControl(
  path: string,
  def: ParamDef,
  value: ParamValue,
  onChange: (v: ParamValue) => void,
): { row: HTMLElement; update: (v: ParamValue) => void } {
  const row = document.createElement('div');
  row.className = 'wb-param';

  const dt = document.createElement('dt');
  dt.textContent = path;
  dt.title = path;

  const dd = document.createElement('dd');

  let update: (v: ParamValue) => void;

  if (path === 'fishUrl') {
    const sel = document.createElement('select');
    sel.className = 'wb-input wb-select wb-param-input';

    const localGroup = document.createElement('optgroup');
    localGroup.label = 'Local (fast)';
    for (const f of LOCAL_FISH) {
      const o = document.createElement('option');
      o.value = f.url;
      o.textContent = f.label;
      localGroup.append(o);
    }

    const ipfsGroup = document.createElement('optgroup');
    ipfsGroup.label = 'IPFS (live stream)';
    for (const f of IPFS_FISH) {
      const o = document.createElement('option');
      o.value = f.url;
      o.textContent = f.label;
      ipfsGroup.append(o);
    }

    const customOpt = document.createElement('option');
    customOpt.value = '';
    customOpt.textContent = 'Custom URL…';

    sel.append(localGroup, ipfsGroup, customOpt);

    const match = ALL_FISH.find((f) => f.url === String(value));
    sel.value = match ? match.url : '';
    if (!match && value) {
      const o = document.createElement('option');
      o.value = String(value);
      o.textContent = String(value).split('/').pop() ?? String(value);
      sel.prepend(o);
      sel.value = String(value);
    }
    sel.addEventListener('change', () => {
      if (sel.value === '') {
        const url = window.prompt('GLB URL (local path or ipfs://…)', String(value));
        if (url) onChange(url);
        else sel.value = String(value);
      } else {
        onChange(sel.value);
      }
    });
    dd.append(sel);
    update = (v) => {
      const s = String(v);
      const m = ALL_FISH.find((f) => f.url === s);
      if (!m && s && !Array.from(sel.options).some((o) => o.value === s)) {
        const o = document.createElement('option');
        o.value = s;
        o.textContent = s.split('/').pop() ?? s;
        sel.prepend(o);
      }
      sel.value = m ? m.url : s;
    };
  } else if (def.type === 'number') {
    const range = document.createElement('input');
    range.type = 'range';
    range.className = 'wb-param-slider';
    range.min = String(def.min ?? 0);
    range.max = String(def.max ?? 100);
    range.step = path === 'geodeHomes' || (def.max ?? 100) - (def.min ?? 0) > 10 ? '1' : '0.01';
    range.value = String(value);

    const num = document.createElement('input');
    num.type = 'number';
    num.className = 'wb-input wb-param-num';
    num.min = String(def.min ?? 0);
    num.max = String(def.max ?? 100);
    num.step = range.step;
    num.value = String(value);

    range.addEventListener('input', () => {
      const v = Number(range.value);
      num.value = String(v);
      onChange(v);
    });
    num.addEventListener('change', () => {
      const v = Number(num.value);
      range.value = String(v);
      onChange(v);
    });
    dd.append(range, num);
    update = (v) => { range.value = String(v); num.value = String(v); };
  } else if (def.type === 'enum' && def.options) {
    const sel = document.createElement('select');
    sel.className = 'wb-input wb-select wb-param-input';
    for (const opt of def.options) {
      const o = document.createElement('option');
      o.value = opt;
      o.textContent = opt;
      sel.append(o);
    }
    sel.value = String(value);
    sel.addEventListener('change', () => onChange(sel.value));
    dd.append(sel);
    update = (v) => { sel.value = String(v); };
  } else if (def.type === 'color') {
    const color = document.createElement('input');
    color.type = 'color';
    color.className = 'wb-param-color';
    color.value = String(value);
    const hex = document.createElement('span');
    hex.className = 'wb-param-hex';
    hex.textContent = String(value);
    color.addEventListener('input', () => {
      hex.textContent = color.value;
      onChange(color.value);
    });
    dd.append(color, hex);
    update = (v) => { color.value = String(v); hex.textContent = String(v); };
  } else if (def.type === 'bool') {
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'wb-param-check';
    cb.checked = Boolean(value);
    cb.addEventListener('change', () => onChange(cb.checked));
    dd.append(cb);
    update = (v) => { cb.checked = Boolean(v); };
  } else {
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'wb-input wb-param-input';
    inp.value = String(value);
    inp.addEventListener('change', () => onChange(inp.value));
    dd.append(inp);
    const presets = DSL_PRESETS[path];
    if (presets) {
      const list = document.createElement('datalist');
      list.id = `wb-presets-${path}`;
      for (const p of presets) list.append(Object.assign(document.createElement('option'), { value: p }));
      inp.setAttribute('list', list.id);
      inp.placeholder = presets[0] ?? '';
      // A datalist only filters by what is typed; clearing on focus shows all.
      inp.addEventListener('focus', () => inp.select());
      dd.append(list);
    }
    update = (v) => { inp.value = String(v); };
  }

  for (const input of dd.querySelectorAll('input, select')) input.setAttribute('aria-label', path);
  row.append(dt, dd);
  return { row, update };
}

export function buildParamsPanel(
  mount: HTMLElement,
  timeline: TimelineHandle,
): ParamsHandle {
  const panel = document.createElement('div');
  panel.className = 'wb-panel-content wb-params-panel';
  mount.append(panel);

  let currentSaver: SaverPlugin | null = null;
  let controls: { path: string; update: (v: ParamValue) => void }[] = [];

  const render = (saver: SaverPlugin): void => {
    currentSaver = saver;
    controls = [];
    panel.innerHTML = '';

    const space = saver.manifest.paramSpace;
    if (!space || Object.keys(space).length === 0) {
      panel.textContent = 'No steerable parameters.';
      return;
    }

    const dl = document.createElement('dl');
    dl.className = 'wb-props wb-params-list';

    const t = timeline.currentTime();
    const track = timeline.getTrack();
    const sampled = track
      ? sampleTrack(space, track, t)
      : Object.fromEntries(Object.entries(space).map(([k, def]) => [k, def.default]));

    const sections = sectioned(Object.keys(space));
    const rows: Array<{ path: string; row: HTMLElement; head: HTMLElement | null }> = [];
    for (const [label, paths] of sections) {
      let head: HTMLElement | null = null;
      if (label && sections.length > 1) {
        head = document.createElement('div');
        head.className = 'wb-param-section';
        head.textContent = label;
        dl.append(head);
      }
      for (const path of paths) {
        const def = space[path]!;
        const value = sampled[path] ?? def.default;
        const { row, update } = buildControl(path, def, value, (v) => {
          timeline.setParam(path, v);
        });
        dl.append(row);
        controls.push({ path, update });
        rows.push({ path, row, head });
      }
    }

    // Past a dozen params, finding one by scrolling is the slow way.
    if (rows.length > 12) {
      const search = document.createElement('input');
      search.type = 'search';
      search.className = 'wb-input wb-param-filter';
      search.placeholder = `Filter ${rows.length} params…`;
      search.setAttribute('aria-label', 'Filter parameters by name');
      search.addEventListener('input', () => {
        const q = search.value.trim().toLowerCase();
        const live = new Set<HTMLElement>();
        for (const r of rows) {
          const hit = q === '' || r.path.toLowerCase().includes(q)
            || (r.head?.textContent ?? '').includes(q);
          r.row.hidden = !hit;
          if (hit && r.head) live.add(r.head);
        }
        for (const r of rows) if (r.head) r.head.hidden = !live.has(r.head);
      });
      panel.append(search);
    }

    panel.append(dl);
  };

  const refreshValues = (): void => {
    if (!currentSaver?.manifest.paramSpace) return;
    const space = currentSaver.manifest.paramSpace;
    const t = timeline.currentTime();
    const track = timeline.getTrack();
    const values = track
      ? sampleTrack(space, track, t)
      : Object.fromEntries(Object.entries(space).map(([k, def]) => [k, def.default]));
    for (const c of controls) {
      const v = values[c.path];
      if (v !== undefined) c.update(v);
    }
  };

  return {
    select(saver) {
      render(saver);
    },
    refresh: refreshValues,
  };
}
