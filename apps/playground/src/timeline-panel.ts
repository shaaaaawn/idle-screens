import type { ControlTrack, ParamSpace, SaverPlugin, SaverInstance } from '@idle-screens/core';
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

  const section = document.createElement('section');
  section.className = 'timeline-panel';

  const transport = document.createElement('div');
  transport.className = 'tl-transport';

  const playBtn = document.createElement('button');
  playBtn.className = 'tl-btn';
  playBtn.textContent = '▶';
  playBtn.title = 'Play / pause preview';

  const timeDisplay = document.createElement('span');
  timeDisplay.className = 'tl-time';
  timeDisplay.textContent = '0.0s / 6.0s';

  const loopCheck = document.createElement('label');
  loopCheck.className = 'tl-loop';
  const loopInput = document.createElement('input');
  loopInput.type = 'checkbox';
  loopInput.checked = true;
  loopCheck.append(loopInput, ' Loop');

  const modeBadge = document.createElement('span');
  modeBadge.className = 'tl-mode';

  const trackInfo = document.createElement('span');
  trackInfo.className = 'tl-track-info';

  transport.append(playBtn, timeDisplay, loopCheck, modeBadge, trackInfo);

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

  const playheadEl = document.createElement('div');
  playheadEl.className = 'tl-playhead';

  trackArea.append(rulerRow, channelsEl, playheadEl);
  section.append(transport, trackArea);
  mount.append(section);

  const modeLabel = (mode: TimelineMode): string => {
    if (mode === 'track') return 'steer';
    if (mode === 'addressable') return 'frame';
    return 'live';
  };

  const applyProfile = (): void => {
    if (!currentSaver) return;
    currentProfile = buildTimelineProfile(currentSaver, seed, explicitTrack);
    if (currentInstance?.applyTrack && currentProfile.mode === 'track') {
      currentInstance.applyTrack(currentProfile.track);
    }
    refresh();
    syncPreview(playheadT);
  };

  const refresh = (): void => {
    if (!currentProfile || !currentSaver) return;
    updateRuler();
    updateChannels();
    updatePlayhead();
    updateValues();
    modeBadge.textContent = modeLabel(currentProfile.mode);
    modeBadge.title =
      currentProfile.mode === 'track'
        ? 'Control-track parameters — scrub/play drives preview'
        : currentProfile.mode === 'addressable'
          ? 'Deterministic renderFrame(t) — scrub/play drives preview'
          : isPreviewDriven(currentInstance)
            ? 'Runtime animation — scrub/play drives preview'
            : 'Runtime animation — preview free-runs (timeline is indicative)';
    const dur = (currentProfile.duration / 1000).toFixed(1);
    trackInfo.textContent = `${currentSaver.manifest.label} · ${dur}s${currentProfile.loop ? ' · loop' : ''}`;
  };

  const updateRuler = (): void => {
    const dur = (currentProfile?.duration ?? 0) / 1000;
    if (!dur) {
      rulerTrack.innerHTML = '';
      return;
    }
    const step = dur <= 3 ? 0.5 : dur <= 10 ? 1 : 5;
    let html = '';
    for (let s = 0; s <= dur + 0.001; s += step) {
      const pct = (s / dur) * 100;
      html += `<span class="tl-mark" style="left:${pct}%">${s.toFixed(step < 1 ? 1 : 0)}</span>`;
    }
    rulerTrack.innerHTML = html;
  };

  const deltasForLane = (lane: TimelineLaneView): ControlTrack['deltas'] => {
    if (!currentProfile) return [];
    if (lane.kind !== 'param') return [];
    return currentProfile.track.deltas.filter((d) => d.path === lane.key);
  };

  const updateChannels = (): void => {
    channelsEl.innerHTML = '';
    if (!currentProfile) return;

    const dur = currentProfile.duration;
    const space = currentSaver?.manifest.paramSpace as ParamSpace | undefined;

    for (const lane of currentProfile.lanes) {
      const row = document.createElement('div');
      row.className = 'tl-lane';

      const label = document.createElement('span');
      label.className = 'tl-lane-label';
      label.textContent = lane.label;
      if (lane.hint) label.title = lane.hint;

      const track = document.createElement('div');
      track.className = 'tl-lane-track';

      if (lane.kind === 'param' && space) {
        const sorted = [...deltasForLane(lane)].sort((a, b) => a.t - b.t);
        const def = space[lane.key]?.default;

        if (sorted.length === 0) {
          const seg = document.createElement('div');
          seg.className = 'tl-segment tl-segment-flat';
          seg.style.left = '0%';
          seg.style.width = '100%';
          seg.title = `hold ${String(def ?? '')}`;
          track.append(seg);
        } else if (sorted.length === 1) {
          const seg = document.createElement('div');
          seg.className = 'tl-segment';
          seg.style.left = '0%';
          seg.style.width = '100%';
          seg.title = `t=${sorted[0]!.t}ms v=${sorted[0]!.value}`;
          track.append(seg);
        } else {
          for (let i = 0; i < sorted.length - 1; i++) {
            const seg = document.createElement('div');
            seg.className = 'tl-segment';
            const l = (sorted[i]!.t / dur) * 100;
            const r = (sorted[i + 1]!.t / dur) * 100;
            seg.style.left = `${l}%`;
            seg.style.width = `${r - l}%`;
            track.append(seg);
          }
        }

        for (const d of sorted) {
          const dot = document.createElement('div');
          dot.className = 'tl-keyframe';
          dot.style.left = `${(d.t / dur) * 100}%`;
          dot.title = `t=${d.t}ms v=${d.value} ease=${d.ease ?? 'step'}`;
          track.append(dot);
        }
      } else if (lane.kind === 'playback') {
        const seg = document.createElement('div');
        seg.className = 'tl-segment tl-segment-playback';
        seg.style.left = '0%';
        seg.style.width = '100%';
        track.append(seg);
      } else if (lane.kind === 'motion') {
        const seg = document.createElement('div');
        seg.className = 'tl-segment tl-segment-motion';
        seg.style.left = '0%';
        seg.style.width = '100%';
        seg.title = lane.hint ?? '';
        track.append(seg);
      }

      const val = document.createElement('span');
      val.className = 'tl-lane-value';
      val.dataset.lane = lane.key;
      val.textContent = '—';

      row.append(label, track, val);
      channelsEl.append(row);
    }
  };

  const updatePlayhead = (): void => {
    const dur = currentProfile?.duration;
    if (!dur) return;
    const firstTrack = channelsEl.querySelector('.tl-lane-track') ?? rulerTrack;
    const areaRect = trackArea.getBoundingClientRect();
    const trackRect = firstTrack.getBoundingClientRect();
    const offset = trackRect.left - areaRect.left;
    const px = offset + (playheadT / dur) * trackRect.width;
    playheadEl.style.left = `${px}px`;
    timeDisplay.textContent = `${(playheadT / 1000).toFixed(1)}s / ${(dur / 1000).toFixed(1)}s`;
  };

  const syncPreview = (t: number): void => {
    if (!currentProfile || !currentInstance) return;
    syncPreviewTime(
      currentInstance,
      t,
      currentProfile.seed,
      currentProfile.duration,
      currentProfile.loop,
    );
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
          el.textContent = typeof v === 'number' ? v.toFixed(3) : String(v);
        }
      } else if (lane.kind === 'playback') {
        el.textContent = `${Math.round((playheadT / dur) * 100)}%`;
      } else if (lane.kind === 'motion') {
        el.textContent = lane.hint ?? '—';
      }
    });
  };

  const scrubTo = (t: number): void => {
    playheadT = t;
    updatePlayhead();
    updateValues();
    syncPreview(t);
  };

  const scrubFromEvent = (e: MouseEvent): void => {
    const ref = channelsEl.querySelector('.tl-lane-track') ?? rulerTrack;
    const dur = currentProfile?.duration;
    if (!ref || !dur) return;
    const rect = ref.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    scrubTo(x * dur);
  };

  trackArea.addEventListener('mousedown', (e) => {
    if (playing) {
      playing = false;
      cancelAnimationFrame(rafId);
      playBtn.textContent = '▶';
    }
    scrubFromEvent(e);
    const onMove = (ev: MouseEvent): void => scrubFromEvent(ev);
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });

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
    if (isPreviewDriven(currentInstance) || currentProfile.mode !== 'live') {
      syncPreview(elapsed);
    }
    if (playing) rafId = requestAnimationFrame(tick);
  };

  const stopPlay = (): void => {
    playing = false;
    cancelAnimationFrame(rafId);
    playBtn.textContent = '▶';
    startT = playheadT;
    if (!isPreviewDriven(currentInstance)) currentInstance?.setPaused(true);
  };

  const startPlay = (): void => {
    if (!currentProfile?.duration || !currentInstance) return;
    playing = true;
    playBtn.textContent = '⏸';
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

  playBtn.addEventListener('click', () => {
    if (!currentProfile?.duration) return;
    if (playing) stopPlay();
    else startPlay();
  });

  return {
    setSaver(saver, instance, nextSeed = 42) {
      const sameSaver = currentSaver?.manifest.id === saver.manifest.id;
      currentSaver = saver;
      currentInstance = instance;
      seed = nextSeed >>> 0 || 1;
      if (explicitTrack && explicitTrack.program !== saver.manifest.id) {
        explicitTrack = null;
      }
      stopPlay();
      if (!sameSaver) playheadT = 0;
      applyProfile();
      if (instance) startPlay();
    },

    loadTrack(track) {
      explicitTrack = track;
      playheadT = 0;
      stopPlay();
      applyProfile();
      if (currentInstance) startPlay();
    },
  };
}
