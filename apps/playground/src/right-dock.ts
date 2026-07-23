import { buildDebugPanel, type DebugHandle } from './debug-panel';
import { buildLayersPanel, type LayersHandle } from './layers-panel';
import { buildPerceptionPanel, type PerceptionHandle } from './perception-panel';

export interface RightDockHandle {
  props: HTMLElement;
  engine: HTMLElement;
  layers: LayersHandle;
  debug: DebugHandle;
  perception: PerceptionHandle;
}

function makePanel(label: string, open = true, className?: string): { section: HTMLDetailsElement; body: HTMLElement } {
  const section = document.createElement('details');
  section.className = ['wb-panel', className].filter(Boolean).join(' ');
  section.open = open;
  const summary = document.createElement('summary');
  summary.className = 'wb-panel-head';
  summary.textContent = label;
  const body = document.createElement('div');
  body.className = 'wb-panel-body';
  section.append(summary, body);
  return { section, body };
}

/** Right workbench column: properties, engine config, debug metrics. */
export function buildRightDock(mount: HTMLElement): RightDockHandle {
  const stack = document.createElement('div');
  stack.className = 'wb-stack wb-stack-right';

  const props = makePanel('Properties', true);
  const engine = makePanel('Engine', true);
  const layersPanel = makePanel('Layers', false);
  const percPanel = makePanel('Perception', false);
  const debugPanel = makePanel('Debug', true, 'wb-panel-debug');

  stack.append(props.section, engine.section, layersPanel.section, percPanel.section, debugPanel.section);
  mount.append(stack);

  return {
    props: props.body,
    engine: engine.body,
    layers: buildLayersPanel(layersPanel.body),
    perception: buildPerceptionPanel(percPanel.body),
    debug: buildDebugPanel(debugPanel.body),
  };
}
