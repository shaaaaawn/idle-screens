import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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
  // `import.meta` does not exist in an IIFE, so esbuild substitutes `{}` and
  // every `new URL(rel, import.meta.url)` becomes `new URL(rel, undefined)` —
  // which THROWS. three's DRACOLoader does exactly that at module scope
  // (three/examples/jsm/loaders/DRACOLoader.js:17-23), so importing the tank
  // killed the saver before a single line of its own code ran: "TypeError:
  // Invalid URL", from a module nothing in this app calls directly.
  //
  // Give it the page's own URL instead. Those particular constants are only
  // DRACOLoader's defaults and are overwritten by setDecoderPath before any
  // fetch, so this buys module initialisation, not a working decoder path —
  // that comes from the explicit dracoPath in src/savers.ts.
  banner: { js: 'var __idleImportMetaUrl = document.baseURI;' },
  define: { 'import.meta.url': '__idleImportMetaUrl' },
});

cpSync('index.html', 'dist/index.html');
// The tank's Draco decoder. It lives in the saver package, but this bundle is
// one IIFE file — the package's `import.meta.url` default cannot survive that
// (see the dracoPath note in src/savers.ts), so the decoder has to sit at a
// path we choose and serve ourselves. Fetched only when a fish actually turns
// out to be Draco-compressed, so it costs disk, not startup.
//
// tsup `clean: true` wipes dist/draco until that package's onSuccess recopies
// it, so a mac-web-only build against a clean tree used to die on a bare
// ENOENT. Say what to run instead of throwing Node's generic "no such file".
const dracoSrc = [
  new URL('../../../packages/saver-metaquarium/dist/draco/', import.meta.url),
  new URL('../node_modules/@idle-screens/saver-metaquarium/dist/draco/', import.meta.url),
].find((u) => existsSync(fileURLToPath(u)));
if (!dracoSrc) {
  throw new Error(
    'mac-web: Draco decoder missing. Build the saver package first:\n' +
      '  pnpm --filter @idle-screens/saver-metaquarium build\n' +
      '(or `pnpm build` at the repo root). dist/draco is written by that package\'s tsup onSuccess.',
  );
}
cpSync(dracoSrc, 'dist/assets/draco', { recursive: true });
console.log('mac-web built to dist/');

await import('./gen-catalog.mjs');
