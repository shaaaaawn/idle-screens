import type {
  ControlTrack,
  ParamSpace,
  SaverPlugin,
  SaverInstance,
} from '@idle-screens/core';
import { sampleTrack } from '@idle-screens/core';

export interface TimelineHandle {
  setSaver(saver: SaverPlugin, instance: SaverInstance | null): void;
  loadTrack(track: ControlTrack): void;
}

export function buildTimelinePanel(mount: HTMLElement): TimelineHandle {
  let currentSaver: SaverPlugin | null = null;
  let currentInstance: SaverInstance | null = null;
  let currentTrack: ControlTrack | null = null;
  let playheadT = 0;
  let playing = false;
  let rafId = 0;
  let startWall = 0;
  let startT = 0;

  const section = document.createElement('section');
  section.className = 'timeline-panel';

  const transport = document.createElement('div');
  transport.className = 'tl-transport';

  const playBtn = document.createElement('button');
  playBtn.className = 'tl-btn';
  playBtn.textContent = '▶';

  const timeDisplay = document.createElement('span');
  timeDisplay.className = 'tl-time';
  timeDisplay.textContent = '0.0s / --';

  const loopCheck = document.createElement('label');
  loopCheck.className = 'tl-loop';
  const loopInput = document.createElement('input');
  loopInput.type = 'checkbox';
  loopInput.checked = true;
  loopCheck.append(loopInput, ' Loop');

  const trackInfo = document.createElement('span');
  trackInfo.className = 'tl-track-info';
  trackInfo.textContent = 'No track loaded';

  transport.append(playBtn, timeDisplay, loopCheck, trackInfo);

  const trackArea = document.createElement('div');
  trackArea.className = 'tl-track-area';

  const rulerRow = document.createElement('div');
  rulerRow.className = 'tl-ruler';
  const rulerLabel = document.createElement('span');
  rulerLabel.className = 'tl-ruler-label';
  const rulerTrack = document.createElement('div');
  rulerTrack.className = 'tl-ruler-track';
  const rulerVal = document.createElement('span');
  rulerRow.append(rulerLabel, rulerTrack, rulerVal);

  const channelsEl = document.createElement('div');
  channelsEl.className = 'tl-channels';

  const playheadEl = document.createElement('div');
  playheadEl.className = 'tl-playhead';

  trackArea.append(rulerRow, channelsEl, playheadEl);

  const emptyEl = document.createElement('div');
  emptyEl.className = 'tl-empty';
  emptyEl.textContent = 'Select a saver with paramSpace to see the timeline';

  section.append(transport, trackArea, emptyEl);
  mount.append(section);

  // ---- ruler ----
  const updateRuler = (): void => {
    const dur = (currentTrack?.duration ?? 0) / 1000;
    if (!dur) { rulerTrack.innerHTML = ''; return; }
    const step = dur <= 3 ? 0.5 : dur <= 10 ? 1 : 5;
    let html = '';
    for (let s = 0; s <= dur + 0.001; s += step) {
      const pct = (s / dur) * 100;
      html += `<span class="tl-mark" style="left:${pct}%">${s.toFixed(step < 1 ? 1 : 0)}s</span>`;
    }
    rulerTrack.innerHTML = html;
  };

  // ---- channels ----
  const updateChannels = (): void => {
    channelsEl.innerHTML = '';
    const space = currentSaver?.manifest.paramSpace as ParamSpace | undefined;
    if (!space || !currentTrack) { return; }

    const dur = currentTrack.duration ?? 6000;
    const byPath = new Map<string, ControlTrack['deltas']>();
    for (const d of currentTrack.deltas) {
      const arr = byPath.get(d.path) ?? [];
      arr.push(d);
      byPath.set(d.path, arr);
    }

    for (const [key, def] of Object.entries(space)) {
      const lane = document.createElement('div');
      lane.className = 'tl-lane';

      const label = document.createElement('span');
      label.className = 'tl-lane-label';
      label.textContent = key;
      label.title = `${def.type} default: ${def.default}`;

      const track = document.createElement('div');
      track.className = 'tl-lane-track';

      const deltas = byPath.get(key) ?? [];
      const sorted = [...deltas].sort((a, b) => a.t - b.t);

      if (sorted.length >= 2) {
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
        dot.title = `t=${d.t}ms  v=${d.value}  ease=${d.ease ?? 'step'}`;
        track.append(dot);
      }

      const val = document.createElement('span');
      val.className = 'tl-lane-value';
      val.dataset.param = key;
      val.textContent = String(def.default);

      lane.append(label, track, val);
      channelsEl.append(lane);
    }
  };

  // ---- playhead ----
  const updatePlayhead = (): void => {
    const dur = currentTrack?.duration;
    if (!dur) return;
    const firstTrack = channelsEl.querySelector('.tl-lane-track') ?? rulerTrack;
    const areaRect = trackArea.getBoundingClientRect();
    const trackRect = firstTrack.getBoundingClientRect();
    const offset = trackRect.left - areaRect.left;
    const px = offset + (playheadT / dur) * trackRect.width;
    playheadEl.style.left = `${px}px`;
    timeDisplay.textContent = `${(playheadT / 1000).toFixed(1)}s / ${(dur / 1000).toFixed(1)}s`;
  };

  // ---- values ----
  const updateValues = (): void => {
    const space = currentSaver?.manifest.paramSpace as ParamSpace | undefined;
    if (!space || !currentTrack) return;
    const vals = sampleTrack(space, currentTrack, playheadT);
    channelsEl.querySelectorAll<HTMLElement>('.tl-lane-value').forEach((el) => {
      const v = vals[el.dataset.param!];
      if (v !== undefined) el.textContent = typeof v === 'number' ? v.toFixed(3) : String(v);
    });
  };

  // ---- scrub ----
  const scrubTo = (t: number): void => {
    playheadT = t;
    updatePlayhead();
    updateValues();
    if (currentInstance?.renderFrame && currentTrack) {
      currentInstance.renderFrame(t, currentTrack.seed);
    }
  };

  const scrubFromEvent = (e: MouseEvent): void => {
    const ref = channelsEl.querySelector('.tl-lane-track') ?? rulerTrack;
    const dur = currentTrack?.duration;
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
    currentInstance?.setPaused(true);
    scrubFromEvent(e);
    const onMove = (ev: MouseEvent): void => scrubFromEvent(ev);
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });

  // ---- play / pause ----
  const tick = (now: number): void => {
    if (!playing || !currentTrack?.duration) return;
    let elapsed = now - startWall + startT;
    if (loopInput.checked) {
      elapsed = elapsed % currentTrack.duration;
    } else if (elapsed >= currentTrack.duration) {
      elapsed = currentTrack.duration;
      playing = false;
      playBtn.textContent = '▶';
    }
    playheadT = elapsed;
    updatePlayhead();
    updateValues();
    if (playing) rafId = requestAnimationFrame(tick);
  };

  playBtn.addEventListener('click', () => {
    if (!currentTrack?.duration) return;
    if (playing) {
      playing = false;
      cancelAnimationFrame(rafId);
      playBtn.textContent = '▶';
      startT = playheadT;
      currentInstance?.setPaused(true);
    } else {
      playing = true;
      playBtn.textContent = '⏸';
      startT = playheadT;
      startWall = performance.now();
      currentInstance?.setPaused(false);
      rafId = requestAnimationFrame(tick);
    }
  });

  // ---- visibility ----
  const showEmpty = (msg: string): void => {
    trackArea.hidden = true;
    emptyEl.hidden = false;
    emptyEl.textContent = msg;
  };
  const showTrack = (): void => {
    trackArea.hidden = false;
    emptyEl.hidden = true;
  };

  showEmpty('Select a saver with paramSpace');

  return {
    setSaver(saver, instance) {
      currentSaver = saver;
      currentInstance = instance;
      if (currentTrack && currentTrack.program !== saver.manifest.id) {
        currentTrack = null;
        playheadT = 0;
        playing = false;
        cancelAnimationFrame(rafId);
        playBtn.textContent = '▶';
      }
      if (!saver.manifest.paramSpace) {
        showEmpty(`${saver.manifest.label} has no paramSpace`);
      } else if (!currentTrack) {
        showEmpty(`${saver.manifest.label} — load a track to see keyframes`);
      } else {
        updateChannels();
        updatePlayhead();
        updateValues();
        showTrack();
      }
      trackInfo.textContent = currentTrack
        ? `Track: ${currentTrack.program} \xb7 ${((currentTrack.duration ?? 0) / 1000).toFixed(1)}s${currentTrack.loop ? ' \xb7 loop' : ''}`
        : saver.manifest.paramSpace ? 'No track loaded' : '';
    },

    loadTrack(track) {
      currentTrack = track;
      playheadT = 0;
      playing = false;
      cancelAnimationFrame(rafId);
      playBtn.textContent = '▶';
      trackInfo.textContent = `Track: ${track.program} \xb7 ${((track.duration ?? 0) / 1000).toFixed(1)}s${track.loop ? ' \xb7 loop' : ''}`;
      updateRuler();
      updateChannels();
      updatePlayhead();
      updateValues();
      showTrack();
      if (currentInstance?.applyTrack) currentInstance.applyTrack(track);
    },
  };
}
