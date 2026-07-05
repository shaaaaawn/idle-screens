import type { SaverPlugin } from '@idle-screens/core';
import {
  detectCapabilities,
  computeTier,
  costBudget,
  eligibleSavers,
  type Capabilities,
  type SaverEligibility,
  type SaverInfo,
} from '@idle-screens/capabilities';

type Sim = 'real' | 'minimal' | 'lowpower';

const toInfo = (s: SaverPlugin): SaverInfo => ({
  id: s.manifest.id,
  minBackend: s.manifest.minBackend,
  costTier: s.manifest.costTier,
  motionIntensity: s.manifest.motionIntensity,
  reducedMotionFallback: s.manifest.reducedMotionFallback,
});

const yn = (b: boolean | undefined): string =>
  b === undefined ? '<span style="opacity:.5">unknown</span>' : b ? '✓' : '✗';

export interface CapabilitiesHandle {
  getResults(): SaverEligibility[];
  onChange(cb: () => void): void;
}

export async function buildCapabilitiesPanel(
  savers: SaverPlugin[],
  mount: HTMLElement,
): Promise<CapabilitiesHandle> {
  const infos = savers.map(toInfo);
  const real = await detectCapabilities();

  let sim: Sim = 'real';
  let forceReduced = false;
  let lastResults: SaverEligibility[] = [];
  const listeners: Array<() => void> = [];

  const effective = (): Capabilities => {
    let caps: Capabilities;
    if (sim === 'minimal') {
      caps = { backends: { css: true, canvas2d: false, webgl2: false, webgpu: false }, saveData: true };
    } else if (sim === 'lowpower') {
      caps = { ...real, saveData: true, deviceMemoryGb: 2, hardwareConcurrency: 2 };
    } else {
      caps = { ...real };
    }
    if (forceReduced) caps = { ...caps, reducedMotion: true };
    return caps;
  };

  (window as unknown as { __caps?: unknown }).__caps = {
    detect: () => detectCapabilities(),
    tier: (c: Capabilities) => computeTier(c),
    budget: (c: Capabilities) => costBudget(computeTier(c)),
    evaluate: (c: Capabilities) => eligibleSavers(infos, c),
    real: () => real,
  };

  const panel = document.createElement('aside');
  panel.className = 'config-panel';
  mount.append(panel);

  const row = (label: string, value: string): string =>
    `<div class="cap-line"><span>${label}</span><span>${value}</span></div>`;

  const render = (): void => {
    const caps = effective();
    const tier = computeTier(caps);
    const budget = costBudget(tier);
    lastResults = eligibleSavers(infos, caps);
    const okN = lastResults.filter((r) => r.status === 'ok').length;
    const degN = lastResults.filter((r) => r.status === 'degraded').length;
    const blkN = lastResults.filter((r) => r.status === 'blocked').length;

    panel.innerHTML = `
      <h3>Device</h3>
      ${row('Tier', `<strong id="cap-tier">${tier}</strong>`)}
      ${row('Budget', `<strong>${budget}</strong>`)}
      ${row('Playable', `<span id="cap-summary">${okN} ok · ${degN} degraded · ${blkN} blocked</span>`)}
      ${row('CSS', yn(caps.backends.css))}
      ${row('Canvas2D', yn(caps.backends.canvas2d))}
      ${row('WebGL2', yn(caps.backends.webgl2))}
      ${row('WebGPU', yn(caps.backends.webgpu))}
      ${row('Reduced motion', yn(caps.reducedMotion))}
      ${row('Save-data', yn(caps.saveData))}
      ${row('Memory', caps.deviceMemoryGb !== undefined ? `${caps.deviceMemoryGb} GB` : '<span style="opacity:.5">--</span>')}
      ${row('CPU cores', caps.hardwareConcurrency !== undefined ? String(caps.hardwareConcurrency) : '<span style="opacity:.5">--</span>')}
      <div class="field"><span>Simulate</span>
        <select id="cap-sim">
          <option value="real">Real device</option>
          <option value="minimal">Minimal (CSS only)</option>
          <option value="lowpower">Low-power</option>
        </select>
      </div>
      <div class="field"><span>Force reduced-motion</span><input type="checkbox" id="cap-reduced" /></div>`;

    const simSel = panel.querySelector('#cap-sim') as HTMLSelectElement;
    simSel.value = sim;
    simSel.addEventListener('change', () => {
      sim = simSel.value as Sim;
      render();
      listeners.forEach((cb) => cb());
    });
    const reducedCb = panel.querySelector('#cap-reduced') as HTMLInputElement;
    reducedCb.checked = forceReduced;
    reducedCb.addEventListener('change', () => {
      forceReduced = reducedCb.checked;
      render();
      listeners.forEach((cb) => cb());
    });
  };

  render();

  return {
    getResults: () => lastResults,
    onChange: (cb) => listeners.push(cb),
  };
}
