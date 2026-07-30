import type { ControlTrack, Ease, ParamDelta, ParamSpace, ParamValue, SaverPlugin, SaverInstance } from '@idle-screens/core';
import { sampleTrack } from '@idle-screens/core';
import {
  buildTimelineProfile,
  type TimelineLaneView,
  type TimelineMode,
  type TimelineProfile,
} from './timeline-profiles';
import { isPreviewDriven, syncPreviewTime } from './preview-sync';

export interface TimelineHandle {
  setSaver(saver: SaverPlugin, instance: SaverInstance | null, seed?: number): void;
  loadTrack(track: ControlTrack): void;
  onTimeChange: ((t: number) => void) | null;
  /** Insert/update a param delta at the current playhead time. */
  setParam(path: string, value: ParamValue): void;
  /** Current playhead time in ms. */
  currentTime(): number;
  /** Play/pause the inline preview — the same action as the transport button. */
  togglePlay(): void;
  isPlaying(): boolean;
  /**
   * Fires whenever playback starts or stops, from any source. The top bar's
   * control mirrors this rather than tracking its own flag, so the two can
   * never disagree about whether the preview is running.
   */
  onPlayingChange: ((playing: boolean) => void) | null;
  onTrackChange: ((track: ControlTrack) => void) | null;
}

