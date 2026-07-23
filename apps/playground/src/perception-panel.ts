import { perceiveScene, EXAMPLE_BY_ID, type SaverSpec, type ScenePerception } from '@idle-screens/schema';

export interface PerceptionHandle {
  setSaver(id: string, opts?: { width?: number; height?: number; seed?: number }): void;
  updateSpec(spec: SaverSpec): void;
  setTime(t: number): void;
  dispose(): void;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function speed(n: number): string {
  return n < 0.001 ? '0' : n.toFixed(3);
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}m ${(s % 60).toFixed(0)}s`;
}

export function buildPerceptionPanel(mount: HTMLElement): PerceptionHandle {
  mount.innerHTML = `
    <div class="perc-wrap">
      <div class="perc-empty">Select a schema saver to see perception data</div>
      <pre class="perc-braille" hidden></pre>
      <div class="perc-stats" hidden></div>
      <div class="perc-dominance" hidden></div>
      <div class="perc-motion" hidden></div>
      <div class="perc-advisories" hidden></div>
    </div>
  `;

  const empty = mount.querySelector('.perc-empty') as HTMLElement;
  const braillePre = mount.querySelector('.perc-braille') as HTMLPreElement;
  const statsDiv = mount.querySelector('.perc-stats') as HTMLElement;
  const domDiv = mount.querySelector('.perc-dominance') as HTMLElement;
  const motionDiv = mount.querySelector('.perc-motion') as HTMLElement;
  const advDiv = mount.querySelector('.perc-advisories') as HTMLElement;

  let currentId: string | null = null;
  let currentOpts: { width?: number; height?: number; seed?: number } = {};
  let lastT = 0;
  let overrideSpec: SaverSpec | null = null;

  const show = (p: ScenePerception): void => {
    empty.hidden = true;
    braillePre.hidden = false;
    statsDiv.hidden = false;
    domDiv.hidden = false;
    motionDiv.hidden = false;
    advDiv.hidden = false;

    braillePre.textContent = p.braille;

    statsDiv.innerHTML = [
      `<span class="perc-kv"><b>coverage</b> ${pct(p.coverage)}</span>`,
      `<span class="perc-kv"><b>luminance</b> ${p.meanLuminance.toFixed(3)}</span>`,
      p.centroid
        ? `<span class="perc-kv"><b>centroid</b> (${p.centroid.x.toFixed(2)}, ${p.centroid.y.toFixed(2)})</span>`
        : `<span class="perc-kv"><b>centroid</b> none</span>`,
      `<span class="perc-kv"><b>t</b> ${fmtMs(p.t)}</span>`,
    ].join('');

    // Dominance bars
    const maxShare = Math.max(...p.dominance.map((d) => d.share), 0.01);
    domDiv.innerHTML =
      '<div class="perc-section-label">dominance</div>' +
      p.dominance
        .filter((d) => d.share > 0.001)
        .map(
          (d) =>
            `<div class="perc-bar-row">` +
            `<span class="perc-bar-label">${esc(d.key ?? `layer-${d.layerIndex}`)}</span>` +
            `<div class="perc-bar-track"><div class="perc-bar-fill" style="width:${((d.share / maxShare) * 100).toFixed(1)}%"></div></div>` +
            `<span class="perc-bar-val">${pct(d.share)}</span>` +
            `</div>`,
        )
        .join('');

    // Motion table
    motionDiv.innerHTML =
      '<div class="perc-section-label">motion (vp/sec)</div>' +
      '<table class="perc-table"><tr><th></th><th>mean</th><th>max</th></tr>' +
      p.motion
        .filter((m) => m.meanSpeed > 0 || m.maxSpeed > 0)
        .map(
          (m) =>
            `<tr><td>${esc(m.key ?? `layer-${m.layerIndex}`)}</td><td>${speed(m.meanSpeed)}</td><td>${speed(m.maxSpeed)}</td></tr>`,
        )
        .join('') +
      '</table>';

    // Advisories
    if (p.advisories.length) {
      advDiv.innerHTML =
        '<div class="perc-section-label">advisories</div>' +
        p.advisories.map((a) => `<span class="perc-adv">${esc(a.code)}</span>`).join('');
    } else {
      advDiv.innerHTML = '<div class="perc-section-label">advisories</div><span class="perc-ok">none</span>';
    }
  };

  const hide = (): void => {
    empty.hidden = false;
    braillePre.hidden = true;
    statsDiv.hidden = true;
    domDiv.hidden = true;
    motionDiv.hidden = true;
    advDiv.hidden = true;
  };

  const perceiveAt = (t: number): void => {
    if (!currentId) return;
    const spec = overrideSpec ?? EXAMPLE_BY_ID[currentId] as SaverSpec | undefined;
    if (!spec) { hide(); return; }
    try {
      const p = perceiveScene(spec, {
        t,
        viewport: currentOpts.width && currentOpts.height
          ? { width: currentOpts.width, height: currentOpts.height }
          : undefined,
        seed: spec.seed ?? currentOpts.seed,
      });
      show(p);
    } catch {
      hide();
    }
  };

  return {
    setSaver(id: string, opts: { width?: number; height?: number; seed?: number } = {}) {
      currentId = id;
      currentOpts = opts;
      overrideSpec = null;
      lastT = 0;
      const spec = EXAMPLE_BY_ID[id] as SaverSpec | undefined;
      if (!spec) {
        currentId = null;
        hide();
        return;
      }
      perceiveAt(lastT);
    },

    updateSpec(spec: SaverSpec) {
      overrideSpec = spec;
      perceiveAt(lastT);
    },

    setTime(t: number) {
      lastT = t;
      if (currentId) perceiveAt(t);
    },

    dispose() {
      mount.innerHTML = '';
    },
  };
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
