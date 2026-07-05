// Default (node) environment: no window / customElements. Importing the element
// module and registering it must be inert here (the SSG prerender imports the
// barrel in Node) — the Node-safe HostBase makes `class extends HTMLElement` safe.
import { describe, it, expect } from 'vitest';
import { IdleScreenElement, defineIdleScreen } from './idle-screen.element';

describe('<idle-screen> Node-safety (L1)', () => {
  it('this environment has no window/customElements', () => {
    expect(typeof window).toBe('undefined');
    expect(typeof customElements).toBe('undefined');
  });

  it('the module imports without constructing HTMLElement', () => {
    expect(typeof IdleScreenElement).toBe('function');
  });

  it('defineIdleScreen() is a safe, idempotent no-op without customElements', () => {
    expect(() => {
      defineIdleScreen();
      defineIdleScreen();
    }).not.toThrow();
  });
});
