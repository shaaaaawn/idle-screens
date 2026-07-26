/**
 * System-activity HUD for the mac host page. The Swift shell periodically
 * pushes sections (Docker containers, Apple containers, MCP processes, dev
 * servers) via window.__idleScreensMac.setActivity; this renders them into a
 * quiet monospace panel. All content is inserted via textContent — process
 * names and container labels are untrusted strings.
 */
export interface ActivitySection {
  title: string;
  lines: string[];
}

/** Coerce an untrusted payload into well-formed sections with content. */
export function sanitizeSections(payload: unknown): ActivitySection[] {
  if (!Array.isArray(payload)) return [];
  return payload
    .filter(
      (s): s is ActivitySection =>
        typeof s === 'object' &&
        s !== null &&
        typeof (s as ActivitySection).title === 'string' &&
        Array.isArray((s as ActivitySection).lines),
    )
    .map((s) => ({ title: s.title, lines: s.lines.filter((l) => typeof l === 'string') }))
    .filter((s) => s.lines.length > 0);
}

/** Render sections into the HUD element; hides it when nothing is running. */
export function renderActivity(el: HTMLElement, payload: unknown): void {
  const sections = sanitizeSections(payload);
  el.replaceChildren();
  if (sections.length === 0) {
    el.classList.remove('show');
    return;
  }
  for (const section of sections) {
    const title = document.createElement('div');
    title.className = 'act-title';
    title.textContent = section.title;
    el.append(title);
    for (const line of section.lines) {
      const item = document.createElement('div');
      item.className = 'act-line';
      item.textContent = line;
      el.append(item);
    }
  }
  el.classList.add('show');
}
