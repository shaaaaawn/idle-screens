import { defineConfig, loadEnv } from 'vite';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Eval runs record which @idle-screens/schema published the specs they scored:
// `perceiveScene` / `adviseSpec` semantics can shift between package versions
// at the SAME `schemaVersion: 1`, so the format number alone can't tell you
// whether two runs are comparable. The package's `exports` map has no
// `./package.json` entry, so read it here and inline it — playground-only, so
// no new export from packages/schema and therefore no changeset.
const schemaPkgVersion = (createRequire(import.meta.url)(
  '../../packages/schema/package.json',
) as { version: string }).version;

// Resolve the workspace packages to their SOURCE, not their built dist. By default Vite
// pre-bundles a linked package's `dist/` into its optimize cache and does NOT re-optimize
// on a dist-only change, so a running `pnpm dev` serves a STALE build after you rebuild a
// package (the "saver is old / black on sleep" trap) and even a restart may reuse the
// cache. Aliasing to src makes Vite serve + HMR the TypeScript directly, so the playground
// can never drift from the current source and no package rebuild is needed.
const src = (pkg: string): string =>
  fileURLToPath(new URL(`../../packages/${pkg}/src/index.ts`, import.meta.url));

export default defineConfig(({ mode }) => {
  // Seed the Evals OpenRouter connection from the environment (process env or
  // a local .env). A key the user saves in Settings always wins over this;
  // the env value is only the fallback. It is inlined into the client bundle —
  // same trust model as localStorage, so this stays a local-dev convenience.
  const envOpenRouterKey =
    process.env.OPENROUTER_API_KEY ??
    loadEnv(mode, process.cwd(), 'OPENROUTER_').OPENROUTER_API_KEY ??
    '';
  return {
  base: process.env.GITHUB_ACTIONS ? '/idle-screens/' : '/',
  define: {
    __SCHEMA_PKG_VERSION__: JSON.stringify(schemaPkgVersion),
    __OPENROUTER_API_KEY__: JSON.stringify(envOpenRouterKey),
  },
  server: { port: 5177, strictPort: true },
  preview: { port: 5177, strictPort: true },
  // The aliased-to-source packages import `@preact/signals-core`; pre-bundle it (it's a
  // direct dep of this app so it resolves) instead of letting Vite discover it mid-load,
  // which returns 504 "Outdated Optimize Dep" and breaks the first page load.
  optimizeDeps: { include: ['@preact/signals-core'] },
  resolve: {
    alias: {
      '@idle-screens/core': src('core'),
      '@idle-screens/saver-black-hole': src('saver-black-hole'),
      '@idle-screens/saver-limelight': src('saver-limelight'),
      '@idle-screens/saver-slipstream': src('saver-slipstream'),
      '@idle-screens/saver-tide': src('saver-tide'),
      '@idle-screens/savers-classic': src('savers-classic'),
      '@idle-screens/schema': src('schema'),
      '@idle-screens/validator': src('validator'),
      '@idle-screens/capabilities': src('capabilities'),
    },
  },
  };
});
