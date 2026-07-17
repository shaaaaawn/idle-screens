import { buildTimelinePanel, type TimelineHandle } from './timeline-panel';

export interface BottomDockHandle {
  timeline: TimelineHandle;
}

const TIMELINE_HEADER_H = 24;

/** Bottom workbench dock: collapsible timeline scrubber. */
export function buildBottomDock(mount: HTMLElement): BottomDockHandle {
  const panel = document.createElement('details');
  panel.className = 'wb-panel wb-panel-timeline';
  panel.open = true;

  const summary = document.createElement('summary');
  summary.className = 'wb-panel-head';
  summary.textContent = 'Timeline';

  const body = document.createElement('div');
  body.className = 'wb-panel-body';

  panel.append(summary, body);
  mount.append(panel);

  const view = (): HTMLElement | null => document.getElementById('view-dev');
  let expandedBottom = 200;

  const syncGrid = (): void => {
    const wb = view();
    if (!wb) return;
    if (panel.open) {
      wb.style.setProperty('--bottom', `${expandedBottom}px`);
      wb.classList.remove('timeline-collapsed');
    } else {
      const cur = parseFloat(getComputedStyle(wb).getPropertyValue('--bottom'));
      if (cur > TIMELINE_HEADER_H + 8) expandedBottom = cur;
      wb.style.setProperty('--bottom', `${TIMELINE_HEADER_H}px`);
      wb.classList.add('timeline-collapsed');
    }
  };

  panel.addEventListener('toggle', syncGrid);
  syncGrid();

  return {
    timeline: buildTimelinePanel(body),
  };
}
