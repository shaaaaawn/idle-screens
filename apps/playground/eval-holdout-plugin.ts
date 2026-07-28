import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';

/**
 * Supplies the HELD-OUT style fixtures as `virtual:idle-eval-holdout`.
 *
 * The held-out suite only measures anything while its fixtures stay
 * unpublished, so the data must not live in this repo. It is read from
 * `IDLE_EVAL_HOLDOUT_DIR`; with no directory configured the module resolves to
 * `null` and the suite is simply absent. There is deliberately no default path.
 *
 * Shared by BOTH configs on purpose. `apps/playground/vite.config.ts` serves it
 * to the dev server, and the repo-root `vitest.config.ts` needs the identical
 * plugin because root `pnpm test` — what CI runs — does not read the app's vite
 * config. Without it, `holdout.ts` fails to resolve its import and the whole
 * test file errors out rather than skipping.
 */
export function evalHoldout(dir: string): Plugin {
  const ID = 'virtual:idle-eval-holdout';
  const RESOLVED = `\0${ID}`;
  return {
    name: 'eval-holdout',
    resolveId: (id) => (id === ID ? RESOLVED : null),
    load(id) {
      if (id !== RESOLVED) return null;
      if (!dir) return 'export default null;';
      const path = new URL('./house-styles.json', `file://${dir.replace(/\/?$/, '/')}`);
      let text: string;
      try {
        text = readFileSync(path, 'utf8');
      } catch {
        this.warn(
          `IDLE_EVAL_HOLDOUT_DIR is set but ${path.pathname} is unreadable — holdout suite disabled`,
        );
        return 'export default null;';
      }
      // Parse here so a malformed fixture file fails at load with a JSON error,
      // not deep inside the eval as a scoring anomaly.
      JSON.parse(text) as unknown;
      return `export default ${text};`;
    },
  };
}
