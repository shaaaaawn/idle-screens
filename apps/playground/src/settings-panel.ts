import { buildConnectionEditor, type ConnectionEditorHandle } from './evals/connection-editor';
import { cachedModels, type OpenRouterModel } from './evals/openrouter';
import { getRunDefaults, setRunDefaults } from './evals/run-defaults';

export interface SettingsPanelHandle {
  dispose(): void;
}

/**
 * Playground settings — everything here persists to localStorage on this
 * origin; there is no server. The OpenRouter key editor is the same component
 * the run dialog embeds, so saving behaves identically in both places.
 */
export function buildSettingsPanel(mount: HTMLElement): SettingsPanelHandle {
  mount.innerHTML = `
    <div class="settings-shell">
      <header class="settings-head">
        <h1 class="settings-title">Settings</h1>
        <p class="settings-sub">
          Saved in this browser only (localStorage, this origin) — nothing here
          is sent anywhere except OpenRouter itself, and only when you ask.
        </p>
      </header>

      <section class="settings-section">
        <h2 class="settings-section-title">OpenRouter connection</h2>
        <p class="settings-section-sub">
          Used by the Evals run dialog to keep model names canonical and comparable across runs.
        </p>
        <p class="settings-conn-state" data-role="conn-state"></p>
        <div data-role="connection"></div>
      </section>

      <section class="settings-section">
        <h2 class="settings-section-title">Run defaults</h2>
        <p class="settings-section-sub">
          Prefilled into every New eval run dialog — set once here instead of per run.
        </p>
        <div class="settings-defaults">
          <label class="evals-field">Operator
            <input data-role="def-operator" placeholder="your name or agent id" />
          </label>
          <label class="evals-field">Model
            <input data-role="def-model" list="settings-model-list" autocomplete="off" spellcheck="false"
                   placeholder="type to search OpenRouter models" />
            <datalist id="settings-model-list"></datalist>
          </label>
        </div>
        <p class="settings-saved" data-role="def-msg" aria-live="polite"></p>
      </section>
    </div>
  `;

  const connState = mount.querySelector<HTMLElement>('[data-role="conn-state"]')!;
  const datalist = mount.querySelector<HTMLDataListElement>('#settings-model-list')!;
  const operatorInput = mount.querySelector<HTMLInputElement>('[data-role="def-operator"]')!;
  const modelInput = mount.querySelector<HTMLInputElement>('[data-role="def-model"]')!;
  const defMsg = mount.querySelector<HTMLElement>('[data-role="def-msg"]')!;

  const paintModels = (models: OpenRouterModel[]): void => {
    datalist.replaceChildren(
      ...models.map((m) => {
        const o = document.createElement('option');
        o.value = m.id;
        o.label = m.contextLength ? `${m.name} · ${Math.round(m.contextLength / 1000)}k ctx` : m.name;
        return o;
      }),
    );
  };

  const editor: ConnectionEditorHandle = buildConnectionEditor(
    mount.querySelector<HTMLElement>('[data-role="connection"]')!,
    {
      onModels: paintModels,
      onKeyChange: (source) => {
        connState.textContent =
          source === 'stored'
            ? 'A key is stored in this browser.'
            : source === 'env'
              ? 'Using OPENROUTER_API_KEY from the environment.'
              : 'No key stored yet.';
        connState.classList.toggle('is-set', source !== null);
      },
    },
  );
  paintModels(cachedModels());

  const defaults = getRunDefaults();
  operatorInput.value = defaults.operator ?? '';
  modelInput.value = defaults.model ?? '';

  let savedTimer: ReturnType<typeof setTimeout> | undefined;
  const saveDefaults = (): void => {
    setRunDefaults({ operator: operatorInput.value, model: modelInput.value });
    defMsg.textContent = 'Saved ✓';
    if (savedTimer) clearTimeout(savedTimer);
    savedTimer = setTimeout(() => {
      defMsg.textContent = '';
    }, 1600);
  };
  operatorInput.addEventListener('change', saveDefaults);
  modelInput.addEventListener('change', saveDefaults);

  return {
    dispose(): void {
      if (savedTimer) clearTimeout(savedTimer);
      editor.dispose();
      mount.replaceChildren();
    },
  };
}
