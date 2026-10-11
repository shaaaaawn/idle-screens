export { metaquarium, createMetaquarium, demoTrack } from './metaquarium';
export {
  metaquariumManifest,
  METAQUARIUM_PARAMS,
  paramSpaceWith,
  withDefaults,
  type MetaquariumOptions,
} from './manifest';
export { MIAMI_VICE_COLORS, BLOOM_COLORS } from './manifest';
export { qualityFor, type TankQuality } from './quality';
export { type TankBounds, type SwimPlan, type SwimPose } from './plan';
export { resolveIpfsUrl, FISH_CATALOG, NPC_CATALOG, DEFAULT_FISH, type FishEntry } from './ipfs';
export {
  parseVignette, resolveVignette, poseOf, VIGNETTES, VIGNETTE_CUES, INTERIOR_MARKS, OPEN_MARKS, GESTURES,
  type Vignette, type Marks, type Gesture,
} from './vignette';
export { parseSpotRig, parseSpotCues, spotLevels, MAX_SPOTS, type SpotSpec, type SpotSheet } from './spots';
export { PARAM_DOCS, RECIPES, GRAMMAR, recipe, recipeTrack, validateMetaquariumParams, type Recipe, type ParamProblem } from './guide';
export { parseSignMix, SIGN_KINDS, SIGN_PLACES, SIGN_TEXT_MAX, MAX_SIGNS, type SignEntry, type SignKind } from './sign-mix';
export { describeMetaquarium, metaquariumParamsFromTrack, type MetaquariumAnatomy, type AnatomyCastRow, type AnatomySection } from './anatomy';