/** Smallest window the time axis may zoom to — below this, keys overlap anyway. */
const MIN_VIEW_MS = 120;
/** Default drag snap. Hold Shift while dragging for free placement. */
const SNAP_MS = 10;
/** Arrow-key step; Shift multiplies. */
const STEP_MS = 100;
const EASES: Ease[] = ['step', 'linear', 'smooth'];
const EDIT_STORAGE = 'idleScreens.timeline.edit:';

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function buildTimelinePanel(mount: HTMLElement): TimelineHandle {
  let currentSaver: SaverPlugin | null = null;
  let currentInstance: SaverInstance | null = null;
  let currentProfile: TimelineProfile | null = null;
  let explicitTrack: ControlTrack | null = null;
  let playheadT = 0;
  let playing = false;
  let rafId = 0;
  let startWall = 0;
  let startT = 0;
  let seed = 42;

  /**
   * Visible time window, independent of the track duration. `buildTimelineProfile`
   * can hand us a 24s program; at full width that's ~58px/sec, so keys closer
   * than ~100ms land on the same pixel and are neither readable nor draggable.
   * Everything that positions in x goes through `tToPct`.
   */
  let viewStart = 0;
  let viewEnd = 0;

  /**
   * Edited tracks, per saver id.
   *
   * `buildTimelineProfile` DERIVES a track (a canonical demo track, or a hold
   * track built from paramSpace defaults) and re-derives it on every
   * `applyProfile()`. So an edit written back into `profile.track` is discarded
   * the next time the saver is re-selected or the seed changes. This map is the
   * owned copy: once a saver has an entry it wins over the derived track, and it
   * is persisted so edits survive a reload.
   */
  const edits = new Map<string, ControlTrack>();
  let selected: { path: string; index: number } | null = null;

  // ---- DOM ---------------------------------------------------------------
  const section = document.createElement('section');
  section.className = 'timeline-panel';
  section.tabIndex = 0; // keyboard transport needs a focus target

  const transport = document.createElement('div');
  transport.className = 'tl-transport';

  const mkBtn = (label: string, title: string, cls = ''): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `tl-btn ${cls}`.trim();
    b.textContent = label;
    b.title = title;
    return b;
  };

  const startBtn = mkBtn('⏮', 'Go to start (Home)');
  const prevKeyBtn = mkBtn('◂', 'Previous keyframe (↑)');
  const playBtn = mkBtn('▶', 'Play / pause (Space)');
  const nextKeyBtn = mkBtn('▸', 'Next keyframe (↓)');
  const endBtn = mkBtn('⏭', 'Go to end (End)');

  const timeInput = document.createElement('input');
  timeInput.className = 'tl-time-input';
  timeInput.type = 'text';
  timeInput.title = 'Current time in seconds — type to jump';
  timeInput.setAttribute('aria-label', 'Current time in seconds');

  const durationEl = document.createElement('span');
  durationEl.className = 'tl-time';

  const loopCheck = document.createElement('label');
  loopCheck.className = 'tl-loop';
  const loopInput = document.createElement('input');
  loopInput.type = 'checkbox';
  loopInput.checked = true;
  loopCheck.append(loopInput, ' Loop');

  const modeBadge = document.createElement('span');
  modeBadge.className = 'tl-mode';

  const zoomOutBtn = mkBtn('－', 'Zoom out (−)');
  const frameAllBtn = mkBtn('⤢', 'Frame all (F)');
  const zoomInBtn = mkBtn('＋', 'Zoom in (+)');

  const editedBadge = document.createElement('span');
  editedBadge.className = 'tl-edited';
  editedBadge.textContent = 'edited';
  editedBadge.hidden = true;

  const exportBtn = mkBtn('⇩', 'Download this control track as JSON');
  const resetBtn = mkBtn('⟲', 'Discard edits and restore the derived track');

  const trackInfo = document.createElement('span');
  trackInfo.className = 'tl-track-info';

  transport.append(
    startBtn, prevKeyBtn, playBtn, nextKeyBtn, endBtn,
    timeInput, durationEl, loopCheck, modeBadge,
    zoomOutBtn, frameAllBtn, zoomInBtn,
    editedBadge, exportBtn, resetBtn,
    trackInfo,
  );

  const trackArea = document.createElement('div');
  trackArea.className = 'tl-track-area';

  const rulerRow = document.createElement('div');
  rulerRow.className = 'tl-ruler';
  const rulerLabel = document.createElement('span');
  rulerLabel.className = 'tl-ruler-label';
  rulerLabel.textContent = 'sec';
  const rulerTrack = document.createElement('div');
  rulerTrack.className = 'tl-ruler-track';
  const rulerVal = document.createElement('span');
  rulerVal.className = 'tl-ruler-val';
  rulerRow.append(rulerLabel, rulerTrack, rulerVal);

  const channelsEl = document.createElement('div');
  channelsEl.className = 'tl-channels';

  /**
   * The playhead lives in an overlay that spans exactly the track column, so it
   * positions as a percentage of that column. The previous version measured
   * `getBoundingClientRect()` of the first lane and offset in pixels, which
   * silently went wrong on resize (there was no resize listener at all).
   */
  const overlay = document.createElement('div');
  overlay.className = 'tl-overlay';
  const playheadEl = document.createElement('div');
  playheadEl.className = 'tl-playhead';
  overlay.append(playheadEl);

  // Drag handle between the channel names and the tracks.
  const gutter = document.createElement('div');
  gutter.className = 'tl-gutter';
  gutter.title = 'Drag to resize the channel column';

  // A relative wrapper INSIDE the scroller: the overlay and gutter then span
  // the full content height rather than just the visible box, so the playhead
  // stays full-length once the channel list is tall enough to scroll.
  const content = document.createElement('div');
  content.className = 'tl-content';
  content.append(rulerRow, channelsEl, overlay, gutter);
  trackArea.append(content);
  section.append(transport, trackArea);
  mount.append(section);

  // ---- view helpers ------------------------------------------------------
  const viewSpan = (): number => Math.max(1, viewEnd - viewStart);
  const tToPct = (t: number): number => ((t - viewStart) / viewSpan()) * 100;
  const inView = (t: number): boolean => t >= viewStart - 1 && t <= viewEnd + 1;

  const setView = (start: number, end: number): void => {
    const dur = currentProfile?.duration ?? 0;
    if (!dur) return;
    let s = start;
    let e = end;
    if (e - s < MIN_VIEW_MS) {
      const mid = (s + e) / 2;
      s = mid - MIN_VIEW_MS / 2;
      e = mid + MIN_VIEW_MS / 2;
    }
    if (e - s > dur) {
      s = 0;
      e = dur;
    }
    if (s < 0) { e -= s; s = 0; }
    if (e > dur) { s -= e - dur; e = dur; }
    viewStart = Math.max(0, s);
    viewEnd = Math.min(dur, e);
    renderTimeAxis();
  };

  const frameAll = (): void => setView(0, currentProfile?.duration ?? 0);

  /** Zoom about a fixed time so the point under the cursor stays put. */
  const zoomAbout = (t: number, factor: number): void => {
    const span = viewSpan() * factor;
    const ratio = (t - viewStart) / viewSpan();
    setView(t - span * ratio, t - span * ratio + span);
  };

  // ---- owned track -------------------------------------------------------
  const saverId = (): string => currentSaver?.manifest.id ?? '';

  const loadPersistedEdit = (id: string): void => {
    if (edits.has(id)) return;
    try {
      const raw = localStorage.getItem(EDIT_STORAGE + id);
      if (raw) edits.set(id, JSON.parse(raw) as ControlTrack);
    } catch {
      /* corrupt entry — fall back to the derived track */
    }
  };

  const persistEdit = (id: string, track: ControlTrack): void => {
    try {
      localStorage.setItem(EDIT_STORAGE + id, JSON.stringify(track));
    } catch {
      /* quota or private mode — the in-memory edit still applies this session */
    }
  };

  /**
   * Take ownership of the current track so it can be mutated. Called on the
   * first edit; afterwards `applyProfile` prefers this copy over the derived one.
   */
  const ownTrack = (): ControlTrack | null => {
    if (!currentProfile || !currentSaver) return null;
    const id = saverId();
    let owned = edits.get(id);
    if (!owned) {
      owned = structuredClone(currentProfile.track);
      edits.set(id, owned);
    }
    currentProfile.track = owned;
    return owned;
  };

  /** Badge + export/reset enablement. Owned in one place so an edit made in
   *  this session enables Discard immediately, not only after a reload. */
  const syncEditControls = (): void => {
    const editable = currentProfile?.mode === 'track';
    const dirty = edits.has(saverId());
    editedBadge.hidden = !dirty;
    exportBtn.disabled = !editable;
    resetBtn.disabled = !editable || !dirty;
  };

  /** Apply an edit: push to the instance, re-render, persist, mark dirty. */
  const commitEdit = (track: ControlTrack): void => {
    persistEdit(saverId(), track);
    currentInstance?.applyTrack?.(track);
    updateChannels();
    updateValues();
    syncPreview(playheadT);
    syncEditControls();
    trackChangeCallback?.(track);
  };

  // ---- rendering ---------------------------------------------------------
  const modeLabel = (mode: TimelineMode): string => {
    if (mode === 'track') return 'steer';
    if (mode === 'addressable') return 'frame';
    return 'live';
  };

  const applyProfile = (): void => {
    if (!currentSaver) return;
    currentProfile = buildTimelineProfile(currentSaver, seed, explicitTrack);
    const id = saverId();
    loadPersistedEdit(id);
    const owned = edits.get(id);
    // An owned track wins over the freshly derived one — otherwise every
    // re-selection would silently throw the user's edits away.
    if (owned && currentProfile.mode === 'track') {
      currentProfile.track = owned;
    }
    if (currentInstance?.applyTrack && currentProfile.mode === 'track') {
      currentInstance.applyTrack(currentProfile.track);
    }
    frameAll();
    refresh();
    syncPreview(playheadT);
  };

  const autoFitHeight = (): void => {
    const devView = section.closest('#view-dev') as HTMLElement | null;
    if (!devView) return;
    const laneCount = currentProfile?.lanes.length ?? 0;
    const ideal = 29 + 19 + laneCount * 21 + 4;
    const maxPx = Math.max(180, window.innerHeight * 0.2);
    devView.style.setProperty('--bottom', `${clamp(ideal, 140, maxPx)}px`);
  };

  const refresh = (): void => {
    if (!currentProfile || !currentSaver) return;
    renderTimeAxis();
    updateChannels();
    updateValues();
    autoFitHeight();
    modeBadge.textContent = modeLabel(currentProfile.mode);
    modeBadge.title =
      currentProfile.mode === 'track'
        ? 'Control-track parameters — scrub/play drives preview, keyframes are editable'
        : currentProfile.mode === 'addressable'
          ? 'Deterministic renderFrame(t) — scrub/play drives preview'
          : isPreviewDriven(currentInstance)
            ? 'Runtime animation — scrub/play drives preview'
            : 'Runtime animation — preview free-runs (timeline is indicative)';
    const dur = (currentProfile.duration / 1000).toFixed(1);
    trackInfo.textContent = `${currentSaver.manifest.label} · ${dur}s${currentProfile.loop ? ' · loop' : ''}`;
    syncEditControls();
    section.classList.toggle('tl-editable', currentProfile.mode === 'track');
  };

  /** Ruler + playhead — everything whose x depends on the view window. */
  const renderTimeAxis = (): void => {
    updateRuler();
    updateKeyPositions();
    updatePlayhead();
  };

  const updateRuler = (): void => {
    if (!currentProfile?.duration) {
      rulerTrack.innerHTML = '';
      return;
    }
    // Tick density follows the VISIBLE span, not the duration, so zooming in
    // produces finer marks instead of the same 5 labels stretched apart.
    const spanS = viewSpan() / 1000;
    const target = 8;
    const raw = spanS / target;
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? pow * 10;
    const decimals = step < 1 ? Math.min(2, Math.ceil(-Math.log10(step))) : 0;

    let html = '';
    for (let s = Math.ceil(viewStart / 1000 / step) * step; s <= viewEnd / 1000 + 1e-6; s += step) {
      const pct = tToPct(s * 1000);
      if (pct < -1 || pct > 101) continue;
      html += `<span class="tl-mark" style="left:${pct}%">${s.toFixed(decimals)}</span>`;
    }
    rulerTrack.innerHTML = html;
    rulerVal.textContent = `${(viewSpan() / 1000).toFixed(1)}s`;
  };

  const deltasForLane = (lane: TimelineLaneView): ParamDelta[] => {
    if (!currentProfile || lane.kind !== 'param') return [];
    return currentProfile.track.deltas.filter((d) => d.path === lane.key);
  };

  const updateChannels = (): void => {
    channelsEl.innerHTML = '';
    if (!currentProfile) return;
    const space = currentSaver?.manifest.paramSpace as ParamSpace | undefined;
    const editable = currentProfile.mode === 'track';

    for (const lane of currentProfile.lanes) {
      const row = document.createElement('div');
      row.className = 'tl-lane';
      row.dataset.lane = lane.key;
      if (selected?.path === lane.key) row.classList.add('is-selected');

      const label = document.createElement('span');
      label.className = 'tl-lane-label';
      label.textContent = lane.label;
      label.title = lane.hint ? `${lane.label} — ${lane.hint}` : lane.label;

      const track = document.createElement('div');
      track.className = 'tl-lane-track';
      track.dataset.lane = lane.key;
      if (editable && lane.kind === 'param') track.title = 'Double-click to add a keyframe';

      if (lane.kind === 'param' && space) {
        const sorted = [...deltasForLane(lane)].sort((a, b) => a.t - b.t);
        const def = space[lane.key]?.default;

        if (sorted.length === 0) {
          track.append(segment(0, 100, 'tl-segment-flat', `hold ${String(def ?? '')}`));
        } else if (sorted.length === 1) {
          track.append(segment(0, 100, '', `t=${sorted[0]!.t}ms v=${String(sorted[0]!.value)}`));
        } else {
          for (let i = 0; i < sorted.length - 1; i++) {
            const a = sorted[i]!;
            const b = sorted[i + 1]!;
            // Segment style carries the interpolation of the key it ramps INTO.
            track.append(
              segment(0, 0, `tl-segment-${b.ease ?? 'step'}`, `${a.t}→${b.t}ms · ${b.ease ?? 'step'}`, a.t, b.t),
            );
          }
        }

        for (const d of sorted) {
          const idx = currentProfile.track.deltas.indexOf(d);
          const dot = document.createElement('div');
          dot.className = `tl-keyframe tl-key-${d.ease ?? 'step'}`;
          dot.dataset.path = lane.key;
          dot.dataset.index = String(idx);
          dot.dataset.t = String(d.t);
          dot.tabIndex = editable ? 0 : -1;
          dot.title = editable
            ? `t=${d.t}ms v=${String(d.value)} ease=${d.ease ?? 'step'}\nDrag to retime · V edit value · E cycle ease · D duplicate · Del remove · right-click for menu`
            : `t=${d.t}ms v=${String(d.value)} ease=${d.ease ?? 'step'}`;
          if (selected?.path === lane.key && selected.index === idx) dot.classList.add('is-selected');
          track.append(dot);
        }
      } else if (lane.kind === 'playback') {
        track.append(segment(0, 100, 'tl-segment-playback', ''));
      } else if (lane.kind === 'motion') {
        track.append(segment(0, 100, 'tl-segment-motion', lane.hint ?? ''));
      }

      const val = document.createElement('span');
      val.className = 'tl-lane-value';
      val.dataset.lane = lane.key;
      val.textContent = '—';

      row.append(label, track, val);
      channelsEl.append(row);
    }
    updateKeyPositions();
  };

  /** Segments and keys carry their time in data-* so a view change repositions
   *  them without rebuilding the DOM. */
  function segment(
    _l: number,
    _w: number,
    cls: string,
    title: string,
    tFrom?: number,
    tTo?: number,
  ): HTMLElement {
    const seg = document.createElement('div');
    seg.className = `tl-segment ${cls}`.trim();
    if (title) seg.title = title;
    if (tFrom != null && tTo != null) {
      seg.dataset.from = String(tFrom);
      seg.dataset.to = String(tTo);
    } else {
      seg.dataset.full = '1';
    }
    return seg;
  }

  const updateKeyPositions = (): void => {
    for (const seg of channelsEl.querySelectorAll<HTMLElement>('.tl-segment')) {
      if (seg.dataset.full) {
        seg.style.left = '0%';
        seg.style.width = '100%';
        continue;
      }
      const l = tToPct(Number(seg.dataset.from));
      const r = tToPct(Number(seg.dataset.to));
      seg.style.left = `${l}%`;
      seg.style.width = `${Math.max(0, r - l)}%`;
    }
    for (const dot of channelsEl.querySelectorAll<HTMLElement>('.tl-keyframe')) {
      const t = Number(dot.dataset.t);
      dot.style.left = `${tToPct(t)}%`;
      dot.hidden = !inView(t);
    }
  };

  const updatePlayhead = (): void => {
    if (!currentProfile?.duration) return;
    const pct = tToPct(playheadT);
    playheadEl.style.left = `${pct}%`;
    playheadEl.hidden = pct < -1 || pct > 101;
    if (document.activeElement !== timeInput) {
      timeInput.value = (playheadT / 1000).toFixed(2);
    }
    durationEl.textContent = `/ ${(currentProfile.duration / 1000).toFixed(1)}s`;
  };

  const syncPreview = (t: number): void => {
    if (!currentProfile || !currentInstance) return;
    syncPreviewTime(currentInstance, t, currentProfile.seed, currentProfile.duration, currentProfile.loop);
  };

  const updateValues = (): void => {
    if (!currentProfile || !currentSaver) return;
    const space = currentSaver.manifest.paramSpace as ParamSpace | undefined;
    const dur = currentProfile.duration;

    channelsEl.querySelectorAll<HTMLElement>('.tl-lane-value').forEach((el) => {
      const key = el.dataset.lane!;
      const lane = currentProfile!.lanes.find((l) => l.key === key);
      if (!lane) return;
      if (lane.kind === 'param' && space) {
        const v = sampleTrack(space, currentProfile!.track, playheadT)[key];
        if (v !== undefined) {
          const text = typeof v === 'number' ? v.toFixed(3) : String(v);
          el.textContent = text;
          el.title = `${key} = ${text} at ${(playheadT / 1000).toFixed(2)}s`;
        }
      } else if (lane.kind === 'playback') {
        el.textContent = `${Math.round((playheadT / dur) * 100)}%`;
      } else if (lane.kind === 'motion') {
        el.textContent = lane.hint ?? '—';
      }
    });
  };

  // ---- scrubbing ---------------------------------------------------------
  let timeChangeCallback: ((t: number) => void) | null = null;
  let playingChangeCallback: ((p: boolean) => void) | null = null;
  let trackChangeCallback: ((track: ControlTrack) => void) | null = null;

  const scrubTo = (t: number): void => {
    const dur = currentProfile?.duration ?? 0;
    playheadT = clamp(t, 0, dur);
    updatePlayhead();
    updateValues();
    syncPreview(playheadT);
    timeChangeCallback?.(playheadT);
  };

  /** x → time, using the track column geometry (not the whole panel). */
  const timeAtClientX = (clientX: number): number => {
    const ref = channelsEl.querySelector('.tl-lane-track') ?? rulerTrack;
    const rect = ref.getBoundingClientRect();
    if (!rect.width) return 0;
    const x = clamp((clientX - rect.left) / rect.width, 0, 1);
    return viewStart + x * viewSpan();
  };

  /**
   * Scrub only from the ruler and the lane TRACKS. Previously any mousedown in
   * the panel scrubbed, so clicking a channel name — the natural way to select
   * one — yanked the playhead instead.
   */
  const beginScrub = (e: PointerEvent): void => {
    if (!currentProfile?.duration) return;
    if (playing) stopPlay();
    scrubTo(timeAtClientX(e.clientX));
    const move = (ev: PointerEvent): void => scrubTo(timeAtClientX(ev.clientX));
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  rulerTrack.addEventListener('pointerdown', beginScrub);
  channelsEl.addEventListener('pointerdown', (e) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains('tl-keyframe')) return; // key drag owns this
    const laneTrack = target.closest('.tl-lane-track');
    if (laneTrack) {
      beginScrub(e);
      return;
    }
    // Clicking a channel name selects the channel rather than scrubbing.
    const row = target.closest<HTMLElement>('.tl-lane');
    if (row?.dataset.lane) {
      selected = { path: row.dataset.lane, index: -1 };
      updateChannels();
    }
  });

  // ---- keyframe editing --------------------------------------------------
  channelsEl.addEventListener('pointerdown', (e) => {
    const dot = (e.target as HTMLElement).closest<HTMLElement>('.tl-keyframe');
    if (!dot || currentProfile?.mode !== 'track') return;
    e.stopPropagation();
    e.preventDefault();

    const path = dot.dataset.path!;
    const index = Number(dot.dataset.index);
    selected = { path, index };
    channelsEl.querySelectorAll('.tl-keyframe.is-selected').forEach((n) => n.classList.remove('is-selected'));
    dot.classList.add('is-selected');
    scrubTo(Number(dot.dataset.t));

    const track = ownTrack();
    const delta = track?.deltas[index];
    if (!track || !delta) return;

    let moved = false;
    const move = (ev: PointerEvent): void => {
      moved = true;
      const raw = timeAtClientX(ev.clientX);
      const snapped = ev.shiftKey ? raw : Math.round(raw / SNAP_MS) * SNAP_MS;
      delta.t = clamp(Math.round(snapped), 0, currentProfile!.duration);
      dot.dataset.t = String(delta.t);
      dot.style.left = `${tToPct(delta.t)}%`;
      scrubTo(delta.t);
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (moved) commitEdit(track);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });

  /** Double-click an empty spot on a param lane to key the current value there. */
  channelsEl.addEventListener('dblclick', (e) => {
    if (currentProfile?.mode !== 'track') return;
    if ((e.target as HTMLElement).closest('.tl-keyframe')) return;
    const laneTrack = (e.target as HTMLElement).closest<HTMLElement>('.tl-lane-track');
    if (!laneTrack?.dataset.lane) return;
    const space = currentSaver?.manifest.paramSpace as ParamSpace | undefined;
    if (!space?.[laneTrack.dataset.lane]) return;

    const track = ownTrack();
    if (!track) return;
    const path = laneTrack.dataset.lane;
    const t = clamp(Math.round(timeAtClientX(e.clientX) / SNAP_MS) * SNAP_MS, 0, currentProfile.duration);
    const value = sampleTrack(space, track, t)[path] ?? space[path]!.default;
    track.deltas.push({ t, path, value, ease: space[path]!.ease ?? 'linear' });
    commitEdit(track);
    scrubTo(t);
  });

  const removeSelectedKey = (): void => {
    if (!selected || selected.index < 0 || currentProfile?.mode !== 'track') return;
    const track = ownTrack();
    const delta = track?.deltas[selected.index];
    if (!track || !delta || delta.path !== selected.path) return;
    track.deltas.splice(selected.index, 1);
    selected = null;
    commitEdit(track);
  };

  const cycleSelectedEase = (): void => {
    if (!selected || selected.index < 0 || currentProfile?.mode !== 'track') return;
    const track = ownTrack();
    const delta = track?.deltas[selected.index];
    if (!track || !delta) return;
    delta.ease = EASES[(EASES.indexOf(delta.ease ?? 'step') + 1) % EASES.length];
    commitEdit(track);
  };

  /** Prompt-edit a delta's value, reused by context menu, double-click, V key. */
  const editDeltaValue = (path: string, index: number): void => {
    const track = ownTrack();
    if (!track) return;
    const space = currentSaver?.manifest.paramSpace as ParamSpace | undefined;
    const def = space?.[path];
    if (!def) return;
    const delta = track.deltas[index];
    if (!delta) return;
    const current = String(delta.value);
    const next = window.prompt(`${path} value`, current);
    if (next == null) return;
    const value = def.type === 'number' ? Number(next) : def.type === 'bool' ? next === 'true' : next;
    if (def.type === 'number' && Number.isNaN(value as number)) return;
    delta.value = value;
    commitEdit(track);
  };

  /** Prompt-edit a delta's time. */
  const editDeltaTime = (index: number): void => {
    const track = ownTrack();
    if (!track) return;
    const delta = track.deltas[index];
    if (!delta) return;
    const current = String(delta.t);
    const next = window.prompt('Time (ms)', current);
    if (next == null) return;
    const t = Math.round(Number(next));
    if (Number.isNaN(t) || t < 0) return;
    delta.t = clamp(t, 0, currentProfile?.duration ?? t);
    commitEdit(track);
    scrubTo(delta.t);
  };

  /** Duplicate a delta, offset by 500ms. */
  const duplicateDelta = (index: number): void => {
    const track = ownTrack();
    if (!track) return;
    const delta = track.deltas[index];
    if (!delta) return;
    const dur = currentProfile?.duration ?? 0;
    const newT = clamp(delta.t + 500, 0, dur);
    track.deltas.push({ ...structuredClone(delta), t: newT });
    selected = { path: delta.path, index: track.deltas.length - 1 };
    commitEdit(track);
    scrubTo(newT);
  };

  /** Edit the selected key's value (V key or context menu). */
  const editSelectedValue = (): void => {
    if (!selected || selected.index < 0 || currentProfile?.mode !== 'track') return;
    editDeltaValue(selected.path, selected.index);
  };

  // ---- context menu -------------------------------------------------------
  let ctxMenu: HTMLElement | null = null;

  const closeContextMenu = (): void => {
    ctxMenu?.remove();
    ctxMenu = null;
  };

  const ctxItem = (label: string, shortcut: string, action: () => void, danger = false): HTMLButtonElement => {
    const btn = document.createElement('button');
    btn.type = 'button';
    if (danger) btn.className = 'tl-ctx-danger';
    if (shortcut) {
      const sc = document.createElement('span');
      sc.className = 'tl-ctx-shortcut';
      sc.textContent = shortcut;
      btn.append(label, sc);
    } else {
      btn.textContent = label;
    }
    btn.addEventListener('click', () => { closeContextMenu(); action(); });
    return btn;
  };

  const showContextMenu = (x: number, y: number, path: string, index: number): void => {
    closeContextMenu();
    const menu = document.createElement('div');
    menu.className = 'tl-context-menu';

    const track = ownTrack();
    const delta = track?.deltas[index];
    const ease = delta?.ease ?? 'step';

    menu.append(
      ctxItem('Edit value…', 'V', () => editDeltaValue(path, index)),
      ctxItem('Edit time…', '', () => editDeltaTime(index)),
    );

    const hr1 = document.createElement('hr');
    menu.append(hr1);

    for (const e of EASES) {
      const label = e === ease ? `✓ Ease: ${e}` : `  Ease: ${e}`;
      menu.append(ctxItem(label, e === ease ? 'E' : '', () => {
        if (!track || !delta) return;
        delta.ease = e;
        commitEdit(track);
      }));
    }

    const hr2 = document.createElement('hr');
    menu.append(hr2);
    menu.append(ctxItem('Duplicate', 'D', () => duplicateDelta(index)));
    menu.append(ctxItem('Delete', 'Del', () => {
      selected = { path, index };
      removeSelectedKey();
    }, true));

    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    document.body.append(menu);

    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = `${x - rect.width}px`;
    if (rect.bottom > window.innerHeight) menu.style.top = `${y - rect.height}px`;

    ctxMenu = menu;
  };

  document.addEventListener('pointerdown', (e) => {
    if (ctxMenu && !ctxMenu.contains(e.target as Node)) closeContextMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && ctxMenu) { closeContextMenu(); e.stopPropagation(); }
  }, true);

  channelsEl.addEventListener('contextmenu', (e) => {
    if (currentProfile?.mode !== 'track') return;

    const dot = (e.target as HTMLElement).closest<HTMLElement>('.tl-keyframe');
    if (dot) {
      e.preventDefault();
      const path = dot.dataset.path!;
      const index = Number(dot.dataset.index);
      selected = { path, index };
      channelsEl.querySelectorAll('.tl-keyframe.is-selected').forEach((n) => n.classList.remove('is-selected'));
      dot.classList.add('is-selected');
      showContextMenu(e.clientX, e.clientY, path, index);
      return;
    }

    const laneTrack = (e.target as HTMLElement).closest<HTMLElement>('.tl-lane-track');
    if (laneTrack?.dataset.lane) {
      e.preventDefault();
      const space = currentSaver?.manifest.paramSpace as ParamSpace | undefined;
      const path = laneTrack.dataset.lane;
      if (!space?.[path]) return;
      const track = ownTrack();
      if (!track) return;
      const t = clamp(Math.round(timeAtClientX(e.clientX) / SNAP_MS) * SNAP_MS, 0, currentProfile.duration);
      const value = sampleTrack(space, track, t)[path] ?? space[path]!.default;

      const menu = document.createElement('div');
      menu.className = 'tl-context-menu';
      menu.append(ctxItem(`Add keyframe at ${(t / 1000).toFixed(2)}s`, '', () => {
        track.deltas.push({ t, path, value, ease: space[path]!.ease ?? 'linear' });
        commitEdit(track);
        scrubTo(t);
      }));
      menu.style.left = `${e.clientX}px`;
      menu.style.top = `${e.clientY}px`;
      document.body.append(menu);
      const rect = menu.getBoundingClientRect();
      if (rect.right > window.innerWidth) menu.style.left = `${e.clientX - rect.width}px`;
      if (rect.bottom > window.innerHeight) menu.style.top = `${e.clientY - rect.height}px`;
      ctxMenu = menu;
    }
  });

  /** Double-click a keyframe dot to edit its value. */
  channelsEl.addEventListener('dblclick', (e) => {
    const dot = (e.target as HTMLElement).closest<HTMLElement>('.tl-keyframe');
    if (dot && currentProfile?.mode === 'track') {
      e.stopPropagation();
      editDeltaValue(dot.dataset.path!, Number(dot.dataset.index));
      return;
    }

    const cell = (e.target as HTMLElement).closest<HTMLElement>('.tl-lane-value');
    if (!cell || currentProfile?.mode !== 'track') return;
    const path = cell.dataset.lane!;
    const track = ownTrack();
    if (!track) return;
    const at = track.deltas.findIndex((d) => d.path === path && Math.abs(d.t - playheadT) < 1);
    const current = cell.textContent ?? '';
    const next = window.prompt(`${path} at ${(playheadT / 1000).toFixed(2)}s`, current);
    if (next == null) return;
    const space = currentSaver?.manifest.paramSpace as ParamSpace | undefined;
    const def = space?.[path];
    if (!def) return;
    const value = def.type === 'number' ? Number(next) : def.type === 'bool' ? next === 'true' : next;
    if (def.type === 'number' && Number.isNaN(value as number)) return;
    if (at >= 0) track.deltas[at]!.value = value;
    else track.deltas.push({ t: Math.round(playheadT), path, value, ease: def.ease ?? 'linear' });
    commitEdit(track);
  });

  // ---- keyframe navigation ----------------------------------------------
  const keyTimes = (): number[] => {
    if (!currentProfile) return [];
    const src = selected?.path
      ? currentProfile.track.deltas.filter((d) => d.path === selected!.path)
      : currentProfile.track.deltas;
    return [...new Set(src.map((d) => d.t))].sort((a, b) => a - b);
  };

  const jumpKey = (dir: 1 | -1): void => {
    const times = keyTimes();
    if (!times.length) return;
    stopPlay();
    const next =
      dir > 0 ? times.find((t) => t > playheadT + 0.5) : [...times].reverse().find((t) => t < playheadT - 0.5);
    if (next != null) scrubTo(next);
  };

  // ---- zoom / pan --------------------------------------------------------
  // A plain vertical wheel must stay a SCROLL: a saver with more params than
  // fit (tide has 14 lanes) is otherwise unreachable, because preventDefault
  // here stops the event from ever reaching the dock's scroll container.
  // Time panning takes the horizontal gesture (trackpad, or shift+wheel).
  trackArea.addEventListener(
    'wheel',
    (e) => {
      if (!currentProfile?.duration) return;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        zoomAbout(timeAtClientX(e.clientX), e.deltaY > 0 ? 1.15 : 1 / 1.15);
        return;
      }
      const pan = e.shiftKey
        ? e.deltaX || e.deltaY
        : Math.abs(e.deltaX) > Math.abs(e.deltaY)
          ? e.deltaX
          : 0;
      if (pan === 0) return; // plain vertical wheel — let the lane list scroll
      e.preventDefault();
      const by = pan * (viewSpan() / 600);
      setView(viewStart + by, viewEnd + by);
    },
    { passive: false },
  );

  zoomInBtn.addEventListener('click', () => zoomAbout(playheadT, 1 / 1.4));
  zoomOutBtn.addEventListener('click', () => zoomAbout(playheadT, 1.4));
  frameAllBtn.addEventListener('click', frameAll);

  // ---- channel column resize --------------------------------------------
  gutter.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = parseFloat(getComputedStyle(section).getPropertyValue('--tl-label-w')) || 72;
    const move = (ev: PointerEvent): void => {
      section.style.setProperty('--tl-label-w', `${clamp(startW + ev.clientX - startX, 48, 260)}px`);
      renderTimeAxis();
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });

  // ---- transport ---------------------------------------------------------
  const tick = (now: number): void => {
    if (!playing || !currentProfile?.duration) return;
    let elapsed = now - startWall + startT;
    if (loopInput.checked) {
      elapsed = elapsed % currentProfile.duration;
    } else if (elapsed >= currentProfile.duration) {
      elapsed = currentProfile.duration;
      playing = false;
      playBtn.textContent = '▶';
    }
    playheadT = elapsed;
    updatePlayhead();
    updateValues();
    if (isPreviewDriven(currentInstance) || currentProfile.mode !== 'live') syncPreview(elapsed);
    timeChangeCallback?.(elapsed);
    if (playing) rafId = requestAnimationFrame(tick);
  };

  const stopPlay = (): void => {
    const was = playing;
    playing = false;
    cancelAnimationFrame(rafId);
    playBtn.textContent = '▶';
    if (was) playingChangeCallback?.(false);
    startT = playheadT;
    if (!isPreviewDriven(currentInstance)) currentInstance?.setPaused(true);
  };

  const startPlay = (): void => {
    if (!currentProfile?.duration || !currentInstance) return;
    playing = true;
    playBtn.textContent = '⏸';
    playingChangeCallback?.(true);
    startT = playheadT;
    startWall = performance.now();
    if (isPreviewDriven(currentInstance) || currentProfile.mode !== 'live') {
      currentInstance.setPaused(true);
      syncPreview(playheadT);
    } else {
      currentInstance.setPaused(false);
    }
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(tick);
  };

  const togglePlay = (): void => {
    if (!currentProfile?.duration) return;
    if (playing) stopPlay();
    else startPlay();
  };

  playBtn.addEventListener('click', togglePlay);
  startBtn.addEventListener('click', () => { stopPlay(); scrubTo(0); });
  endBtn.addEventListener('click', () => { stopPlay(); scrubTo(currentProfile?.duration ?? 0); });
  prevKeyBtn.addEventListener('click', () => jumpKey(-1));
  nextKeyBtn.addEventListener('click', () => jumpKey(1));

  timeInput.addEventListener('change', () => {
    const s = Number(timeInput.value);
    stopPlay();
    if (!Number.isNaN(s)) scrubTo(s * 1000);
    // `updatePlayhead` leaves the field alone while it has focus so it can't
    // fight mid-typing; once committed, show the canonical value.
    timeInput.value = (playheadT / 1000).toFixed(2);
  });

  exportBtn.addEventListener('click', () => {
    if (!currentProfile) return;
    const blob = new Blob([JSON.stringify(currentProfile.track, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentProfile.track.program}-track.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  resetBtn.addEventListener('click', () => {
    const id = saverId();
    edits.delete(id);
    try {
      localStorage.removeItem(EDIT_STORAGE + id);
    } catch { /* ignore */ }
    selected = null;
    applyProfile();
  });

  // ---- keyboard ----------------------------------------------------------
  section.addEventListener('keydown', (e) => {
    if (e.target === timeInput) return; // let the field own its keys
    const step = e.shiftKey ? STEP_MS * 5 : STEP_MS;
    switch (e.key) {
      case ' ': e.preventDefault(); togglePlay(); break;
      case 'ArrowLeft': e.preventDefault(); stopPlay(); scrubTo(playheadT - step); break;
      case 'ArrowRight': e.preventDefault(); stopPlay(); scrubTo(playheadT + step); break;
      case 'ArrowUp': e.preventDefault(); jumpKey(-1); break;
      case 'ArrowDown': e.preventDefault(); jumpKey(1); break;
      case 'Home': e.preventDefault(); stopPlay(); scrubTo(0); break;
      case 'End': e.preventDefault(); stopPlay(); scrubTo(currentProfile?.duration ?? 0); break;
      case 'f': case 'F': e.preventDefault(); frameAll(); break;
      case '+': case '=': e.preventDefault(); zoomAbout(playheadT, 1 / 1.4); break;
      case '-': case '_': e.preventDefault(); zoomAbout(playheadT, 1.4); break;
      case 'e': case 'E': e.preventDefault(); cycleSelectedEase(); break;
      case 'v': case 'V': e.preventDefault(); editSelectedValue(); break;
      case 'd': case 'D':
        e.preventDefault();
        if (selected && selected.index >= 0) duplicateDelta(selected.index);
        break;
      case 'Delete': case 'Backspace': e.preventDefault(); removeSelectedKey(); break;
      default: break;
    }
  });

  // The playhead and keys are positioned as percentages of the track column,
  // so a resize only needs a reposition — no pixel math to redo.
  const ro = new ResizeObserver(() => renderTimeAxis());
  ro.observe(trackArea);

  return {
    setSaver(saver, instance, nextSeed = 42) {
      const sameSaver = currentSaver?.manifest.id === saver.manifest.id;
      currentSaver = saver;
      currentInstance = instance;
      seed = nextSeed >>> 0 || 1;
      if (explicitTrack && explicitTrack.program !== saver.manifest.id) explicitTrack = null;
      stopPlay();
      if (!sameSaver) {
        playheadT = 0;
        selected = null;
        timeChangeCallback?.(0);
      }
      applyProfile();
      if (instance) startPlay();
    },

    loadTrack(track) {
      explicitTrack = track;
      playheadT = 0;
      selected = null;
      stopPlay();
      timeChangeCallback?.(0);
      applyProfile();
      if (currentInstance) startPlay();
    },

    setParam(path: string, value: ParamValue) {
      if (!currentProfile || currentProfile.mode !== 'track') return;
      const track = ownTrack();
      if (!track) return;
      const space = currentSaver?.manifest.paramSpace as ParamSpace | undefined;
      if (!space?.[path]) return;
      const existing = track.deltas.find((d) => d.path === path && d.t === playheadT);
      if (existing) {
        existing.value = value;
      } else {
        track.deltas.push({ t: playheadT, path, value, ease: space[path]!.ease ?? 'step' });
      }
      commitEdit(track);
    },

    currentTime: () => playheadT,

    togglePlay,
    isPlaying: () => playing,

    get onTimeChange() { return timeChangeCallback; },
    set onTimeChange(cb: ((t: number) => void) | null) { timeChangeCallback = cb; },
    get onPlayingChange() { return playingChangeCallback; },
    set onPlayingChange(cb: ((p: boolean) => void) | null) { playingChangeCallback = cb; },
    get onTrackChange() { return trackChangeCallback; },
    set onTrackChange(cb: ((track: ControlTrack) => void) | null) { trackChangeCallback = cb; },
  };
}
