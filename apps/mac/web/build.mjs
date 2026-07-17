import { build } from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';

mkdirSync('dist/assets', { recursive: true });

await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  // iife, not esm: WKWebView blocks module scripts over file:// (CORS), and
  // the Mac wrapper loads this bundle via loadFileURL.
  format: 'iife',
  minify: true,
  outfile: 'dist/assets/main.js',
  target: 'safari17',
});

cpSync('index.html', 'dist/index.html');
console.log('mac-web built to dist/');

await import('./gen-catalog.mjs');
