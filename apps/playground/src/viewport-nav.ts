/**
 * Viewport navigation — orbit, dolly, an axis gizmo and Reset view, for any
 * saver with a camera. Mouse only, like an OrbitControls viewport.
 *
 * A saver opts in by declaring the camera rig in its paramSpace:
 * `cameraAzimuth`, `cameraElevation`, `cameraDistance` (and optionally
 * `autoRotate`). Nothing here knows about three.js or metaquarium — the rig IS
 * the params, so the next 3D saver gets this by using the same names.
 *
 * It is FREE LOOK: the values ride the timeline's view override, so looking
 * around never writes a keyframe and never stops playback. Reset view (or a
 * double-click) hands the viewport back to the scene's own camera.
 *
 * No pan: the rig has no target param — the tank always looks at its centre,
 * and faking one would show a view a wall can never have.
 */

import { sampleTrack, type ParamSpace, type ParamValue, type SaverPlugin } from '@idle-screens/core';
import type { TimelineHandle } from './timeline-panel';

const RIG = ['cameraAzimuth', 'cameraElevation', 'cameraDistance'] as const;
type RigKey = (typeof RIG)[number];
type View = Record<RigKey, number>;

export interface ViewportNavHandle {
  select(saver: SaverPlugin): void;
  /** Repaint from the scene camera — for the host to call when the timeline
   *  moves or the track changes. A no-op in free look, where the view is pinned. */
  refresh(): void;
}

const SVG = 'http://www.w3.org/2000/svg';

