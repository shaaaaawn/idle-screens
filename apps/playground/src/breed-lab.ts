/**
 * Breed lab — the visual step of the metaquarium breed intake
 * (packages/saver-metaquarium/breeds/README.md).
 *
 * One sheet, one row per model: side, nose-on and three-quarter views in the
 * model's AUTHORED materials, then the same three with every material in a
 * false colour and a legend of material → role → triangles. It is how an
 * intake is reviewed (by a person or an agent reading the screenshot):
 * did greedy meshing leave holes, which part is which material, is the eye
 * where the tank will look for it.
 *
 *   /breeds.html                 every optimised breed (its bundled chunk, src/breeds/<breed>.ts)
 *   /breeds.html?set=source      the untouched sources (breeds/source/*.glb)
 *   /breeds.html?set=both        source above optimised, per breed
 *   &only=shark,crab             a subset
 *   ?url=/a.glb,/b.glb           any models the dev server can serve
 *   ?minted=1,300,470            minted tokens: the ORIGINAL (its IPFS GLB, from the
 *                                asset host) above the token rebuilt from its breed's
 *                                bundled model and its paint (src/minted.ts) — the two
 *                                rows must match; &atlas=512 paints a betafish with the
 *                                host's 512² atlas instead of the bundled 256²
 *   &clips=swim,glide&times=0,0.25,0.5,0.75   a rigged minted breed's motion: per
 *                                token, a row per clip, side-on at those FRACTIONS of
 *                                the clip (&view=top from above, &view=nose head-on)
 */
import {
  AmbientLight, AnimationMixer, Box3, Color, DirectionalLight, HemisphereLight, Mesh, MeshLambertMaterial, type Material,
  type Object3D, PerspectiveCamera, Scene, Vector3, WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { BUNDLED_BREEDS } from '../../../packages/saver-metaquarium/src/breeds';
import { MINTED_ATLAS, MINTED_PAINT } from '../../../packages/saver-metaquarium/src/minted/index';
import { atlasTexture, MINTED_ATLAS_URL, paintMinted, prepareMintedBase } from '../../../packages/saver-metaquarium/src/minted';
import { breedOf, fishAsset } from '../../../packages/saver-metaquarium/src/farm';
import { resolveIpfsUrls } from '../../../packages/saver-metaquarium/src/ipfs';

const SRC = import.meta.glob('../../../packages/saver-metaquarium/breeds/source/*.glb', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
const nameOf = (p: string): string => p.split('/').pop()!.replace(/\.glb$/, '');

const q = new URLSearchParams(location.search);
const set = q.get('set') ?? 'out';
const only = q.get('only')?.split(',').filter(Boolean);
const rows: { label: string; url?: string; load?: () => Promise<Object3D>; clip?: string }[] = [];
const clipNames = q.get('clips')?.split(',').filter(Boolean) ?? [];
const names = [...new Set([...Object.keys(BUNDLED_BREEDS), ...Object.keys(SRC).map(nameOf)])].sort()
  .filter((n) => !only || only.includes(n));
for (const u of q.get('url')?.split(',').filter(Boolean) ?? []) rows.push({ label: u.split('/').pop()!, url: u });
const b64 = (s: string): ArrayBuffer => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)).buffer;
for (const id of q.get('minted')?.split(',').map(Number).filter(Number.isInteger) ?? []) {
  const breed = breedOf(id);
  const original = fishAsset(id, '3d');
  if (!breed || !original) continue;
  rows.push({
    label: `#${id} ${breed} · original`,
    load: async () => {
      // Down the gateway ladder: the first that serves it.
      let err: unknown;
      for (const url of resolveIpfsUrls(original)) {
        try { return (await loader.loadAsync(url)).scene; } catch (e) { err = e; }
      }
      throw err;
    },
  });
  rows.push({
    label: `#${id} ${breed} · minted`,
    load: async () => {
      const gltf = await loader.parseAsync(b64((await BUNDLED_BREEDS[breed]!()).default), '');
      const paint = (await MINTED_PAINT[breed]!()).default.tokens[id]!;
      let atlas = null;
      if (paint[0].some((m) => m.atlas)) {
        // &atlas=512 falls back to the bundled 256², as the tank does.
        if (q.get('atlas') === '512') {
          atlas = await fetch(`${MINTED_ATLAS_URL}${id}.webp`)
            .then(async (res) => (res.ok ? atlasTexture(await res.arrayBuffer()) : null))
            .catch(() => null);
        }
        atlas ??= await atlasTexture(b64((await MINTED_ATLAS[id]!()).default));
      }
      const fish = paintMinted(prepareMintedBase(gltf.scene, gltf.animations), paint, atlas);
      fish.animations = gltf.animations;
      return fish;
    },
  });
}
if (clipNames.length) {
  // Motion review: only the rebuilt (rigged) fish, a row per clip.
  const minted = rows.splice(0).filter((r) => r.label.endsWith('· minted'));
  for (const r of minted) for (const clip of clipNames) rows.push({ ...r, label: `${r.label.replace(' · minted', '')} · ${clip}`, clip });
}
const times = (q.get('times') ?? '0,0.25,0.5,0.75,1,1.25').split(',').map(Number);
for (const n of q.get('url') ? [] : names) {
  const s = Object.entries(SRC).find(([k]) => nameOf(k) === n)?.[1];
  const o = BUNDLED_BREEDS[n];
  if ((set === 'source' || set === 'both') && s) rows.push({ label: `${n} · source`, url: s });
  // The optimised model is the chunk the tank swims, decoded: there is no other copy.
  if ((set === 'out' || set === 'both') && o) rows.push({ label: `${n} · optimised`, load: async () => (await loader.parseAsync(b64((await o()).default), '')).scene });
}

