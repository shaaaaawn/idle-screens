/**
 * Workbench shell as Web Components (no framework). `<wb-dock>` is a panel with a header
 * + a locally-scrolling body; `<wb-splitter>` is a draggable divider that resizes the
 * grid tracks by mutating CSS custom properties on #workbench. Light DOM throughout so
 * the panels' element IDs stay queryable by the rest of the modular JS.
 */

class WbDock extends HTMLElement {
  private bodyEl: HTMLDivElement | null = null;

  connectedCallback(): void {
    if (this.bodyEl) return; // idempotent (survives DOM moves)
    const head = document.createElement('div');
    head.className = 'dock-head';
    head.textContent = this.getAttribute('label') ?? '';
    const body = document.createElement('div');
    body.className = 'dock-body';
    while (this.firstChild) body.appendChild(this.firstChild);
    this.append(head, body);
    this.bodyEl = body;
  }

  /** The scrollable body (where panels mount). */
  get body(): HTMLDivElement | null {
    return this.bodyEl;
  }
}

class WbSplitter extends HTMLElement {
  connectedCallback(): void {
    this.addEventListener('pointerdown', this.onDown);
  }
  disconnectedCallback(): void {
    this.removeEventListener('pointerdown', this.onDown);
  }

  private onDown = (e: PointerEvent): void => {
    const wb = document.getElementById('workbench');
    if (!wb) return;
    e.preventDefault();
    const axis = this.getAttribute('axis') ?? 'x'; // 'x' resizes a column, 'y' a row
    const varName = this.getAttribute('for') ?? '--left';
    const invert = this.hasAttribute('invert'); // dividers on the right/bottom grow toward the cursor
    const min = Number(this.getAttribute('min') ?? 140);
    const max = Number(this.getAttribute('max') ?? 720);

    const startPos = axis === 'x' ? e.clientX : e.clientY;
    const startSize = parseFloat(getComputedStyle(wb).getPropertyValue(varName)) || 0;
    this.setPointerCapture(e.pointerId);
    this.classList.add('dragging');
    document.body.style.userSelect = 'none';

    const move = (ev: PointerEvent): void => {
      const cur = axis === 'x' ? ev.clientX : ev.clientY;
      let delta = cur - startPos;
      if (invert) delta = -delta;
      const next = Math.max(min, Math.min(max, startSize + delta));
      wb.style.setProperty(varName, `${next}px`);
    };
    const up = (ev: PointerEvent): void => {
      this.releasePointerCapture(ev.pointerId);
      this.classList.remove('dragging');
      document.body.style.userSelect = '';
      this.removeEventListener('pointermove', move);
      this.removeEventListener('pointerup', up);
      this.removeEventListener('pointercancel', up);
    };
    this.addEventListener('pointermove', move);
    this.addEventListener('pointerup', up);
    this.addEventListener('pointercancel', up);
  };
}

/** Register the custom elements (idempotent, SSR/no-DOM safe). */
export function defineWorkbench(): void {
  if (typeof customElements === 'undefined') return;
  if (!customElements.get('wb-dock')) customElements.define('wb-dock', WbDock);
  if (!customElements.get('wb-splitter')) customElements.define('wb-splitter', WbSplitter);
}

defineWorkbench();
