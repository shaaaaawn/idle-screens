/**
 * Attribution for runtime faults while a saver owns the screen: is this
 * uncaught error / unhandled rejection plausibly the saver's, or foreign
 * noise (browser extension, third-party script) the crash ladder must ignore?
 *
 * The deliberate bias is toward engaging the ladder. While a non-passthrough
 * saver holds the fullscreen dialog, the saver is the only thing on screen —
 * a false positive swaps one working screen for the crash screen (still a
 * screen, one swap per sleep), while a false negative freezes a dead saver
 * black. Only sources that clearly cannot be the saver's code are filtered:
 * in production the saver compiles into an unmarked bundle chunk
 * (assets/index-<hash>.js), so origin — not the script's name — is the
 * trustworthy signal.
 */

/** Script locations that name saver/engine code outright (dev servers, CDNs). */
export const SAVER_FAULT_LOC =
  /idle-screens|saver-|@idle-screens|three|metaquarium|schema|core|capabilities/i;

/** Same-origin scripts are fault-eligible: app code and saver code are
 *  indistinguishable once bundled. Opaque origins ("null", file://) compare
 *  equal to themselves, which keeps file:// hosts (native wrappers) working. */
function sameOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url, origin === 'null' ? undefined : origin).origin === origin;
  } catch {
    return false;
  }
}

/**
 * ErrorEvent path. `filename` is the reporting script's URL — empty for
 * inline/synthetic throws (treated as ours), a chrome-extension:// or
 * third-party URL for foreign noise (skipped unless it names saver code).
 */
export function isSaverFaultFilename(filename: unknown, origin: string): boolean {
  if (typeof filename !== 'string' || filename.length === 0) return true;
  if (SAVER_FAULT_LOC.test(filename)) return true;
  return sameOrigin(filename, origin);
}

/**
 * PromiseRejectionEvent path. All we have is the reason's stack (or its
 * string form): no URL at all is inline/synthetic (ours); any same-origin
 * frame claims it; a hint made solely of foreign script URLs is noise.
 */
export function isSaverFaultRejectionHint(hint: string, origin: string): boolean {
  if (!hint) return true;
  if (SAVER_FAULT_LOC.test(hint)) return true;
  const urls = hint.match(/https?:\/\/[^\s)]+/gi);
  if (!urls) return true;
  return urls.some((u) => sameOrigin(u, origin));
}