const FALSE = ['#ff5a5a', '#5ad1ff', '#ffd23a', '#7dff6a', '#c77dff', '#ff9a3a', '#3affc8', '#ff6ad5', '#9aa4ff', '#f0f0f0'];
const role = (m: string): string => /eye/i.test(m) ? (/black|pupil/i.test(m) ? 'eye·pupil' : /white|sclera/i.test(m) ? 'eye·sclera' : 'eye·?') : /glow/i.test(m) ? 'glow' : /^KEEP-/.test(m) ? 'kept' : /primary/i.test(m) ? 'coat A' : /secondary/i.test(m) ? 'coat B' : 'RANDOM coat';

const CELL = 260, COLS = clipNames.length ? times.length : 6;
const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(CELL * COLS, CELL * Math.max(1, rows.length));
renderer.setScissorTest(true);
const loader = new GLTFLoader();
const draco = new DRACOLoader(); draco.setDecoderPath('/draco/'); loader.setDRACOLoader(draco);

function stage(obj: Object3D): Scene {
  const scene = new Scene();
  scene.background = new Color('#18212c');
  scene.add(new HemisphereLight(0xdfe9ff, 0x3a3040, 1.1), new AmbientLight(0xffffff, 0.25));
  const key = new DirectionalLight(0xffffff, 1.6); key.position.set(3, 5, 4); scene.add(key);
  scene.add(obj);
  return scene;
}
const views: Array<[string, (d: number) => Vector3]> = [
  ['side', (d) => new Vector3(d, 0, 0)],
  ['nose', (d) => new Vector3(0, 0, d)],
  ['¾ top', (d) => new Vector3(d * 0.6, d * 0.55, d * 0.6)],
];

