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
 *   /breeds.html                 every optimised breed (breeds/*.glb)
 *   /breeds.html?set=source      the untouched sources (breeds/source/*.glb)
 *   /breeds.html?set=both        source above optimised, per breed
 *   &only=shark,crab             a subset
 *   ?url=/a.glb,/b.glb           any models the dev server can serve
 *   &rig=seahorse&times=0,0.3,…  motion review: the model RIGGED (seahorse.ts),
 *                                side-on at each moment (seconds) — one row
 *                                per model, one column per moment;
 *                                &view=34 from behind, &view=top from above, &effort=1.9 working
 */
import {
  AmbientLight, Box3, Color, DirectionalLight, Group, HemisphereLight, Mesh, MeshLambertMaterial, type Material,
  type Object3D, PerspectiveCamera, Scene, Vector3, WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { rigSeahorse } from '../../../packages/saver-metaquarium/src/seahorse';

const OUT = import.meta.glob('../../../packages/saver-metaquarium/breeds/*.glb', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
const SRC = import.meta.glob('../../../packages/saver-metaquarium/breeds/source/*.glb', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
const nameOf = (p: string): string => p.split('/').pop()!.replace(/\.glb$/, '');

/** Labels and material names come from the URL and the GLB: never markup. */
const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const q = new URLSearchParams(location.search);
const set = q.get('set') ?? 'out';
const only = q.get('only')?.split(',').filter(Boolean);
const rows: { label: string; url: string }[] = [];
const names = [...new Set([...Object.keys(OUT), ...Object.keys(SRC)].map(nameOf))].sort()
  .filter((n) => !only || only.includes(n));
for (const u of q.get('url')?.split(',').filter(Boolean) ?? []) rows.push({ label: u.split('/').pop()!, url: u });
const rigName = q.get('rig');
const times = (q.get('times') ?? '0,0.25,0.5,0.75,1,1.25').split(',').map(Number);
for (const n of q.get('url') ? [] : names) {
  const s = Object.entries(SRC).find(([k]) => nameOf(k) === n)?.[1];
  const o = Object.entries(OUT).find(([k]) => nameOf(k) === n)?.[1];
  if ((set === 'source' || set === 'both') && s) rows.push({ label: `${n} · source`, url: s });
  if ((set === 'out' || set === 'both') && o) rows.push({ label: `${n} · optimised`, url: o });
}

const FALSE = ['#ff5a5a', '#5ad1ff', '#ffd23a', '#7dff6a', '#c77dff', '#ff9a3a', '#3affc8', '#ff6ad5', '#9aa4ff', '#f0f0f0'];
const role = (m: string): string => /eye/i.test(m) ? (/black|pupil/i.test(m) ? 'eye·pupil' : /white|sclera/i.test(m) ? 'eye·sclera' : 'eye·?') : /glow/i.test(m) ? 'glow' : /^KEEP-/.test(m) ? 'kept' : /primary/i.test(m) ? 'coat A' : /secondary/i.test(m) ? 'coat B' : 'RANDOM coat';

const CELL = 260, COLS = rigName ? times.length : 6;
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
    const gltf = await loader.loadAsync(r.url);
    const root = gltf.scene;
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
    if (rigName === 'seahorse') {
      // The tank's frame: nose +z (the tank yaws the model so), up +y.
      const group = new Group(); const body = root;
      body.rotation.y = swimX ? Math.PI / 2 : 0;
      group.add(body);
      body.traverse((o) => { const m = o as Mesh; if (m.isMesh) for (const mat of Array.isArray(m.material) ? m.material : [m.material]) mat.userData.mqOwned = true; });
      const rig = rigSeahorse(group, body, 0.4);
      const scene = stage(group);
      const cam = new PerspectiveCamera(30, 1, span * 0.05, span * 20);
      times.forEach((t, c) => {
        rig?.set({ phase: 0, amp: 0.08 * Number(q.get('effort') ?? 1), bend: 0, t });
        // side (default), or ¾ from behind-left where the fin's sideways ripple shows.
        if (q.get('view') === '34') cam.position.set(span * 1.7, span * 0.35, -span * 1.7);
        else if (q.get('view') === 'top') cam.position.set(0, span * 2.2, span * 0.01);
        else cam.position.set(span * 2.4, 0, 0);
        cam.lookAt(0, 0, 0);
        const x = c * CELL, y = (rows.length - 1 - row) * CELL;
        renderer.setViewport(x, y, CELL, CELL); renderer.setScissor(x, y, CELL, CELL);
        renderer.render(scene, cam);
        const lab = document.createElement('div'); lab.className = 'label';
        lab.style.left = `${x + 4}px`; lab.style.top = `${row * CELL + 4}px`;
        lab.textContent = c === 0 ? `${r.label}  t=${t}s` : `t=${t}s`;
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
    lab.innerHTML = `<b>${esc(r.label)}</b>  ${Math.round(tris)} tris  swim ${swimX ? 'x' : 'z'}  size ${size.toArray().map((v) => v.toFixed(1)).join('×')}`;
    const leg = document.createElement('div'); leg.className = 'label';
    leg.style.left = `${3 * CELL + 4}px`; leg.style.top = `${row * CELL + 4}px`;
    leg.innerHTML = matNames.map((n, i) => `<span class="sw" style="background:${FALSE[i % FALSE.length]}"></span>${esc(n)} → ${role(n)} (${Math.round(mats.get(n)!)})`).join('\n');
    sheet.append(lab, leg);
    row += 1;
  }
  document.body.dataset.ready = '1';
})();
