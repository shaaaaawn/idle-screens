/**
 * The spot rig: up to three follow-spots, each on its own fish in its own
 * colour, and a cue sheet that says which of them are up when — a solo, the
 * other solo, the duet, the trio. Zero-dep (the manifest lane validates these
 * strings without three.js) and pure in t, like everything else.
 *
 *   spotRig   `slot[/color][*radius]`, comma-separated, at most three.
 *             `0/#fff2cf, 1/#ff67bc*24, 2/#49cfff` — the rig's spots are then
 *             called a, b, c in order (which are also a vignette's actors, if
 *             the rig follows slots 0 1 2).
 *   spotCues  `8s:a, 8s:b, 12s:a+b, 6s:-` — a looping sheet. `-` is a blackout
 *             on the spots (house lights stay down: it is still a show). Empty
 *             means every spot in the rig is up all the time.
 */

export const MAX_SPOTS = 3;
/** Seconds a spot takes to come up or go out at a cue. */
export const SPOT_FADE = 1.4;

export interface SpotSpec { slot: number; color: string; radius: number }
export interface SpotCue { t0: number; dur: number; on: boolean[] }
export interface SpotSheet { cues: SpotCue[]; duration: number; problems: string[] }

const DEFAULT_COLORS = ['#fff2cf', '#ff8ad0', '#7fdcff'];

export function parseSpotRig(value: string): { spots: SpotSpec[]; problems: string[] } {
  const spots: SpotSpec[] = [], problems: string[] = [];
  for (const raw of value.split(',').map(s => s.trim()).filter(Boolean)) {
    const m = /^(\d{1,2})(?:\/(#[0-9a-fA-F]{3,8}))?(?:\*(\d+(?:\.\d+)?))?$/.exec(raw);
    if (!m) { problems.push(`"${raw}" is not slot[/color][*radius]`); continue; }
    if (spots.length >= MAX_SPOTS) { problems.push(`more than ${MAX_SPOTS} spots — "${raw}" dropped`); continue; }
    spots.push({
      slot: Math.min(23, Number(m[1])),
      color: m[2] ?? DEFAULT_COLORS[spots.length]!,
      radius: Math.min(60, Math.max(12, m[3] ? Number(m[3]) : 28)),
    });
  }
  return { spots, problems };
}

export function parseSpotCues(value: string, spots: number): SpotSheet {
  const cues: SpotCue[] = [], problems: string[] = [];
  let t0 = 0;
  for (const raw of value.split(',').map(s => s.trim()).filter(Boolean)) {
    const m = /^(\d+(?:\.\d+)?)s\s*:\s*(-|[abc](?:\s*\+\s*[abc])*)$/.exec(raw);
    if (!m) { problems.push(`"${raw}" is not <seconds>s:a+b`); continue; }
    const dur = Math.min(120, Math.max(2, Number(m[1])));
    const on = [false, false, false];
    if (m[2] !== '-') for (const letter of m[2]!.split('+')) {
      const i = letter.trim().charCodeAt(0) - 97;
      if (i >= spots) problems.push(`cue "${raw}" names spot ${letter.trim()} but the rig has ${spots}`);
      else on[i] = true;
    }
    cues.push({ t0, dur, on });
    t0 += dur;
  }
  return { cues, duration: t0, problems };
}

const smooth = (u: number): number => { const c = Math.min(1, Math.max(0, u)); return c * c * (3 - 2 * c); };

/** How far up each spot is at `t` (0..1), written into `out`. A spot fades
 *  over `SPOT_FADE` either side of a cue boundary, so a handover crosses. */
export function spotLevels(sheet: SpotSheet | null, spots: number, tSec: number, out: number[]): void {
  for (let i = 0; i < MAX_SPOTS; i++) out[i] = i < spots ? 1 : 0;
  if (!sheet || !sheet.cues.length || sheet.duration <= 0) return;
  const t = ((tSec % sheet.duration) + sheet.duration) % sheet.duration;
  const n = sheet.cues.length;
  const ci = Math.max(0, sheet.cues.findIndex(c => t < c.t0 + c.dur));
  const cue = sheet.cues[ci]!, prev = sheet.cues[(ci + n - 1) % n]!;
  const k = smooth((t - cue.t0) / SPOT_FADE);
  for (let i = 0; i < MAX_SPOTS; i++) {
    const a = prev.on[i] ? 1 : 0, b = cue.on[i] ? 1 : 0;
    out[i] = i < spots ? a + (b - a) * k : 0;
  }
}
