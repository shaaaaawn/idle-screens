import type { ParamSpace, SaverManifest } from '@idle-screens/core';

/**
 * Zero-dependency manifest module (type-only imports). The channel server
 * imports `@idle-screens/saver-metaquarium/manifest` to validate published
 * params against this paramSpace without pulling three.js into the Worker.
 */
export const METAQUARIUM_PARAMS = {
  cameraAzimuth: { type: 'number', default: 35, min: 0, max: 360, ease: 'smooth' },
  cameraElevation: { type: 'number', default: 12, min: -5, max: 60, ease: 'smooth' },
  cameraDistance: { type: 'number', default: 170, min: 80, max: 400, ease: 'smooth' },
  autoRotate: { type: 'number', default: 1.5, min: 0, max: 12, ease: 'smooth' },
  fishCount: { type: 'number', default: 7, min: 1, max: 24, ease: 'step' },
  swimSpeed: { type: 'number', default: 1, min: 0.2, max: 3, ease: 'smooth' },
  fogColor: { type: 'color', default: '#04101c', ease: 'smooth' },
  /** GLB to populate the tank with. Later phases resolve tank/wallet ids to
   *  per-fish URLs; the skeleton swims one breed. */
  fishUrl: { type: 'string', default: '/assets/metaquarium/beta-fish.glb' },
} satisfies ParamSpace;

export const metaquariumManifest: SaverManifest = {
  id: 'metaquarium',
  label: 'Metaquarium',
  minBackend: 'webgl2',
  costTier: 'medium',
  motionIntensity: 'calm',
  reducedMotionFallback: 'static',
  paramSpace: METAQUARIUM_PARAMS,
  a11y: {
    flashSafe: true,
    notes: 'Slow ambient swim in a dark fogged tank; no strobing, no fast luminance cuts.',
  },
};
