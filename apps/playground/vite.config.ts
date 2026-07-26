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

/**
 * Fail the build if a secret ever reaches the output.
 *
 * `define` performs literal text substitution, so anything inlined lands in the
 * emitted JS verbatim — and this app auto-deploys to GitHub Pages on push to
 * main. A developer with OPENROUTER_API_KEY exported in their shell running
 * `pnpm build` would publish their key to a public URL. The dev-only gate below
 * is the fix; this plugin is the seatbelt, because a future `define` could
 * reintroduce the same leak silently.
 */
const forbidSecretsInBundle = (): import('vite').Plugin => ({
  name: 'forbid-secrets-in-bundle',
  apply: 'build',
  generateBundle(_opts, bundle) {
    const SECRET = /\bsk-(?:or-v1|ant|proj|live)-[A-Za-z0-9_-]{8,}/;
    for (const [file, chunk] of Object.entries(bundle)) {
      const text = chunk.type === 'chunk' ? chunk.code : String(chunk.source ?? '');
      const hit = SECRET.exec(text);
      if (hit) {
        throw new Error(
          `Refusing to emit ${file}: it contains what looks like an API key ` +
            `(${hit[0].slice(0, 12)}…). Secrets must never be inlined into a ` +
            `client bundle — this app deploys publicly.`,
        );
      }
    }
  },
});

export default defineConfig(({ mode, command }) => {
  // Seed the Evals OpenRouter connection from the environment, for local dev
  // convenience only. A key saved in Settings always wins over it.
  //
  // DEV SERVER ONLY. `define` inlines the value verbatim into the emitted JS,
  // and `pnpm build` output is published to GitHub Pages — so inlining it at
  // build time would put the key on a public URL. Reading it during `serve`
  // keeps it on localhost, which is the same trust boundary as localStorage.
  const envOpenRouterKey =
    command === 'serve'
      ? (process.env.OPENROUTER_API_KEY ??
         loadEnv(mode, process.cwd(), 'OPENROUTER_').OPENROUTER_API_KEY ??
         '')
      : '';
  return {
  plugins: [forbidSecretsInBundle()],
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
      '@idle-screens/saver-catwalk': src('saver-catwalk'),
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