export function buildViewportNav(
  surface: HTMLElement,
  chrome: HTMLElement,
  timeline: TimelineHandle,
  onViewChange: () => void,
): ViewportNavHandle {
  let space: ParamSpace | null = null;
  /** null = the scene camera is driving; a View = free look. */
  let free: View | null = null;

  // ---- chrome -------------------------------------------------------------
  const root = document.createElement('div');
  root.className = 'vp-nav';
  root.hidden = true;

  const hud = document.createElement('div');
  hud.className = 'vp-hud';
  const title = document.createElement('span');
  title.className = 'vp-hud-title';
  const readout = document.createElement('span');
  readout.className = 'vp-hud-readout';
  hud.append(title, readout);

  const gizmo = document.createElementNS(SVG, 'svg');
  gizmo.setAttribute('viewBox', '-50 -50 100 100');
  gizmo.setAttribute('class', 'vp-gizmo');
  gizmo.setAttribute('role', 'group');
  gizmo.setAttribute('aria-label', 'View axes — click an axis to look down it');

  const bar = document.createElement('div');
  bar.className = 'vp-bar';
  const button = (label: string, tip: string, run: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'vp-btn';
    b.textContent = label;
    b.title = tip;
    b.addEventListener('click', (e) => { e.stopPropagation(); run(); });
    bar.append(b);
    return b;
  };

  root.append(hud, gizmo, bar);
  chrome.append(root);

  // ---- rig ---------------------------------------------------------------
  const def = (k: RigKey): { min: number; max: number; default: number } => {
    const d = space?.[k];
    return {
      min: typeof d?.min === 'number' ? d.min : -Infinity,
      max: typeof d?.max === 'number' ? d.max : Infinity,
      default: typeof d?.default === 'number' ? d.default : 0,
    };
  };
  const clamp = (k: RigKey, v: number): number => Math.min(def(k).max, Math.max(def(k).min, v));
  /** The rig's highest (+1) or lowest (−1) elevation: the manifest's bound, or
   *  just short of the pole when it declares none — the Y axis must land on a
   *  finite angle, and 90° would fold the view basis flat. */
  const pole = (sign: 1 | -1): number => {
    const bound = sign > 0 ? def('cameraElevation').max : def('cameraElevation').min;
    return Number.isFinite(bound) ? bound : sign * 89;
  };

  /** Where the SCENE's camera is right now, from the authored track. */
  const sceneView = (): View => {
    const track = timeline.getTrack();
    const values: Record<string, ParamValue | undefined> = space && track
      ? sampleTrack(space, track, timeline.currentTime())
      : {};
    const num = (k: RigKey): number => {
      const v = values[k];
      return typeof v === 'number' ? v : def(k).default;
    };
    return { cameraAzimuth: num('cameraAzimuth'), cameraElevation: num('cameraElevation'), cameraDistance: num('cameraDistance') };
  };
  const current = (): View => free ?? sceneView();

  const apply = (next: View | null): void => {
    free = next && {
      cameraAzimuth: ((next.cameraAzimuth % 360) + 360) % 360,
      cameraElevation: clamp('cameraElevation', next.cameraElevation),
      cameraDistance: clamp('cameraDistance', next.cameraDistance),
    };
    // Free look also stills the turntable, or the view drifts out from under
    // the hand that is holding it.
    timeline.setViewOverride(free ? { ...free, ...(space?.autoRotate ? { autoRotate: 0 } : {}) } : null);
    paint();
    onViewChange();
  };
  const nudge = (d: Partial<View>): void => {
    const v = current();
    apply({
      cameraAzimuth: v.cameraAzimuth + (d.cameraAzimuth ?? 0),
      cameraElevation: v.cameraElevation + (d.cameraElevation ?? 0),
      cameraDistance: v.cameraDistance * (d.cameraDistance ?? 1),
    });
  };
  const look = (az: number, el: number): void => apply({ ...current(), cameraAzimuth: az, cameraElevation: el });

  const resetBtn = button('Reset view', 'Back to the scene’s own camera (or double-click the viewport)', () => apply(null));

  // ---- paint ----------------------------------------------------------------
  const NAMED: ReadonlyArray<readonly [string, number, number]> = [
    ['Front', 0, 0], ['Right', 90, 0], ['Back', 180, 0], ['Left', 270, 0],
  ];
  /** What the chrome last painted; the timeline calls refresh() every frame. */
  let painted = '';
  const paint = (): void => {
    const v = current();
    const key = `${free ? 'free' : 'scene'}|${v.cameraAzimuth}|${v.cameraElevation}|${v.cameraDistance}`;
    if (key === painted) return;
    painted = key;
    const top = v.cameraElevation >= pole(1) - 0.5;
    const named = top ? 'Top'
      : NAMED.find(([, az, el]) => Math.abs(v.cameraAzimuth - az) < 0.5 && Math.abs(v.cameraElevation - el) < 0.5)?.[0];
    title.textContent = `${named ?? 'User'} Perspective`;
    hud.hidden = !free;
    readout.textContent = `az ${v.cameraAzimuth.toFixed(0)}°  el ${v.cameraElevation.toFixed(0)}°  d ${v.cameraDistance.toFixed(0)}`;
    root.classList.toggle('free', !!free);
    resetBtn.hidden = !free;

    // Axis gizmo: project the world axes through the rig's own view basis.
    const az = (v.cameraAzimuth * Math.PI) / 180;
    const el = (v.cameraElevation * Math.PI) / 180;
    const right = [Math.cos(az), 0, -Math.sin(az)];
    const up = [-Math.sin(el) * Math.sin(az), Math.cos(el), -Math.sin(el) * Math.cos(az)];
    const toCam = [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
    const axes: Array<{ name: string; v: number[]; color: string; az: number; el: number }> = [
      { name: 'X', v: [1, 0, 0], color: '#ff5468', az: 90, el: 0 },
      { name: 'Y', v: [0, 1, 0], color: '#8fd437', az: NaN, el: pole(1) },
      { name: 'Z', v: [0, 0, 1], color: '#4d9fff', az: 0, el: 0 },
    ];
    const dot = (a: number[], b: number[]): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
    const ends = axes.flatMap((a) => [1, -1].map((sign) => {
      const w = a.v.map((c) => c * sign);
      return { ...a, sign, x: dot(w, right) * 34, y: -dot(w, up) * 34, depth: dot(w, toCam) };
    })).sort((p, q) => p.depth - q.depth);
    gizmo.replaceChildren();
    for (const e of ends) {
      if (e.sign > 0) {
        const line = document.createElementNS(SVG, 'line');
        line.setAttribute('x1', '0'); line.setAttribute('y1', '0');
        line.setAttribute('x2', String(e.x)); line.setAttribute('y2', String(e.y));
        line.setAttribute('stroke', e.color); line.setAttribute('stroke-width', '2.5');
        gizmo.append(line);
      }
      const g = document.createElementNS(SVG, 'g');
      g.setAttribute('class', 'vp-gizmo-end');
      const c = document.createElementNS(SVG, 'circle');
      c.setAttribute('cx', String(e.x)); c.setAttribute('cy', String(e.y)); c.setAttribute('r', '9');
      c.setAttribute('fill', e.sign > 0 ? e.color : 'rgba(20,22,28,.85)');
      c.setAttribute('stroke', e.color); c.setAttribute('stroke-width', '1.6');
      c.setAttribute('opacity', String(0.55 + 0.45 * (e.depth * 0.5 + 0.5)));
      g.append(c);
      if (e.sign > 0) {
        const t = document.createElementNS(SVG, 'text');
        t.setAttribute('x', String(e.x)); t.setAttribute('y', String(e.y + 3.4));
        t.setAttribute('text-anchor', 'middle'); t.textContent = e.name;
        g.append(t);
      }
      const label = document.createElementNS(SVG, 'title');
      label.textContent = `Look down ${e.sign > 0 ? '+' : '−'}${e.name}`;
      g.append(label);
      g.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (e.name === 'Y') {
          // The rig cannot go under the floor: −Y is the lowest it allows.
          look(current().cameraAzimuth, pole(e.sign > 0 ? 1 : -1));
        } else {
          look((e.az + (e.sign > 0 ? 0 : 180)) % 360, 0);
        }
      });
      gizmo.append(g);
    }
  };

  // ---- input ------------------------------------------------------------------
  let drag: { x: number; y: number; id: number } | null = null;
  surface.addEventListener('pointerdown', (e) => {
    if (!space || (e.button !== 0 && e.button !== 1)) return;
    e.preventDefault();
    drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
    surface.setPointerCapture(e.pointerId);
    surface.classList.add('vp-orbiting');
  });
  surface.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY;
    // Turntable, like Blender's default: drag right and the scene turns right.
    nudge({ cameraAzimuth: -dx * 0.35, cameraElevation: dy * 0.25 });
  });
  const endDrag = (e: PointerEvent): void => {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    surface.classList.remove('vp-orbiting');
  };
  surface.addEventListener('pointerup', endDrag);
  surface.addEventListener('pointercancel', endDrag);
  surface.addEventListener('auxclick', (e) => { if (space && e.button === 1) e.preventDefault(); });
  surface.addEventListener('wheel', (e) => {
    if (!space) return;
    e.preventDefault();
    // ctrlKey is how a trackpad pinch arrives; it carries small deltas.
    nudge({ cameraDistance: Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)) });
  }, { passive: false });

  surface.addEventListener('dblclick', () => { if (space && free) apply(null); });

  return {
    select(saver) {
      const ps = saver.manifest.paramSpace as ParamSpace | undefined;
      space = ps && RIG.every((k) => ps[k]?.type === 'number') ? ps : null;
      free = null;
      painted = '';
      timeline.setViewOverride(null);
      root.hidden = !space;
      surface.classList.toggle('vp-navigable', !!space);
      if (space) paint();
    },
    refresh() {
      if (space && !free) paint();
    },
  };
}