(async () => {
  const sheet = document.getElementById('sheet')!;
  let row = 0;
  for (const r of rows) {
    const root = r.load ? await r.load() : (await loader.loadAsync(r.url!)).scene;
    const box = new Box3().setFromObject(root), size = box.getSize(new Vector3()), centre = box.getCenter(new Vector3());
    root.position.sub(centre);
    // Nose-on means along the swim axis — the tank's rule, the longer horizontal extent.
    const swimX = size.x > size.z;
    const span = Math.max(size.x, size.y, size.z);
    let tris = 0; const mats = new Map<string, number>();
    root.traverse((o) => {
      const m = o as Mesh; if (!m.isMesh) return;
      const t = (m.geometry.index ? m.geometry.index.count : m.geometry.getAttribute('position').count) / 3;
      tris += t;
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) mats.set(mat.name || '(unnamed)', (mats.get(mat.name || '(unnamed)') ?? 0) + t);
    });
    if (r.clip) {
      // The rig's frame: nose +z, up +y. Side-on from +x (its left), the clip
      // sampled at each fraction of its length.
      const clip = root.animations.find((c) => c.name === r.clip);
      const mixer = new AnimationMixer(root);
      if (clip) mixer.clipAction(clip).play();
      const scene = stage(root);
      const cam = new PerspectiveCamera(30, 1, span * 0.05, span * 20);
      times.forEach((f, c) => {
        mixer.setTime((clip?.duration ?? 0) * f);
        if (q.get('view') === 'top') cam.position.set(0, span * 2.4, span * 0.01);
        else if (q.get('view') === 'nose') cam.position.set(0, 0, span * 2.4);
        else cam.position.set(span * 2.4, 0, 0);
        cam.lookAt(0, 0, 0);
        const x = c * CELL, y = (rows.length - 1 - row) * CELL;
        renderer.setViewport(x, y, CELL, CELL); renderer.setScissor(x, y, CELL, CELL);
        renderer.render(scene, cam);
        const lab = document.createElement('div'); lab.className = 'label';
        lab.style.left = `${x + 4}px`; lab.style.top = `${row * CELL + 4}px`;
        lab.textContent = c === 0 ? `${r.label}${clip ? '' : ' (no clip!)'}  ${f}` : `${f}`;
        sheet.append(lab);
      });
      row += 1;
      continue;
    }
    const authored = stage(root);
    // False colour: clone with one flat lit colour per material name.
    const matNames = [...mats.keys()];
    const fc = root.clone(true);
    fc.traverse((o) => {
      const m = o as Mesh; if (!m.isMesh) return;
      const pick = (mat: Material): Material => new MeshLambertMaterial({ color: FALSE[matNames.indexOf(mat.name || '(unnamed)') % FALSE.length] });
      m.material = Array.isArray(m.material) ? m.material.map(pick) : pick(m.material);
    });
    const coded = stage(fc);
    const cam = new PerspectiveCamera(30, 1, span * 0.05, span * 20);
    const d = span * 2.2;
    for (let c = 0; c < COLS; c++) {
      const [, dir] = views[c % 3]!;
      let p = dir(d); if (!swimX && c % 3 !== 2) p = new Vector3(p.z, p.y, p.x); // keep "side" side-on whatever the axis
      cam.position.copy(p); cam.lookAt(0, 0, 0);
      const x = c * CELL, y = (rows.length - 1 - row) * CELL;
      renderer.setViewport(x, y, CELL, CELL); renderer.setScissor(x, y, CELL, CELL);
      renderer.render(c < 3 ? authored : coded, cam);
    }
    const lab = document.createElement('div'); lab.className = 'label';
    lab.style.left = '4px'; lab.style.top = `${row * CELL + 4}px`;
    // DOM nodes, not innerHTML: `r.label` comes from `?url=` and material names
    // from the loaded GLB, so either could carry markup (CodeQL js/xss).
    const name = document.createElement('b'); name.textContent = r.label;
    lab.append(name, `  ${Math.round(tris)} tris  swim ${swimX ? 'x' : 'z'}  size ${size.toArray().map((v) => v.toFixed(1)).join('×')}`);
    const leg = document.createElement('div'); leg.className = 'label';
    leg.style.left = `${3 * CELL + 4}px`; leg.style.top = `${row * CELL + 4}px`;
    matNames.forEach((n, i) => {
      const sw = document.createElement('span'); sw.className = 'sw';
      sw.style.background = String(FALSE[i % FALSE.length]);
      leg.append(...(i ? ['\n'] : []), sw, `${n} → ${role(n)} (${Math.round(mats.get(n)!)})`);
    });
    sheet.append(lab, leg);
    row += 1;
  }
  document.body.dataset.ready = '1';
})();
