/**
 * The cast, as rows. `fishMix` is an array in a string — `100:3@drift, 257:2,
 * glowfish:1@patrol` — and a one-line text box made it the hardest param in
 * the panel to change. Each token becomes a row: who, how many, how they swim.
 * The string stays the source of truth (it is what a channel publishes), so
 * the raw field is still there underneath, and anything the rows cannot parse
 * is kept verbatim rather than dropped.
 */

export interface CastRow { who: string; count: number; style: string; raw?: string }

// A count is 1 or more, as the tank's parser has it: `:0` is not a row with
// nothing in it but a token the tank drops, so it stays raw and visible.
const TOKEN = /^([^:@\s]+)(?::([1-9]\d*))?(?:@([a-z-]+))?$/i;

export function parseCast(mix: string): CastRow[] {
  return mix.split(',').map((t) => t.trim()).filter(Boolean).map((t) => {
    const m = TOKEN.exec(t);
    return m ? { who: m[1]!, count: m[2] ? Number(m[2]) : 1, style: m[3] ?? '' } : { who: t, count: 1, style: '', raw: t };
  });
}

export function formatCast(rows: readonly CastRow[]): string {
  return rows.filter((r) => r.raw ?? r.who.trim()).map((r) => r.raw
    ?? `${r.who.trim()}${r.count !== 1 ? `:${r.count}` : ''}${r.style ? `@${r.style}` : ''}`).join(',');
}

/** Ids and breeds worth offering; anything else can still be typed. */
const WHO = [
  ['100', '#100 Betafish (local)'], ['257', '#257 Angelfish (local)'], ['300', '#300 Angelfish'], ['457', '#457 Seahorse'],
  ['497', '#497 Sea Turtle'], ['betafish', 'any betafish'], ['angelfish', 'any angelfish'], ['seahorse', 'any seahorse'],
  ['seaturtle', 'any sea turtle'], ['glowfish', 'glowfish (NPC)'], ['jellyfish', 'jellyfish (NPC)'], ['crab', 'crab (NPC)'],
] as const;

export function buildCastEditor(
  value: string,
  styles: readonly string[],
  onChange: (mix: string) => void,
): { el: HTMLElement; update(mix: string): void } {
  const el = document.createElement('div');
  el.className = 'wb-cast';
  const list = document.createElement('datalist');
  list.id = 'wb-cast-who';
  for (const [v, label] of WHO) list.append(Object.assign(document.createElement('option'), { value: v, label }));

  let rows = parseCast(value);
  let shown = value;
  const commit = (): void => { shown = formatCast(rows); raw.value = shown; total(); onChange(shown); };

  const body = document.createElement('div');
  const foot = document.createElement('div');
  foot.className = 'wb-cast-foot';
  const add = Object.assign(document.createElement('button'), { type: 'button', className: 'wb-cast-btn', textContent: '+ add fish' });
  const sum = document.createElement('span');
  sum.className = 'wb-cast-sum';
  const raw = Object.assign(document.createElement('input'), { type: 'text', className: 'wb-input wb-param-input wb-cast-raw', value });
  raw.setAttribute('aria-label', 'fishMix');
  raw.title = 'fishMix — the string a channel publishes';
  const total = (): void => {
    const n = rows.reduce((t, r) => t + r.count, 0);
    sum.textContent = rows.length ? `${n} fish · ${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}` : 'empty — fishCount × fishUrl is used';
  };

  const paint = (): void => {
    body.replaceChildren();
    rows.forEach((r, i) => {
      const line = document.createElement('div');
      line.className = 'wb-cast-row';
      const who = Object.assign(document.createElement('input'), { type: 'text', className: 'wb-input wb-cast-who', value: r.who });
      who.setAttribute('list', list.id);
      who.setAttribute('aria-label', `cast ${i + 1}: fish id or breed`);
      who.placeholder = 'id or breed';
      who.addEventListener('focus', () => who.select());
      who.addEventListener('change', () => { r.who = who.value.trim(); delete r.raw; commit(); });
      const count = Object.assign(document.createElement('input'), { type: 'number', className: 'wb-input wb-cast-count', value: String(r.count), min: '1', max: '24' });
      count.setAttribute('aria-label', `cast ${i + 1}: how many`);
      count.addEventListener('change', () => { r.count = Math.min(24, Math.max(1, Math.round(Number(count.value) || 1))); count.value = String(r.count); delete r.raw; commit(); });
      const style = document.createElement('select');
      style.className = 'wb-input wb-select wb-cast-style';
      style.setAttribute('aria-label', `cast ${i + 1}: swim style`);
      style.append(Object.assign(document.createElement('option'), { value: '', textContent: 'scene style' }));
      for (const s of styles) style.append(Object.assign(document.createElement('option'), { value: s, textContent: s }));
      // The tank reads the style case-blind, so `@School` is `school` here.
      // One it does not know at all is still shown as what it is — the string
      // keeps it either way; a select with no matching option would show
      // "scene style" for a fish that is tagged.
      const known = styles.includes(r.style.toLowerCase());
      if (r.style && !known) style.append(Object.assign(document.createElement('option'), { value: r.style, textContent: `${r.style} (unknown)` }));
      style.value = known ? r.style.toLowerCase() : r.style;
      style.addEventListener('change', () => { r.style = style.value; delete r.raw; commit(); });
      const del = Object.assign(document.createElement('button'), { type: 'button', className: 'wb-cast-btn wb-cast-del', textContent: '×', title: 'Remove from the cast' });
      del.addEventListener('click', () => { rows.splice(i, 1); paint(); commit(); });
      line.append(who, count, style, del);
      body.append(line);
    });
    total();
  };

  add.addEventListener('click', () => { rows.push({ who: '100', count: 1, style: '' }); paint(); commit(); });
  raw.addEventListener('change', () => { rows = parseCast(raw.value); shown = raw.value; paint(); onChange(raw.value); });
  foot.append(add, sum);
  el.append(list, body, foot, raw);
  paint();

  const show = (mix: string): void => { shown = mix; rows = parseCast(mix); raw.value = mix; paint(); };
  /** A value that arrived while a field was being edited, to show once the
   *  editor is left — an edit in the meantime supersedes it. */
  let pending: string | null = null;
  el.addEventListener('focusout', () => {
    // Next tick: focus moving to another of the editor's own fields is not
    // leaving, and a click on × or + add has committed by then (which clears
    // `pending` through update) rather than being painted over first.
    window.setTimeout(() => {
      if (pending === null || el.contains(document.activeElement)) return;
      const mix = pending;
      pending = null;
      if (mix !== shown) show(mix);
    }, 0);
  });

  return {
    el,
    update(mix) {
      // The timeline refreshes values constantly; only rebuild on a real change,
      // and never under a field someone is typing in — that value waits for
      // focus to leave, and the user's own commit (which arrives here as the
      // shown value) cancels it.
      if (mix === shown) { pending = null; return; }
      if (el.contains(document.activeElement)) { pending = mix; return; }
      show(mix);
    },
  };
}
