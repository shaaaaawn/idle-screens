import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { defineConfig } from 'tsup';

/**
 * Ship the Draco decoder with the package.
 *
 * A lot of the Metaquarium's models are Draco-compressed (the small variants
 * are ~30x smaller: shark 62KB vs 2MB), and three's GLTFLoader silently fails
 * on them without a decoder — the tank degrades to fallback blobs with no
 * error anywhere. Copying three's own gltf decoder into dist keeps that
 * working with NO cdn and NO network beyond the host already serving this
 * package, which is what the native (mac/tvOS) and offline cases need.
 */
function copyDraco(): void {
  // Resolve from the package dir: tsup bundles this config to a temp file, so
  // import.meta.url points somewhere with no node_modules above it. Resolve a
  // subpath three actually EXPORTS — its exports map hides package.json — and
  // walk to the decoder that ships beside the loader.
  const req = createRequire(join(process.cwd(), 'package.json'));
  const loader = req.resolve('three/examples/jsm/loaders/DRACOLoader.js');
  const from = join(dirname(loader), '..', 'libs', 'draco', 'gltf');
  mkdirSync('dist/draco', { recursive: true });
  cpSync(from, 'dist/draco', { recursive: true });
  // Published next to dist/*.js so `new URL('./draco/', import.meta.url)`
  // works when the host serves this package's files as-is. A bundler that
  // inlines the tank chunk must copy these files into its own output (or
  // the host sets the dracoPath param).
}

/**
 * Drop the source maps of the pure-data chunks: a bundled breed's model and a
 * betafish's atlas are one base64 string each (src/breeds/*, src/minted/atlas/*,
 * generated), and a map of that string repeats it in full while mapping
 * nothing anyone debugs — half the package's bytes, before this.
 */
function dropDataMaps(): void {
  const data = /(^|\/)src\/(breeds\/(?!index)[\w-]+|minted\/atlas\/\d+)\.ts$/;
  for (const f of readdirSync('dist')) {
    if (!f.endsWith('.js.map')) continue;
    const map = JSON.parse(readFileSync(join('dist', f), 'utf8')) as { sources: string[] };
    if (!map.sources.length || !map.sources.every((s) => data.test(s))) continue;
    const js = join('dist', f.slice(0, -'.map'.length));
    writeFileSync(js, readFileSync(js, 'utf8').replace(/\n\/\/# sourceMappingURL=\S+\s*$/, '\n'));
    rmSync(join('dist', f));
  }
}

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
  onSuccess: async () => { copyDraco(); dropDataMaps(); },
});
