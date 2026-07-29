import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/manifest.ts'],
  format: ['esm'],
  // Split so `import('./tank')` (and with it, three) stays a lazy chunk that only
  // loads when the saver actually mounts.
  splitting: true,
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2022',
  external: ['@idle-screens/core', 'three'],
});
