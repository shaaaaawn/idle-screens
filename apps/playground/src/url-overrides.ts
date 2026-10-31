/**
 * `?mq.<param>=<value>` overrides (main.ts) layer onto EVERY metaquarium scene,
 * and the query survives every click: a script's before/after URL left in a
 * tab turns each recipe you then open into the script's cast, silently. So
 * the top bar says so, and offers to clear them.
 */

/** The `mq.*` overrides in a query string, by param (numbers parsed). */
export function mqOverrides(search: string): Record<string, string | number> {
  return Object.fromEntries(
    [...new URLSearchParams(search)].filter(([k]) => k.startsWith('mq.'))
      .map(([k, v]) => [k.slice(3), v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : v]),
  );
}

/** The same query string without its `mq.*` overrides ('' when nothing is left). */
export function withoutOverrides(search: string): string {
  const q = new URLSearchParams(search);
  for (const k of [...q.keys()]) if (k.startsWith('mq.')) q.delete(k);
  const s = q.toString();
  return s ? `?${s}` : '';
}

/** The badge's text: the first few param names, then how many more. */
export function overrideLabel(keys: readonly string[], show = 3): string {
  const head = keys.slice(0, show).join(', ');
  return keys.length > show ? `${head} +${keys.length - show}` : head;
}

/** Show the badge in `host` when the URL carries overrides; its button clears them and reloads. */
export function mountOverrideBadge(host: HTMLElement | null, loc: Pick<Location, 'search' | 'hash' | 'pathname'> & { assign(url: string): void }): void {
  const o = mqOverrides(loc.search);
  const keys = Object.keys(o);
  if (!host || !keys.length) return;
  host.hidden = false;
  host.title = `URL overrides on every metaquarium scene:\n${keys.map((k) => `${k} = ${String(o[k])}`).join('\n')}`;
  const label = document.createElement('span');
  label.textContent = `mq overrides: ${overrideLabel(keys)}`;
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.textContent = 'clear';
  clear.addEventListener('click', () => loc.assign(`${loc.pathname}${withoutOverrides(loc.search)}${loc.hash}`));
  host.replaceChildren(label, clear);
}
