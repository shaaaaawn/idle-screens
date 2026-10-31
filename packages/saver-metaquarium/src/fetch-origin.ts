/**
 * Where the tank may fetch from when a PARAM names the place.
 *
 * Two params are URLs the tank loads rather than values it reads:
 *
 *  - `dracoPath`: DRACOLoader downloads `draco_wasm_wrapper.js` from it and
 *    runs it as a Web Worker on the page's own origin. A foreign value is
 *    script execution in whatever page mounted the tank — every screen on a
 *    channel, or the headless browser that renders an export.
 *  - `fishUrl`: a GLB fetched and parsed. A foreign value shows the viewer's
 *    IP to that host and feeds its bytes to the decoder.
 *
 * Params are scene data, and scene data comes from whoever authored the
 * scene, so the tank holds both to the places the host itself controls:
 * the page's own origin (a self-hoster's `/draco/` or local GLB), the copy
 * this package ships (`new URL('./draco/', import.meta.url)`), and for fish
 * the asset schemes the package resolves itself (`ipfs://` through its own
 * gateway list, the bundled `mq-breed:` and minted `mq-minted:` models) plus
 * the self-hosted mirror at assets.idlescreens.com — the same allowlist
 * idle-server holds a channel's fishUrl to. Anything else falls back to the
 * default and is logged once.
 *
 * Pure and DOM-free (the page and package URLs are arguments), so vitest
 * covers it; tank.ts passes `location.href` and `import.meta.url`.
 */

/** The self-hosted fish mirror (the first rung of IPFS_GATEWAYS). */
export const ASSET_HOST = 'assets.idlescreens.com';

/** Asset schemes the package resolves without trusting the URL's host. */
const PACKAGE_SCHEMES = ['ipfs:', 'mq-breed:', 'mq-minted:'];

function parse(url: string, base?: string | null): URL | null {
  try {
    return base ? new URL(url, base) : new URL(url);
  } catch {
    return null;
  }
}

/**
 * The part of a URL that says WHO serves it: scheme + host, with a `blob:`
 * URL read by the origin it embeds. Null for URLs nobody serves (`data:`,
 * `about:`, `javascript:` — their origin is "null", and two "null" origins
 * must never compare equal). A `file:` page's local files share one key: no
 * remote host can answer them.
 */
function servedBy(u: URL): string | null {
  if (u.protocol === 'blob:') {
    const inner = parse(u.pathname);
    return inner && inner.protocol !== 'blob:' ? servedBy(inner) : null;
  }
  if (u.protocol === 'http:' || u.protocol === 'https:') return `${u.protocol}//${u.host}`;
  if (u.protocol === 'file:') return 'file://';
  return null;
}

/** Same server as the page that mounted the tank. */
function samePage(u: URL, pageHref: string | null): boolean {
  const page = pageHref ? parse(pageHref) : null;
  if (!page) return false;
  const a = servedBy(u);
  return a !== null && a === servedBy(page);
}

/** Inside a directory this package ships (a URL prefix, not a whole origin: a CDN serves every package). */
function underPackage(u: URL, pkgDir: string | null): boolean {
  const dir = pkgDir ? parse(pkgDir) : null;
  if (!dir || servedBy(u) === null) return false;
  const prefix = dir.href.endsWith('/') ? dir.href : `${dir.href}/`;
  return u.href.startsWith(prefix) && !u.pathname.includes('..');
}

/**
 * Null when the tank may load its Draco decoder from `path`, else why not.
 * Empty means the package's own copy and is always allowed.
 *
 * @param pageHref the mounting page (or worker) location, or null off-DOM
 * @param pkgDraco the package's shipped decoder dir (`new URL('./draco/', import.meta.url).href`)
 */
export function dracoPathProblem(path: string, pageHref: string | null, pkgDraco: string | null): string | null {
  if (path === '') return null;
  const u = parse(path, pageHref);
  if (!u) return 'is not a URL';
  if (samePage(u, pageHref) || underPackage(u, pkgDraco)) return null;
  return 'is not on this page\'s origin or the decoder this package ships, and the decoder runs as script';
}

/**
 * Null when the tank may fetch the fish model at `url`, else why not.
 * Empty is left to the tank as it always was (it names no other host).
 *
 * @param pkgDir the package's own dist dir (`new URL('./', import.meta.url).href`)
 */
export function fishUrlProblem(url: string, pageHref: string | null, pkgDir: string | null): string | null {
  if (url === '') return null;
  if (PACKAGE_SCHEMES.some((s) => url.startsWith(s))) return url.includes('..') ? 'contains ".."' : null;
  const u = parse(url, pageHref);
  if (!u) return 'is not a URL';
  if (u.protocol === 'https:' && u.hostname === ASSET_HOST && !u.port && !u.username && !u.password && !u.pathname.includes('..')) return null;
  if (samePage(u, pageHref) || underPackage(u, pkgDir)) return null;
  return `is not on this page's origin, ${ASSET_HOST}, or an ipfs:// / bundled breed`;
}
