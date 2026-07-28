/**
 * Escaping helpers for the places the playground still builds markup as strings.
 *
 * CodeQL's `js/incomplete-html-attribute-sanitization` flagged the perception
 * panel for exactly one reason: an escaper that handled `<`, `>` and `&` but
 * not `"`, feeding a `style="…"` attribute. Escaping the text delimiters is not
 * enough once a value lands *inside* an attribute — the quote that closes the
 * attribute early is the whole attack.
 *
 * A `href` is a second, separate problem that no amount of escaping solves:
 * `javascript:alert(1)` contains no character HTML-escaping touches, so it
 * survives `escapeHtml` intact and still runs on click. URLs need a scheme
 * allowlist, not an escaper.
 */

/**
 * Escape a value for interpolation into HTML text OR a quoted attribute.
 *
 * The quote characters are not optional. Every caller here interpolates into
 * `attr="${…}"`, and a value carrying `"` closes the attribute and opens an
 * injection point (`" onerror="…`).
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Return an escaped `href` value, or `null` if the URL is not a plain web link.
 *
 * Only absolute `http:`/`https:` URLs are allowed through. Everything else —
 * `javascript:`, `data:`, `vbscript:`, and anything relative — yields `null`,
 * and the caller renders the label as plain text instead of a link.
 *
 * Parsing without a base is deliberate: it fails closed on relative input, and
 * every consumer here links to an external reference, where a relative URL was
 * never meaningful in the first place.
 */
export function safeHttpUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  return escapeHtml(url.href);
}
