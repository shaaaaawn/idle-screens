/** Saver ids that upgrade from canvas2d to WebGPU when the device supports it. */
const DUAL_PATH_ATTR: Record<string, string> = {
  fluid: 'data-fluid-backend',
  'reaction-diffusion': 'data-rd-backend',
};

/** Read the active backend from a mounted preview canvas, if present. */
export function readPreviewBackend(saverId: string, root: ParentNode | null): string | null {
  const attr = DUAL_PATH_ATTR[saverId];
  if (!attr || !root) return null;
  return root.querySelector('canvas')?.getAttribute(attr) ?? null;
}

/** Label for UI: show runtime backend; note min floor when upgraded. */
export function formatBackendLabel(saverId: string, minBackend: string, root: ParentNode | null): string {
  const active = readPreviewBackend(saverId, root);
  if (!active || active === minBackend) return minBackend;
  return `${active} (min ${minBackend})`;
}
