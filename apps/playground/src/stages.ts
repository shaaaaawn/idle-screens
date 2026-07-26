/**
 * Mock DOM stages for passthrough savers.
 *
 * A passthrough saver's performance is a function of the PAGE it plays on —
 * the cat's itinerary, the tide's rafts, limelight's shadows all recompile
 * from the victim geometry. The workbench therefore needs stages: swappable,
 * deterministic mock documents the saver targets, so a (stage, seed) pair
 * reproduces the identical performance in every session.
 *
 * Each stage is a self-contained `srcdoc` rendered in an IFRAME that fills
 * the viewport panel. The iframe is the point, twice over:
 *  - Coordinates: savers read `getBoundingClientRect()` raw and draw into a
 *    canvas at their host's origin. Inside the iframe, the stage viewport IS
 *    the coordinate space, so everything lines up at any panel size.
 *  - Isolation: stage CSS cannot leak into the workbench and vice versa, so
 *    stages can be light-themed, type-set like real sites.
 *
 * Stage content must stay deterministic — fixed text, no randomness, no
 * external assets — or the "repeatable" promise dies here.
 */

export interface StageDef {
  id: string;
  label: string;
  /** Complete document for the iframe. Empty string = no stage (raw void). */
  srcdoc: string;
}

const BASE_CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; -webkit-font-smoothing: antialiased; }
  main { display: block; }
  img.ph { display: block; background: linear-gradient(135deg, #c9d4e0, #98a8ba); border-radius: 6px; }
`;

const ARTICLE = `<!doctype html><html><head><style>${BASE_CSS}
  body { background: #f7f5f0; color: #2a2723; }
  header { display: flex; gap: 18px; align-items: center; padding: 14px 32px; border-bottom: 1px solid #e0dbd2; }
  header .brand { font-weight: 700; font-size: 15px; }
  header a { color: #6b6459; text-decoration: none; font-size: 13px; }
  main { max-width: 640px; margin: 0 auto; padding: 36px 24px 80px; }
  h1 { font-size: 34px; line-height: 1.15; margin-bottom: 10px; letter-spacing: -0.02em; }
  .byline { color: #8a8275; font-size: 13px; margin-bottom: 24px; }
  p { font-size: 16px; line-height: 1.62; margin-bottom: 18px; }
  blockquote { border-left: 3px solid #c9b98a; padding: 6px 0 6px 18px; font-style: italic; color: #5c5648; margin: 22px 0; }
  h2 { font-size: 22px; margin: 30px 0 12px; }
  li { font-size: 15px; line-height: 1.7; margin-left: 22px; }
  footer { border-top: 1px solid #e0dbd2; padding: 18px 32px; }
  footer a { color: #6b6459; font-size: 12px; margin-right: 16px; }
</style></head><body>
<header><span class="brand">The Field Notes</span><a href="#">Essays</a><a href="#">Archive</a><a href="#">About</a></header>
<main>
  <h1>On the Quiet Machinery of Attention</h1>
  <div class="byline">A short essay in three movements</div>
  <p>There is a species of stillness that only settles over a room when the screen inside it stops asking for anything. The cursor rests. The feed does not refresh. What remains is the page itself, suddenly an object rather than a surface.</p>
  <img class="ph" width="592" height="220" alt="" />
  <p>We built our idle hours out of noise for a decade, and the noise obliged us by becoming the point. But a page left alone long enough begins to behave differently. It cools. It becomes furniture.</p>
  <blockquote>The screensaver was never about saving the screen. It was about admitting the machine has hours we are not entitled to.</blockquote>
  <h2>Three small claims</h2>
  <ul>
    <li>Idle time belongs to the room, not the application.</li>
    <li>A page is a landscape the moment nobody is scrolling it.</li>
    <li>Whatever visits that landscape should leave it exactly as found.</li>
  </ul>
  <p>So we let the water in, or the light, or the small dark visitor with the glowing eyes. The content holds its breath. In the morning every pixel is back where it was left, and only the room knows.</p>
</main>
<footer><a href="#">Colophon</a><a href="#">RSS</a><a href="#">Privacy</a></footer>
</body></html>`;

const CARDS = `<!doctype html><html><head><style>${BASE_CSS}
  body { background: #101318; color: #e6e9ee; }
  header { display: flex; gap: 16px; align-items: center; padding: 14px 28px; border-bottom: 1px solid #1f2530; }
  header .brand { font-weight: 700; font-size: 14px; color: #fff; }
  header a { color: #8b95a5; text-decoration: none; font-size: 13px; }
  main { padding: 26px 28px; }
  h1 { font-size: 20px; margin-bottom: 18px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 14px; }
  .card { background: #171c24; border: 1px solid #232a36; border-radius: 10px; padding: 14px; }
  .card h3 { font-size: 14px; margin-bottom: 6px; }
  .card p { font-size: 12px; color: #8b95a5; line-height: 1.5; margin-bottom: 10px; }
  .card button { background: #2b6cb0; color: #fff; border: 0; border-radius: 6px; padding: 6px 12px; font-size: 12px; }
</style></head><body>
<header><span class="brand">Crate</span><a href="#">Library</a><a href="#">Shared</a><a href="#">Settings</a></header>
<main>
  <h1>Your collections</h1>
  <div class="grid">
    <div class="card"><h3>Night Recordings</h3><p>Forty-one field captures from the reservoir, tagged and levelled.</p><button>Open</button></div>
    <div class="card"><h3>Reading Queue</h3><p>Nineteen essays you swore you would finish this month.</p><button>Open</button></div>
    <div class="card"><h3>Reference Boards</h3><p>Light studies, staircases, and one folder just called "fog".</p><button>Open</button></div>
    <div class="card"><h3>Travel Scans</h3><p>Tickets and stamps from the coastal line, 2019 to now.</p><button>Open</button></div>
    <div class="card"><h3>Recipes</h3><p>The six that work and the thirty that might, someday.</p><button>Open</button></div>
    <div class="card"><h3>Archive</h3><p>Everything else, compressed and honest about it.</p><button>Open</button></div>
  </div>
</main>
</body></html>`;

const DASHBOARD = `<!doctype html><html><head><style>${BASE_CSS}
  body { background: #0d1117; color: #e6edf3; }
  .layout { display: grid; grid-template-columns: 190px 1fr; min-height: 100vh; }
  nav { border-right: 1px solid #21262d; padding: 18px 14px; }
  nav a { display: block; color: #8b949e; text-decoration: none; font-size: 13px; padding: 7px 10px; border-radius: 6px; }
  nav a.on { background: #161b22; color: #e6edf3; }
  main { padding: 22px 26px; }
  h1 { font-size: 18px; margin-bottom: 16px; }
  .stats { display: flex; gap: 12px; margin-bottom: 20px; }
  .stat { background: #161b22; border: 1px solid #21262d; border-radius: 8px; padding: 12px 16px; min-width: 130px; }
  .stat b { display: block; font-size: 20px; }
  .stat span { font-size: 11px; color: #8b949e; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 11px; color: #8b949e; padding: 8px 10px; border-bottom: 1px solid #21262d; }
  td { font-size: 13px; padding: 9px 10px; border-bottom: 1px solid #161b22; }
  .pill { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; background: #1f6feb33; color: #79c0ff; }
</style></head><body>
<div class="layout">
  <nav><a class="on" href="#">Overview</a><a href="#">Deploys</a><a href="#">Channels</a><a href="#">Tokens</a><a href="#">Logs</a></nav>
  <main>
    <h1>Fleet overview</h1>
    <div class="stats">
      <div class="stat"><b>312</b><span>screens online</span></div>
      <div class="stat"><b>97.4%</b><span>uptime, 30d</span></div>
      <div class="stat"><b>18</b><span>channels live</span></div>
      <div class="stat"><b>4.2s</b><span>median wake</span></div>
    </div>
    <table>
      <tr><th>Channel</th><th>Saver</th><th>Screens</th><th>Status</th></tr>
      <tr><td>lobby-east</td><td>tide</td><td>24</td><td><span class="pill">live</span></td></tr>
      <tr><td>lobby-west</td><td>limelight</td><td>18</td><td><span class="pill">live</span></td></tr>
      <tr><td>studio-4</td><td>catwalk</td><td>6</td><td><span class="pill">live</span></td></tr>
      <tr><td>cafe-wall</td><td>slipstream</td><td>11</td><td><span class="pill">live</span></td></tr>
      <tr><td>night-crew</td><td>black-hole</td><td>9</td><td><span class="pill">live</span></td></tr>
    </table>
  </main>
</div>
</body></html>`;

const LANDING = `<!doctype html><html><head><style>${BASE_CSS}
  body { background: linear-gradient(180deg, #fdfcfa 0%, #f1ede6 100%); color: #1f1c18; }
  header { display: flex; justify-content: space-between; align-items: center; padding: 18px 40px; }
  header .brand { font-weight: 800; font-size: 16px; }
  header nav a { color: #6b645a; text-decoration: none; font-size: 13px; margin-left: 18px; }
  main { text-align: center; padding: 52px 24px 70px; max-width: 760px; margin: 0 auto; }
  h1 { font-size: 44px; line-height: 1.08; letter-spacing: -0.03em; margin-bottom: 14px; }
  .sub { font-size: 17px; color: #6b645a; margin-bottom: 26px; }
  .cta { display: inline-block; }
  .cta button { font-size: 15px; padding: 12px 22px; border-radius: 8px; border: 0; margin: 0 6px; }
  .cta .go { background: #1f1c18; color: #fff; }
  .cta .alt { background: #e7e1d6; color: #1f1c18; }
  .trio { display: flex; gap: 18px; margin-top: 54px; text-align: left; }
  .trio div { flex: 1; background: #ffffffcc; border: 1px solid #e7e1d6; border-radius: 10px; padding: 16px; }
  .trio h3 { font-size: 14px; margin-bottom: 6px; }
  .trio p { font-size: 12.5px; color: #6b645a; line-height: 1.55; }
</style></head><body>
<header><span class="brand">idlescreens</span><nav><a href="#">Gallery</a><a href="#">Docs</a><a href="#">Pricing</a></nav></header>
<main>
  <h1>Your screens deserve<br/>better dreams.</h1>
  <div class="sub">Ambient, deterministic, agent-steerable screensavers for every idle surface you own.</div>
  <div class="cta"><button class="go">Start a channel</button><button class="alt">Watch the reel</button></div>
  <div class="trio">
    <div><h3>Deterministic</h3><p>Same seed, same frame, on every device, forever. Pixels you can pin in a test.</p></div>
    <div><h3>Passthrough</h3><p>The saver plays on your page, not over it — content becomes the landscape.</p></div>
    <div><h3>Steerable</h3><p>Typed parameters and control tracks, built for agents from the first commit.</p></div>
  </div>
</main>
</body></html>`;

const EMPTY = `<!doctype html><html><head><style>${BASE_CSS}
  body { background: #0b0d12; }
</style></head><body><main></main></body></html>`;

export const STAGES: StageDef[] = [
  { id: 'none', label: 'No stage (void)', srcdoc: '' },
  { id: 'article', label: 'Article — light long-form', srcdoc: ARTICLE },
  { id: 'cards', label: 'Card grid — dark app shell', srcdoc: CARDS },
  { id: 'dashboard', label: 'Dashboard — chips & tables', srcdoc: DASHBOARD },
  { id: 'landing', label: 'Landing — big hero blocks', srcdoc: LANDING },
  { id: 'empty', label: 'Empty page — fallback drills', srcdoc: EMPTY },
];

export interface MountedStage {
  frame: HTMLIFrameElement;
  doc: Document;
  /** Full-viewport overlay inside the stage the saver mounts into. */
  overlay: HTMLElement;
  width: number;
  height: number;
  /** PageContext scoped to the stage document (never the workbench). */
  page: { palette(): string[]; victims(selector: string): HTMLElement[] };
  destroy(): void;
}

/**
 * A geometry mirror of a mounted stage: `victims()` answers with DETACHED
 * clone elements whose rects are frozen from the live stage's elements.
 *
 * Why: tooling (the Perception panel) samples a saver by mounting a SECOND
 * instance at the same (t, seed) — but two instances writing transforms to
 * the same live victims would fight, and an empty page is a different
 * performance entirely (fallback modes). The mirror gives the sampler the
 * identical victim geometry — so the compiled performance matches the
 * viewport — while its style writes land on clones nobody renders.
 *
 * De-nesting (outermost-wins) runs here against the REAL hierarchy, because
 * detached clones are all roots and `contains()` would degenerate.
 */
export function mirrorPage(stage: MountedStage): MountedStage['page'] {
  const clones = new WeakMap<HTMLElement, HTMLElement>();
  const mirror = (el: HTMLElement): HTMLElement => {
    let c = clones.get(el);
    if (!c) {
      c = document.createElement(el.tagName);
      const r = el.getBoundingClientRect();
      const frozen = {
        x: r.x, y: r.y, left: r.left, top: r.top, right: r.right, bottom: r.bottom,
        width: r.width, height: r.height,
        toJSON: () => ({}),
      } as DOMRect;
      c.getBoundingClientRect = () => frozen;
      clones.set(el, c);
    }
    return c;
  };
  return {
    palette: () => stage.page.palette(),
    victims: (selector: string) => {
      const live = stage.page.victims(selector);
      const outermost = live.filter((el) => !live.some((o) => o !== el && o.contains(el)));
      return outermost.map(mirror);
    },
  };
}

/** Render a stage into `container` and resolve once its DOM is live. */
export function mountStage(container: HTMLElement, def: StageDef): Promise<MountedStage> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.className = 'stage-frame';
    frame.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0;display:block;background:#fff';
    frame.setAttribute('title', 'saver stage');
    frame.srcdoc = def.srcdoc;
    frame.addEventListener('load', () => {
      const doc = frame.contentDocument;
      if (!doc) { reject(new Error('stage iframe has no document')); return; }
      const overlay = doc.createElement('div');
      overlay.id = 'stage-saver-overlay';
      // `visibility:visible` explicitly: the workbench inspects the page deck
      // by hiding the BODY, and an explicit visibility lets the saver overlay
      // survive that (CSS visibility is un-inheritable by declaration).
      overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;visibility:visible';
      doc.body.appendChild(overlay);
      resolve({
        frame,
        doc,
        overlay,
        width: frame.clientWidth,
        height: frame.clientHeight,
        page: {
          palette: () => [],
          victims: (selector: string) =>
            Array.from(doc.querySelectorAll<HTMLElement>(selector)).filter((el) => !overlay.contains(el)),
        },
        destroy: () => frame.remove(),
      });
    }, { once: true });
    container.appendChild(frame);
  });
}
