/**
 * `townProps`: the small things a lived-in village has — three-free, so the
 * package entry can validate the string (guide.ts) without pulling three.js.
 *
 *   fence[/style]       a fence round every home's yard, a gate where its path
 *                       leaves; styles driftwood coral stone crystal (none: each
 *                       home its own, in turn)
 *   mailbox[/style]     a mailbox by every gate; styles post (its flag goes up
 *                       when the mail comes) clam (it opens) bottle (it rocks)
 *   bench[:n][/style]   n benches (4) round the fountain, the hub or the village
 *                       green, facing in; styles shell stone
 *   sock[:n]            n current socks (1): a striped sock on a pole, swinging
 *                       round as the current turns
 *
 * `fence, mailbox, bench:4, sock` · `fence/coral, mailbox/clam`.
 */

export const FENCE_STYLES = ['driftwood', 'coral', 'stone', 'crystal'] as const;
export const MAILBOX_STYLES = ['post', 'clam', 'bottle'] as const;
export const BENCH_STYLES = ['shell', 'stone'] as const;
export type FenceStyle = (typeof FENCE_STYLES)[number];
export type MailboxStyle = (typeof MAILBOX_STYLES)[number];
export type BenchStyle = (typeof BENCH_STYLES)[number];

export interface TownProps {
  /** Null: no fences. Empty style: each home its own, in turn. */
  fence: { style: FenceStyle | null } | null;
  mailbox: { style: MailboxStyle | null } | null;
  bench: { count: number; style: BenchStyle | null } | null;
  sock: { count: number } | null;
}

export const NO_TOWN: TownProps = { fence: null, mailbox: null, bench: null, sock: null };

export function parseTownProps(src: string): { props: TownProps; problems: string[] } {
  const props: TownProps = { fence: null, mailbox: null, bench: null, sock: null };
  const problems: string[] = [];
  for (const raw of src.split(',')) {
    const part = raw.trim().toLowerCase();
    if (!part) continue;
    const m = /^([a-z]+)\s*(?::\s*([0-9]+))?\s*(?:\/\s*([a-z]+))?$/.exec(part);
    const kind = m?.[1], count = m?.[2] !== undefined ? Number(m[2]) : undefined, style = m?.[3];
    const bad = (why: string): void => { problems.push(`"${raw.trim()}": ${why}`); };
    if (!m) { bad('expected kind[:count][/style] — fence mailbox bench sock'); continue; }
    if (kind === 'fence') {
      if (count !== undefined) bad('a fence has no count: every home gets one');
      if (style && !(FENCE_STYLES as readonly string[]).includes(style)) { bad(`fence styles: ${FENCE_STYLES.join(' ')}`); continue; }
      props.fence = { style: (style as FenceStyle) ?? null };
    } else if (kind === 'mailbox') {
      if (count !== undefined) bad('a mailbox has no count: every home gets one');
      if (style && !(MAILBOX_STYLES as readonly string[]).includes(style)) { bad(`mailbox styles: ${MAILBOX_STYLES.join(' ')}`); continue; }
      props.mailbox = { style: (style as MailboxStyle) ?? null };
    } else if (kind === 'bench') {
      if (style && !(BENCH_STYLES as readonly string[]).includes(style)) { bad(`bench styles: ${BENCH_STYLES.join(' ')}`); continue; }
      props.bench = { count: Math.min(8, Math.max(1, count ?? 4)), style: (style as BenchStyle) ?? null };
    } else if (kind === 'sock') {
      if (style) bad('a current sock has no style');
      props.sock = { count: Math.min(4, Math.max(1, count ?? 1)) };
    } else bad('kinds: fence mailbox bench sock');
  }
  return { props, problems };
}
