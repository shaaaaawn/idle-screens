import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/idle-worker.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2022',
  external: ['@idle-screens/core'],
});
