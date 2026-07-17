/**
 * Playground dev API catalog — edit this file when adding window globals or URL hooks.
 * `dev-docs.ts` renders it on the Dev Tools viewport.
 */

export interface ApiMember {
  name: string;
  signature: string;
  description: string;
}

export interface ApiNamespace {
  /** Short id for anchors */
  id: string;
  /** Global path, e.g. window.__idleScreens */
  global: string;
  /** When this namespace is available */
  availability: string;
  summary: string;
  members: ApiMember[];
  notes?: string[];
}

export interface UrlParamDoc {
  name: string;
  description: string;
  example?: string;
}

export interface HarnessModeDoc {
  query: string;
  description: string;
  globals?: string[];
}

/** Console / window APIs exposed by the playground. */
export const DEV_API_NAMESPACES: ApiNamespace[] = [
  {
    id: 'idle-screens',
    global: 'window.__idleScreens',
    availability: 'Gallery and Dev Tools (#dev), after the element boots',
    summary: 'Imperative control of the live <idle-screen> overlay and active saver.',
    members: [
      { name: 'sleep()', signature: '() => void', description: 'Open the saver dialog and mount the active plugin.' },
      { name: 'wake()', signature: '() => void', description: 'Dismiss the saver and return to the awake page.' },
      { name: 'toggle()', signature: '() => void', description: 'Toggle awake ↔ sleeping.' },
      { name: 'setPlugin(id)', signature: '(id: string) => void', description: 'Switch the active saver (respects selection mode).' },
      { name: 'state()', signature: '() => string', description: 'Returns "awake" or "sleeping".' },
      { name: 'active()', signature: '() => string | null', description: 'Id of the mounted saver while sleeping, else null.' },
      { name: 'openMenu()', signature: '() => void', description: 'Open the built-in ⌘K saver picker (when configMenu is on).' },
      { name: 'closeMenu()', signature: '() => void', description: 'Close the saver picker.' },
      { name: 'toggleMenu()', signature: '() => void', description: 'Toggle the saver picker.' },
      { name: 'menuOpen()', signature: '() => boolean', description: 'Whether the picker dialog is open.' },
      { name: 'plugins', signature: 'Array<{ id, label }>', description: 'Registered saver list from the engine.' },
    ],
    notes: ['Top-bar Sleep and Inspector "Sleep now" call sleep(). Escape wakes.'],
  },
  {
    id: 'caps',
    global: 'window.__caps',
    availability: 'Dev Tools (#dev), wired on load',
    summary: 'Device capability probes from @idle-screens/capabilities.',
    members: [
      { name: 'detect()', signature: '() => Promise<Capabilities>', description: 'Probe backends, DPR, reduced-motion, memory hints.' },
      { name: 'tier(caps)', signature: '(caps) => CapabilityTier', description: 'Compute minimal | basic | standard | high tier.' },
      { name: 'budget(caps)', signature: '(caps) => CostTier', description: 'Max saver cost tier the device should run.' },
      { name: 'evaluate(caps)', signature: '(caps) => SaverEligibility[]', description: 'Per-saver ok | degraded | blocked with reasons.' },
      { name: 'real()', signature: '() => Capabilities', description: 'Snapshot from first detect() on boot.' },
    ],
  },
  {
    id: 'schema',
    global: 'window.__schema',
    availability: 'Dev Tools (#dev), wired on load',
    summary: 'Declarative SaverSpec validate / sample helpers.',
    members: [
      { name: 'validate(json)', signature: '(json: string) => ValidationResult', description: 'Parse and validate a SaverSpec JSON string.' },
      { name: 'sample(json)', signature: '(json: string) => Promise<ValidateResult>', description: 'Compile spec, sample frames, run flash + perf gates.' },
      { name: 'examples', signature: 'Record<string, string>', description: 'Pretty-printed bundled example specs (keys match catalog ids).' },
    ],
    notes: ['Example keys are built from SCHEMA_EXAMPLES at runtime.'],
  },
  {
    id: 'validate',
    global: 'window.__validate',
    availability: '?validate query mode only (headless validator harness)',
    summary: 'WCAG flash + frame-budget sampling without the workbench UI.',
    members: [
      { name: 'saver(id, opts?)', signature: '(id, opts?) => Promise<ValidateResult>', description: 'Sample a registered saver by id.' },
      { name: 'strobe(hz, opts?)', signature: '(hz, opts?) => FlashReport', description: 'Run the strobe fixture at a given frequency.' },
    ],
  },
  {
    id: 'harness',
    global: 'window.__harness',
    availability: '?harness query mode only (SaverInstance lifecycle tests)',
    summary: 'Mount a saver off-screen, exercise resize/pause/dispose, return a result object.',
    members: [
      { name: 'run(id)', signature: '(id) => Promise<HarnessResult>', description: 'Lifecycle harness for one saver id.' },
    ],
    notes: [
      'HarnessResult: { id, passthrough, mounted, survivedOps, victimMutatedDuring, victimRestored, errors }',
    ],
  },
  {
    id: 'frame',
    global: 'window.__frameReady',
    availability: '?frame query mode only (deterministic single-frame render)',
    summary: 'Set true after black-hole renderFrame completes (Playwright determinism proofs).',
    members: [
      { name: '__frameReady', signature: 'boolean', description: 'Polling flag; use with ?frame&seed=&frame=ms.' },
    ],
    notes: ['Optional ?track=demo applies the black-hole demo control track before rendering.'],
  },
];

/** Live-mode URL search params (gallery + #dev). */
export const DEV_URL_PARAMS: UrlParamDoc[] = [
  { name: 'saver', description: 'Initial active saver id.', example: '?saver=dvd#dev' },
  { name: 'seed', description: 'RNG seed for the engine and inline preview.', example: '?seed=99' },
  { name: 'timeout', description: 'Idle timeout in ms before auto-sleep.', example: '?timeout=5000' },
  { name: 'selection', description: 'fixed | random | rotate when picking savers.', example: '?selection=rotate' },
  { name: 'blur', description: 'Sleep when the tab loses focus (1 = on).', example: '?blur=1' },
  { name: 'clock', description: 'Show clock overlay while sleeping (1 = on).', example: '?clock=1' },
  { name: 'menu', description: 'Disable built-in ⌘K menu (off).', example: '?menu=off' },
  { name: 'engine', description: 'Use external IdleScreensEngine (external).', example: '?engine=external' },
  { name: 'forcePolyfill', description: 'Force rAF polyfill in Workers (1).', example: '?forcePolyfill=1' },
];

/** Alternate entry points (no workbench chrome). */
export const DEV_HARNESS_MODES: HarnessModeDoc[] = [
  { query: '?frame', description: 'Fullscreen single frame; sets __frameReady.', globals: ['__frameReady'] },
  { query: '?harness', description: 'SaverInstance lifecycle runner.', globals: ['__harness'] },
  { query: '?validate', description: 'Flash/perf validator only.', globals: ['__validate'] },
];
