import { defineConfig, loadEnv } from 'vite';
import { evalHoldout } from './eval-holdout-plugin';
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

/**
 * Dev-only endpoint that writes a finished agent-eval run to disk.
 *
 * Agent runs cost real API calls and cannot be reproduced — the model behind a
 * given id drifts — yet they live in localStorage behind a 5-run cap that
 * silently evicts on quota. This gives them somewhere durable to land.
 *
 * The destination comes from IDLE_EVAL_SINK_DIR and there is no default: this
 * repo is public and published to npm-adjacent surfaces, so it must not carry a
 * hard-coded path into anyone's workspace. Unset means the plugin does nothing
 * and the client-side sink reports itself off.
 *
 * `apply: 'serve'` — never in a build, never in the deployed playground.
 */
const evalSink = (dir: string): import('vite').Plugin => ({
  name: 'eval-artifact-sink',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use('/__eval-sink', (req, res) => {
      if (req.method !== 'POST') {
        res.statusCode = 405;
        res.end();
        return;
      }
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        void (async () => {
          try {
            const { mkdir, writeFile } = await import('node:fs/promises');
            const { join, resolve, sep } = await import('node:path');
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
              runId?: string;
              evalId?: string;
              files?: Record<string, string>;
            };
            // runId and evalId land in a filesystem path, so they are treated
            // as untrusted: anything but [A-Za-z0-9._-] is replaced, which
            // takes `..` and separators out of play before they are joined.
            const safe = (s: string | undefined, fallback: string): string =>
              (s ?? '').replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 120) || fallback;
            const root = resolve(dir);
            const outDir = join(root, safe(body.evalId, 'unknown-eval'), safe(body.runId, 'run'));
            // Belt and braces: confirm the join stayed inside the sink root.
            if (outDir !== root && !outDir.startsWith(root + sep)) {
              res.statusCode = 400;
              res.end('path escapes sink root');
              return;
            }
            await mkdir(outDir, { recursive: true });
            for (const [name, text] of Object.entries(body.files ?? {})) {
              if (!/^[A-Za-z0-9._-]+$/.test(name)) continue;
              await writeFile(join(outDir, name), text, 'utf8');
            }
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true, path: outDir }));
          } catch (err) {
            res.statusCode = 500;
            res.end(String(err));
          }
        })();
      });
    });
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
  // Dev-server only, same reasoning as the key above: a build must not carry a
  // developer's local path, and the deployed playground has no filesystem.
  const sinkDir = command === 'serve' ? (process.env.IDLE_EVAL_SINK_DIR ?? '') : '';
  // Held-out fixtures are dev-only for the same reason, plus one more: a build
  // that could inline them would publish the thing they exist to keep private.
  const holdoutDir = command === 'serve' ? (process.env.IDLE_EVAL_HOLDOUT_DIR ?? '') : '';
  return {
  plugins: [forbidSecretsInBundle(), evalHoldout(holdoutDir), ...(sinkDir ? [evalSink(sinkDir)] : [])],
  base: process.env.GITHUB_ACTIONS ? '/idle-screens/' : '/',
  define: {
    __SCHEMA_PKG_VERSION__: JSON.stringify(schemaPkgVersion),
    __OPENROUTER_API_KEY__: JSON.stringify(envOpenRouterKey),
    // A flag, never the path — the path is a local detail the client has no
    // use for and a build must not inline.
    __EVAL_SINK__: JSON.stringify(sinkDir ? 'on' : ''),
  },
  server: {
    // PLAYGROUND_PORT lets parallel checkouts (worktrees, agents) run dev/e2e
    // without colliding on 5177 — playwright.config.ts reads the same variable.
    port: Number(process.env.PLAYGROUND_PORT ?? 5177),
    strictPort: true,
    // Metaquarium farm API allowlists Origins server-side (localhost is
    // rejected); the proxy wears the allowlisted Origin. Dev-only.
    proxy: {
      '/farm': {
        target: 'https://f0ag1g19u8.execute-api.us-west-1.amazonaws.com/production/backend',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/farm/, ''),
        headers: { Origin: 'https://metaquarium.xyz' },
      },
    },
  },
  preview: { port: 5177, strictPort: true },
  // The aliased-to-source packages import `@preact/signals-core`; pre-bundle it (it's a
  // direct dep of this app so it resolves) instead of letting Vite discover it mid-load,
  // which returns 504 "Outdated Optimize Dep" and breaks the first page load.
  // Same for three (+ the example modules the metaquarium tank uses): it's behind a
  // dynamic import, so without pre-bundling Vite discovers it mid-test and the cold
  // transform stalls every suite that mounts a saver.
  optimizeDeps: {
    include: [
      '@preact/signals-core',
      'three',
      'three/examples/jsm/loaders/GLTFLoader.js',
      'three/examples/jsm/utils/SkeletonUtils.js',
      'three/examples/jsm/postprocessing/EffectComposer.js',
      'three/examples/jsm/postprocessing/RenderPass.js',
      'three/examples/jsm/postprocessing/ShaderPass.js',
      'three/examples/jsm/postprocessing/UnrealBloomPass.js',
      'three/examples/jsm/postprocessing/OutputPass.js',
    ],
  },
  resolve: {
    alias: {
      '@idle-screens/core': src('core'),
      '@idle-screens/saver-black-hole': src('saver-black-hole'),
      '@idle-screens/saver-catwalk': src('saver-catwalk'),
      '@idle-screens/saver-limelight': src('saver-limelight'),
      '@idle-screens/saver-metaquarium': src('saver-metaquarium'),
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
