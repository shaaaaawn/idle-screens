import {
  cachedModels,
  clearKey,
  fetchModels,
  keySource,
  maskKey,
  setKey,
  verifyKey,
  type KeySource,
  type OpenRouterModel,
} from './openrouter';

export interface ConnectionEditorHandle {
  /** Repaint the stored-key state (masked label, input placeholder). */
  sync(): void;
  dispose(): void;
}

export interface ConnectionEditorOptions {
  /**
   * Fired after the model catalogue is (re)loaded — initial best-effort fetch
   * and manual Refresh both report here. The run dialog uses it to refill its
   * model datalist; the settings page uses it for its defaults datalist.
   */
  onModels?: (models: OpenRouterModel[]) => void;
  /** Fired whenever the active key changes (save/clear/env fallback). */
  onKeyChange?: (source: KeySource) => void;
}

/**
 * The OpenRouter key editor, shared by the run dialog and the settings page.
 *
 * Security shape — same contract as openrouter.ts, kept visible here because
 * this is the only UI that ever touches the key:
 *  - The input has NO name attribute and this component never reads it into
 *    any form/FormData, so the key cannot leak into RunRequest, provenance,
 *    or an exported training example.
 *  - The key goes to localStorage (this origin) and nowhere else; it is only
 *    transmitted when the user explicitly presses Verify.
 *  - What renders afterwards is always the mask (`sk-or-v1-…a91f`), never the
 *    value.
 */
export function buildConnectionEditor(
  mount: HTMLElement,
  opts: ConnectionEditorOptions = {},
): ConnectionEditorHandle {
  mount.innerHTML = `
    <div class="evals-conn-editor">
      <label class="evals-field">API key
        <!-- Deliberately no name= : nothing form-adjacent may ever carry the key. -->
        <input type="password" autocomplete="off" spellcheck="false"
               data-role="or-key" placeholder="sk-or-v1-…" />
      </label>
      <div class="evals-conn-actions">
        <button type="button" class="evals-btn secondary" data-act="key-save">Save key</button>
        <button type="button" class="evals-btn secondary" data-act="key-verify">Verify</button>
        <button type="button" class="evals-btn secondary" data-act="key-clear">Clear</button>
        <button type="button" class="evals-btn secondary" data-act="models-refresh">Refresh models</button>
      </div>
      <p class="evals-conn-note">
        Stored in this browser only (localStorage, this origin) — there is no server here.
        Browsing models sends no credential; the key is transmitted only when you press Verify,
        and never enters run provenance or an exported example. Any script on this origin can
        read localStorage, so treat it like any other browser-stored token.
      </p>
      <p class="evals-conn-msg" data-role="conn-msg"></p>
    </div>
  `;

  const keyInput = mount.querySelector<HTMLInputElement>('[data-role="or-key"]')!;
  const msg = mount.querySelector<HTMLElement>('[data-role="conn-msg"]')!;

  const sync = (): void => {
    const source = keySource();
    keyInput.value = '';
    keyInput.placeholder =
      source === 'stored'
        ? `stored · ${maskKey()} — type a new key to replace`
        : source === 'env'
          ? `env · ${maskKey()} — type a key to override`
          : 'sk-or-v1-…';
    opts.onKeyChange?.(source);
  };

  const reportModels = (models: OpenRouterModel[]): void => {
    opts.onModels?.(models);
  };

  sync();
  reportModels(cachedModels());

  // Best-effort refresh; a failure leaves the cached list in place.
  void fetchModels().then(reportModels).catch(() => { /* cached list stands */ });

  const onClick = (e: Event): void => {
    const act = (e.target as HTMLElement).closest('[data-act]')?.getAttribute('data-act');
    if (act === 'key-save') {
      const v = keyInput.value.trim();
      if (!v) {
        msg.textContent = 'Nothing to save — the field is empty.';
        return;
      }
      setKey(v);
      sync();
      msg.textContent = 'Saved to this browser. Press Verify to check it with OpenRouter.';
      msg.classList.remove('is-bad');
    } else if (act === 'key-verify') {
      msg.textContent = 'Verifying…';
      void verifyKey(keyInput.value.trim() || undefined).then((s) => {
        msg.textContent = s.label ? `${s.message} (${s.label})` : s.message;
        msg.classList.toggle('is-bad', !s.ok);
      });
    } else if (act === 'key-clear') {
      clearKey();
      sync();
      msg.textContent = 'Key removed from this browser.';
      msg.classList.remove('is-bad');
    } else if (act === 'models-refresh') {
      msg.textContent = 'Fetching models…';
      void fetchModels({ force: true })
        .then((m) => {
          reportModels(m);
          msg.textContent = `Loaded ${m.length} models.`;
          msg.classList.remove('is-bad');
        })
        .catch((err: unknown) => {
          msg.textContent = `Model fetch failed: ${err instanceof Error ? err.message : String(err)}`;
          msg.classList.add('is-bad');
        });
    }
  };
  mount.addEventListener('click', onClick);

  return {
    sync,
    dispose(): void {
      mount.removeEventListener('click', onClick);
      mount.replaceChildren();
    },
  };
}
