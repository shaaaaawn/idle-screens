/**
 * "Did you mean" for validator and steering errors (registry #122): the one
 * known name an unknown one was most likely meant to be — or nothing, because
 * a wrong hint costs an agent more than no hint. Pure, dependency-free, and
 * exported so idle-server's setParam/setTrack errors use the same rule
 * instead of a copy.
 */

/**
 * Optimal-string-alignment distance (Levenshtein plus adjacent
 * transposition), so `aplha` and `drfit` are one edit away, not two.
 */
function osa(a: string, b: string): number {
  const n = a.length;
  const m = b.length;
  if (n === 0) return m;
  if (m === 0) return n;
  let prev2: number[] = new Array<number>(m + 1).fill(0);
  let prev: number[] = Array.from({ length: m + 1 }, (_, j) => j);
  let cur: number[] = new Array<number>(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    cur[0] = i;
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, prev2[j - 2]! + 1);
      cur[j] = d;
    }
    [prev2, prev, cur] = [prev, cur, prev2];
  }
  return prev[m]!;
}

/** Most edits a name of this length may be from its suggestion: none under 3 chars, 1 up to 5, then 2. */
const editLimit = (name: string): number => Math.min(2, Math.floor(name.length / 3));

/** Distance between two names, ignoring case, or Infinity past the typed name's limit. */
function nameDistance(typed: string, candidate: string): number {
  const limit = editLimit(typed);
  if (Math.abs(typed.length - candidate.length) > limit) return Infinity;
  const d = osa(typed.toLowerCase(), candidate.toLowerCase());
  return d <= limit ? d : Infinity;
}

/** The unique candidate at the lowest finite cost, or undefined on a tie or no match. */
function unique<T>(candidates: Iterable<T>, cost: (c: T) => number): T | undefined {
  let best: T | undefined;
  let bestCost = Infinity;
  let tie = false;
  for (const c of candidates) {
    const d = cost(c);
    if (d === Infinity) continue;
    if (d < bestCost) {
      best = c;
      bestCost = d;
      tie = false;
    } else if (d === bestCost && c !== best) {
      tie = true;
    }
  }
  return tie ? undefined : best;
}

/**
 * The candidate `name` was most likely meant to be: within 1 edit for names of
 * 3–5 characters and 2 for longer ones (a transposed pair is one edit), case
 * ignored — so `fontsize` finds `fontSize` and a 2-character name finds only a
 * case variant. Returns undefined when `name` is itself a candidate, when
 * nothing is close enough, or when two candidates are equally close: a wrong
 * hint is worse than none.
 */
export function nearest(name: string, candidates: Iterable<string>): string | undefined {
  const list = [...candidates];
  if (list.includes(name)) return undefined;
  return unique(list, (c) => nameDistance(name, c));
}

/** `layers[0].motion` and `layers.0.motion` as the same segments. */
const segments = (path: string): string[] => path.replace(/\[(\d+)\]/g, '.$1').split('.').filter((s) => s !== '');
const isIndex = (s: string): boolean => /^\d+$/.test(s);

/**
 * How far a typed dot-path is from a candidate, in edits: one segment missing
 * or extra (`layers.0.speed` → `layers.0.motion.speed`, `layers.0.sprite.blend`
 * → `layers.0.blend`) costs 1, and one misspelt segment costs its `nearest`
 * distance. Indices never change and the leaf is never added or dropped, so a
 * suggestion always addresses the field the author named, on the item they
 * named. Anything further apart is Infinity.
 */
function pathDistance(typed: string[], cand: string[]): number {
  const n = typed.length;
  const m = cand.length;
  if (n === m) {
    let differing = -1;
    for (let i = 0; i < n; i++) {
      if (typed[i] === cand[i]) continue;
      if (differing !== -1) return Infinity;
      differing = i;
    }
    if (differing === -1) return Infinity; // the same path
    const a = typed[differing]!;
    const b = cand[differing]!;
    return isIndex(a) || isIndex(b) ? Infinity : nameDistance(a, b);
  }
  if (Math.abs(n - m) !== 1) return Infinity;
  const [long, short] = n > m ? [typed, cand] : [cand, typed];
  // The extra segment sits somewhere before the (shared) leaf.
  for (let skip = 0; skip < long.length - 1; skip++) {
    if (isIndex(long[skip]!)) continue;
    let same = true;
    for (let i = 0, j = 0; i < long.length; i++) {
      if (i === skip) continue;
      if (long[i] !== short[j++]) { same = false; break; }
    }
    if (same) return 1;
  }
  return Infinity;
}

/**
 * The candidate dot-path `path` was most likely meant to be — for a steer or
 * timeline key whose path does not resolve, against the spec's
 * `steerablePaths`. Bracket indices read as dot segments. Same rule as
 * `nearest`: undefined when `path` is a candidate, when nothing is close, or
 * on a tie (`layers.0.radius` with both `sprite.radius` and `motion.radius`
 * present suggests neither).
 */
export function nearestPath(path: string, candidates: Iterable<string>): string | undefined {
  const typed = segments(path);
  const canon = typed.join('.');
  const list = [...candidates];
  if (list.some((c) => segments(c).join('.') === canon)) return undefined;
  return unique(list, (c) => pathDistance(typed, segments(c)));
}
