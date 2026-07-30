import { buildDebugPanel, type DebugHandle } from './debug-panel';
import { buildLayersPanel, type LayersHandle } from './layers-panel';
import { buildPerceptionPanel, type PerceptionHandle } from './perception-panel';

export interface RightDockHandle {
  props: HTMLElement;
  params: HTMLElement;
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

  const props = makePanel('Properties', true, 'wb-panel-props');
  const params = makePanel('Parameters', true);
  const engine = makePanel('Engine', true, 'wb-panel-engine');
  const layersPanel = makePanel('Layers', true, 'wb-panel-layers');
  // Open by default: perception now has something to show for EVERY saver with
  // a canvas, not just schema ones, so a collapsed panel hid the main readout.
  const percPanel = makePanel('Perception', true, 'wb-panel-perception');
  const debugPanel = makePanel('Debug', true, 'wb-panel-debug');

  stack.append(props.section, params.section, engine.section, layersPanel.section, percPanel.section, debugPanel.section);
  mount.append(stack);

  return {
    props: props.body,
    params: params.body,
    engine: engine.body,
    layers: buildLayersPanel(layersPanel.body),
    perception: buildPerceptionPanel(percPanel.body),
    debug: buildDebugPanel(debugPanel.body),
  };
}
