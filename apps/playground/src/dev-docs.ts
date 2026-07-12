import { SCHEMA_EXAMPLES } from '@idle-screens/schema';
import {
  DEV_API_NAMESPACES,
  DEV_HARNESS_MODES,
  DEV_URL_PARAMS,
  type ApiNamespace,
} from './dev-api-catalog';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderNamespace(ns: ApiNamespace, schemaExampleKeys: string[]): string {
  const notes = [...(ns.notes ?? [])];
  if (ns.id === 'schema' && schemaExampleKeys.length) {
    notes.push(`Current example keys: ${schemaExampleKeys.join(', ')}`);
  }

  return `
    <section class="dev-doc-block" id="api-${esc(ns.id)}">
      <div class="dev-doc-head">
        <h3><code>${esc(ns.global)}</code></h3>
        <span class="dev-doc-avail">${esc(ns.availability)}</span>
      </div>
      <p class="dev-doc-lead">${esc(ns.summary)}</p>
      <table class="dev-api-table">
        <thead><tr><th>Member</th><th>Signature</th><th>Description</th></tr></thead>
        <tbody>
          ${ns.members
            .map(
              (m) => `
            <tr>
              <td><code>${esc(m.name)}</code></td>
              <td><code class="sig">${esc(m.signature)}</code></td>
              <td>${esc(m.description)}</td>
            </tr>`,
            )
            .join('')}
        </tbody>
      </table>
      ${notes.length ? `<ul class="dev-doc-notes">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
    </section>`;
}

/** Render dev API reference into the viewport content area. */
export function buildDevDocs(mount: HTMLElement): void {
  const schemaKeys = SCHEMA_EXAMPLES.map((e) => (e.id === 'dev-dashboard' ? 'dashboard' : e.id));

  mount.className = 'content dev-docs';
  mount.innerHTML = `
    <header class="dev-docs-hero">
      <h1>Dev API</h1>
      <p class="dev-docs-sub">
        Playground globals and URL hooks. Update <code>src/dev-api-catalog.ts</code> when the API changes.
      </p>
    </header>

    <nav class="dev-docs-toc" aria-label="API sections">
      ${DEV_API_NAMESPACES.map((ns) => `<a href="#docs/api-${esc(ns.id)}">${esc(ns.global)}</a>`).join('')}
      <a href="#docs/api-url">URL params</a>
      <a href="#docs/api-modes">Harness modes</a>
    </nav>

    <div class="dev-docs-body">
      ${DEV_API_NAMESPACES.map((ns) => renderNamespace(ns, schemaKeys)).join('')}

      <section class="dev-doc-block" id="api-url">
        <div class="dev-doc-head"><h3>URL search params</h3><span class="dev-doc-avail">Gallery, Dev Tools, Docs</span></div>
        <p class="dev-doc-lead">Live workbench configuration via query string (hash routing unchanged).</p>
        <table class="dev-api-table">
          <thead><tr><th>Param</th><th>Description</th><th>Example</th></tr></thead>
          <tbody>
            ${DEV_URL_PARAMS.map(
              (p) => `
              <tr>
                <td><code>${esc(p.name)}</code></td>
                <td>${esc(p.description)}</td>
                <td>${p.example ? `<code class="sig">${esc(p.example)}</code>` : '—'}</td>
              </tr>`,
            ).join('')}
          </tbody>
        </table>
      </section>

      <section class="dev-doc-block" id="api-modes">
        <div class="dev-doc-head"><h3>Harness modes</h3><span class="dev-doc-avail">Alternate entry points</span></div>
        <p class="dev-doc-lead">Headless pages used by Playwright e2e; no workbench chrome.</p>
        <table class="dev-api-table">
          <thead><tr><th>Query</th><th>Description</th><th>Globals</th></tr></thead>
          <tbody>
            ${DEV_HARNESS_MODES.map(
              (m) => `
              <tr>
                <td><code>${esc(m.query)}</code></td>
                <td>${esc(m.description)}</td>
                <td>${m.globals?.map((g) => `<code>${esc(g)}</code>`).join(' ') ?? '—'}</td>
              </tr>`,
            ).join('')}
          </tbody>
        </table>
      </section>

      <section class="dev-doc-block dev-doc-try">
        <h3>Quick try</h3>
        <p>Open <strong>Dev Tools</strong> to pick a saver, tune the inspector, and scrub the timeline. Press <strong>Sleep</strong> or run <code>__idleScreens.sleep()</code> in the console.</p>
      </section>
    </div>`;
}
