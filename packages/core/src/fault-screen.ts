/**
 * The floor of the graceful-degradation ladder: a zero-dependency DOM fault
 * screen the element shows when the active saver faults at runtime AND the
 * configured crash saver (config.crashSaverId, e.g. 'bsod') is unavailable
 * or faults too. The screen must stay a screen — dark, calm, flash-safe,
 * and honest about what happened. Any key still wakes.
 */

export interface FaultInfo {
  /** Id of the saver that faulted. */
  saverId: string;
  /** One error line, already stringified. Truncated for display. */
  message: string;
}

export function renderFaultScreen(host: HTMLElement, info: FaultInfo): HTMLElement {
  const root = document.createElement('div');
  root.className = 'is-fault-screen';
  root.setAttribute('role', 'alert');
  root.setAttribute('aria-live', 'assertive');
  root.style.cssText = [
    'position:absolute',
    'inset:0',
    'display:grid',
    'place-items:center',
    'background:#040610',
    'color:#8fb4d8',
    'font-family:ui-monospace,SFMono-Regular,Menlo,monospace',
    'font-size:14px',
    'line-height:1.7',
    'text-align:left',
  ].join(';');

  const box = document.createElement('div');
  const msg = info.message.length > 160 ? `${info.message.slice(0, 157)}…` : info.message;
  const line = (text: string, style = ''): HTMLElement => {
    const el = document.createElement('div');
    el.textContent = text;
    if (style) el.style.cssText = style;
    return el;
  };
  box.append(
    line('IDLE_SCREENS :: SAVER_FAULT', 'color:#d8e8f8;letter-spacing:0.12em;margin-bottom:1em'),
    line(`The saver "${info.saverId}" stopped and was halted.`),
    line(msg, 'color:#5a7a9a;margin-top:0.5em;max-width:60ch;overflow-wrap:break-word'),
    line('The screen stays asleep. Press any key to wake.', 'color:#5a7a9a;margin-top:2em'),
  );
  root.append(box);
  host.append(root);
  return root;
}
