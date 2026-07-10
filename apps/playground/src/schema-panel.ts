import { createRng, type SaverInstance } from '@idle-screens/core';
import { AQUARIUM_SPEC, DASHBOARD_SPEC, LANTERNS_SPEC, RAIN_SPEC, SAKURA_SPEC, SNOWFALL_SPEC, compileSaver, validateSpec, type SaverSpec } from '@idle-screens/schema';
import { sampleSaver, type ValidateResult } from './validate';

declare global {
  interface Window {
    __schema?: {
      validate(json: string): { valid: boolean; errors: { path: string; message: string }[] };
      sample(json: string): Promise<ValidateResult>;
      examples: Record<string, string>;
    };
  }
}

const pretty = (s: SaverSpec): string => JSON.stringify(s, null, 2);

export function buildSchemaPanel(mount: HTMLElement): void {
  const section = document.createElement('section');
  section.className = 'card schema';
  section.innerHTML = `
    <h2>Declarative savers — author by data</h2>
    <p class="lead">A saver as validated JSON, compiled by <code>@idle-screens/schema</code> into a
      seeded, flash-safe SaverPlugin. Edit the spec and preview it live — this is the agent-authorable
      surface: an agent writes <em>data</em>, not code, and it can't produce a strobe by construction.</p>
    <div class="schema-controls">
      <button id="schema-run">Compile &amp; preview</button>
      <button id="schema-ex-aquarium">Load aquarium</button>
      <button id="schema-ex-rain">Load rain</button>
      <button id="schema-ex-snowfall">Load snowfall</button>
      <button id="schema-ex-lanterns">Load lanterns</button>
      <button id="schema-ex-sakura">Load sakura</button>
      <button id="schema-ex-dashboard">Load dashboard</button>
      <span id="schema-status" class="verdict">…</span>
    </div>
    <div class="schema-cols">
      <div class="schema-edit">
        <textarea id="schema-json" spellcheck="false"></textarea>
        <div id="schema-errors" class="schema-errors"></div>
      </div>
      <div class="schema-preview"><div id="schema-host"></div></div>
    </div>`;
  mount.append(section);

  const $ = <T extends HTMLElement>(id: string): T => section.querySelector('#' + id) as T;
  const ta = $<HTMLTextAreaElement>('schema-json');
  const host = $<HTMLDivElement>('schema-host');
  const status = $<HTMLElement>('schema-status');
  const errorsEl = $<HTMLDivElement>('schema-errors');
  ta.value = pretty(AQUARIUM_SPEC);

  let inst: SaverInstance | null = null;

  const parse = (): { ok: true; spec: unknown } | { ok: false; err: string } => {
    try {
      return { ok: true, spec: JSON.parse(ta.value) };
    } catch (e) {
      return { ok: false, err: `invalid JSON: ${(e as Error).message}` };
    }
  };

  const showErrors = (lines: string[]): void => {
    errorsEl.textContent = '';
    for (const l of lines) {
      const div = document.createElement('div');
      div.textContent = `• ${l}`;
      errorsEl.appendChild(div);
    }
  };
  const setStatus = (ok: boolean, label: string): void => {
    status.className = 'verdict ' + (ok ? 'same' : 'diff');
    status.textContent = '● ' + label;
  };

  const validateOnly = (): unknown | null => {
    const p = parse();
    if (!p.ok) {
      setStatus(false, 'invalid JSON');
      showErrors([p.err]);
      return null;
    }
    const r = validateSpec(p.spec);
    if (!r.valid) {
      setStatus(false, `${r.errors.length} validation error(s)`);
      showErrors(r.errors.map((e) => `${e.path || '<root>'}: ${e.message}`));
      return null;
    }
    setStatus(true, 'valid — flash-safe by construction');
    showErrors([]);
    return p.spec;
  };

  const run = (): void => {
    const spec = validateOnly();
    if (!spec) return;
    if (inst) {
      inst.dispose();
      inst = null;
    }
    host.replaceChildren();
    const rect = host.getBoundingClientRect();
    const seed = (spec as SaverSpec).seed ?? 1;
    void Promise.resolve(
      compileSaver(spec).mount({
        host,
        dpr: devicePixelRatio ?? 1,
        width: Math.round(rect.width) || 420,
        height: Math.round(rect.height) || 260,
        rng: createRng(seed),
        seed,
        reducedMotion: false,
      }),
    ).then((i) => {
      inst = i;
    });
  };

  ta.addEventListener('input', () => validateOnly());
  $<HTMLButtonElement>('schema-run').addEventListener('click', run);
  $<HTMLButtonElement>('schema-ex-aquarium').addEventListener('click', () => {
    ta.value = pretty(AQUARIUM_SPEC);
    run();
  });
  $<HTMLButtonElement>('schema-ex-rain').addEventListener('click', () => {
    ta.value = pretty(RAIN_SPEC);
    run();
  });
  $<HTMLButtonElement>('schema-ex-snowfall').addEventListener('click', () => {
    ta.value = pretty(SNOWFALL_SPEC);
    run();
  });
  $<HTMLButtonElement>('schema-ex-lanterns').addEventListener('click', () => {
    ta.value = pretty(LANTERNS_SPEC);
    run();
  });
  $<HTMLButtonElement>('schema-ex-sakura').addEventListener('click', () => {
    ta.value = pretty(SAKURA_SPEC);
    run();
  });
  $<HTMLButtonElement>('schema-ex-dashboard').addEventListener('click', () => {
    ta.value = pretty(DASHBOARD_SPEC);
    run();
  });

  window.__schema = {
    validate: (json: string) => validateSpec(JSON.parse(json)),
    sample: (json: string) => sampleSaver(compileSaver(JSON.parse(json)), { seconds: 1.5 }),
    examples: { aquarium: pretty(AQUARIUM_SPEC), rain: pretty(RAIN_SPEC), snowfall: pretty(SNOWFALL_SPEC), lanterns: pretty(LANTERNS_SPEC), sakura: pretty(SAKURA_SPEC), dashboard: pretty(DASHBOARD_SPEC) },
  };

  run();
}
