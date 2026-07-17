import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Resolve the workspace packages to their SOURCE, not their built dist. By default Vite
// pre-bundles a linked package's `dist/` into its optimize cache and does NOT re-optimize
// on a dist-only change, so a running `pnpm dev` serves a STALE build after you rebuild a
// package (the "saver is old / black on sleep" trap) and even a restart may reuse the
// cache. Aliasing to src makes Vite serve + HMR the TypeScript directly, so the playground
// can never drift from the current source and no package rebuild is needed.
const src = (pkg: string): string =>
  fileURLToPath(new URL(`../../packages/${pkg}/src/index.ts`, import.meta.url));

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/idle-screens/' : '/',
  server: {
    port: 5177,
    strictPort: true,
    // The Metaquarium farm API allowlists Origins server-side (localhost is
    // rejected), so dev fetches go through this proxy wearing the allowed
    // Origin. Production (idlescreens.com) gets its own CORS entry or proxy.
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
  optimizeDeps: { include: ['@preact/signals-core'] },
  resolve: {
    alias: {
      '@idle-screens/core': src('core'),
      '@idle-screens/saver-black-hole': src('saver-black-hole'),
      '@idle-screens/saver-metaquarium': src('saver-metaquarium'),
      '@idle-screens/savers-classic': src('savers-classic'),
      '@idle-screens/schema': src('schema'),
      '@idle-screens/validator': src('validator'),
      '@idle-screens/capabilities': src('capabilities'),
    },
  },
});
