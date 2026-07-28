/**
 * The `eval-holdout` Vite plugin supplies this module. It is `unknown` on
 * purpose: the fixtures are hand-authored JSON that no compiler validates, so
 * the shape must be proven at runtime by `parseHoldoutProfiles`, not asserted
 * here. `null` when no holdout directory is configured — always in a build.
 */
declare module 'virtual:idle-eval-holdout' {
  const data: unknown;
  export default data;
}
