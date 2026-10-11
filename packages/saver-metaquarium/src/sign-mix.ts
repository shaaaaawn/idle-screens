/**
 * The `signs` DSL: underwater signage, one entry a sign.
 *
 *   kind[@place][>target][/#color][*size][:text], …
 *
 *   plank@gate:"Welcome to the reef", neon@home1/#ff4fa0:OPEN,
 *   led@plaza:TIDE 4.2M - WATER 24°, arrow@hub>gate:Castle, porthole:♥
 *
 * Zero-dep (no three): the validator, the guide and the anatomy parse with it.
 */
import { drawable } from './pixel-font';

export const SIGN_KINDS = ['plank', 'arrow', 'ring', 'porthole', 'neon', 'led'] as const;
export type SignKind = typeof SIGN_KINDS[number];

/** Where a sign can stand: the world's own marks and the open tank's. */
export const SIGN_PLACES = ['gate', 'plaza', 'courtyard', 'hub', 'fountain', 'home1', 'home2', 'home3', 'centre', 'left', 'right', 'front', 'back'] as const;

/** Characters a sign has room for. An LED board scrolls, so it takes a sentence. */
export const SIGN_TEXT_MAX: Record<SignKind, number> = { plank: 24, arrow: 16, ring: 10, porthole: 4, neon: 14, led: 64 };
export const MAX_SIGNS = 8;

export interface SignEntry {
  kind: SignKind;
  /** A mark to stand beside, or null: a seeded spot in the open, facing the front. */
  place: string | null;
  /** An arrow's destination mark: it points that way. */
  target: string | null;
  /** Lettering (plank, arrow), tubes (neon), LEDs (led), glass (porthole), stripes (ring). */
  color: string | null;
  size: number;
  text: string;
}

export interface SignMixResult { entries: SignEntry[]; problems: string[] }

/** Split on commas outside double quotes. */
function splitEntries(value: string): string[] {
  const out: string[] = [];
  let cur = '', quoted = false;
  for (const ch of value) {
    if (ch === '"') quoted = !quoted;
    if (ch === ',' && !quoted) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

export function parseSignMix(value: string): SignMixResult {
  const entries: SignEntry[] = [], problems: string[] = [];
  // The last sign's text, while a comma could still be part of it: unquoted, and room left.
  let open: SignEntry | null = null;
  for (const raw of splitEntries(String(value ?? ''))) {
    // A comma inside unquoted words ("TANGS, BLOWFISH, AND FRIENDS") is part of
    // the words: a piece that is not a sign of its own carries the last one's text on.
    // Shaped like a sign (`word:` `word@`…) is judged as a sign, so a mistyped
    // kind is reported, not swallowed into the words before it.
    const signShaped = /^[a-z]+[@>/*:]/i.test(raw);
    const lead = /^([a-z]+)(?=$|[@>/*:])/i.exec(raw)?.[1]?.toLowerCase();
    if (open && !signShaped && !(lead && (SIGN_KINDS as readonly string[]).includes(lead))) {
      const max = SIGN_TEXT_MAX[open.kind], more = [...`${open.text}, ${raw}`];
      if (more.length > max) problems.push(`a ${open.kind} has room for ${max} characters — "${more.join('')}" cut`);
      open.text = more.slice(0, max).join('');
      continue;
    }
    open = null;
    const colon = raw.indexOf(':');
    const head = (colon < 0 ? raw : raw.slice(0, colon)).trim();
    let text = colon < 0 ? '' : raw.slice(colon + 1).trim();
    const quoted = text.startsWith('"') && text.endsWith('"') && text.length >= 2;
    if (quoted) text = text.slice(1, -1);
    const m = /^([a-z]+)(?:@([a-z0-9]+))?(?:>([a-z0-9]+))?(?:\/(#[0-9a-f]{3}(?:[0-9a-f]{3})?))?(?:\*(\d+(?:\.\d+)?))?$/i.exec(head);
    if (!m) { problems.push(`"${raw}" is not kind[@place][>target][/#color][*size][:text]`); continue; }
    const kind = m[1]!.toLowerCase() as SignKind;
    if (!SIGN_KINDS.includes(kind)) {
      problems.push(`"${m[1]}" is not a sign (${SIGN_KINDS.join(', ')})${entries.length ? ' — if it was part of the last sign\'s words, put them in "quotes"' : ''}`);
      continue;
    }
    if (entries.length >= MAX_SIGNS) { problems.push(`more than ${MAX_SIGNS} signs — "${raw}" dropped`); continue; }
    const place = m[2]?.toLowerCase() ?? null, target = m[3]?.toLowerCase() ?? null;
    if (place && !(SIGN_PLACES as readonly string[]).includes(place)) {
      problems.push(`"@${place}" is not a place (${SIGN_PLACES.join(', ')}) — that sign stands in the open`);
    }
    if (target && kind !== 'arrow') problems.push(`">${target}": only an arrow points somewhere`);
    if (target && !(SIGN_PLACES as readonly string[]).includes(target)) problems.push(`">${target}" is not a place (${SIGN_PLACES.join(', ')})`);
    let size = m[5] ? Number(m[5]) : 1;
    if (!(size >= 0.5 && size <= 3)) { problems.push(`"*${m[5]}": a sign's size is 0.5–3 — clamped`); size = Math.min(3, Math.max(0.5, size || 1)); }
    const max = SIGN_TEXT_MAX[kind];
    if ([...text].length > max) { problems.push(`a ${kind} has room for ${max} characters — "${text}" cut`); text = [...text].slice(0, max).join(''); }
    const odd = [...new Set([...text].filter((ch) => !drawable(ch)))];
    if (odd.length) problems.push(`${odd.map((c) => `"${c}"`).join(' ')} cannot be drawn on a sign — shown as ?`);
    const entry: SignEntry = {
      kind,
      place: place && (SIGN_PLACES as readonly string[]).includes(place) ? place : null,
      target: target && kind === 'arrow' && (SIGN_PLACES as readonly string[]).includes(target) ? target : null,
      color: m[4]?.toLowerCase() ?? null,
      size,
      text,
    };
    entries.push(entry);
    if (colon >= 0 && !quoted) open = entry;
  }
  return { entries, problems };
}
