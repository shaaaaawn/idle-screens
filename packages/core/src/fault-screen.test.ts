// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { renderFaultScreen } from './fault-screen';

describe('fault screen (the degradation floor)', () => {
  it('renders into the host with the faulting saver named', () => {
    const host = document.createElement('div');
    const root = renderFaultScreen(host, { saverId: 'metaquarium', message: 'boom' });
    expect(host.contains(root)).toBe(true);
    expect(root.className).toBe('is-fault-screen');
    expect(root.textContent).toContain('SAVER_FAULT');
    expect(root.textContent).toContain('"metaquarium"');
    expect(root.textContent).toContain('boom');
    expect(root.textContent).toContain('Press any key');
  });

  it('truncates long error messages', () => {
    const host = document.createElement('div');
    const root = renderFaultScreen(host, { saverId: 'x', message: 'e'.repeat(400) });
    expect(root.textContent!.length).toBeLessThan(400);
    expect(root.textContent).toContain('…');
  });

  it('is calm by construction: dark background, no animation', () => {
    const host = document.createElement('div');
    const root = renderFaultScreen(host, { saverId: 'x', message: 'y' });
    expect(root.style.background).toBe('#040610');
    expect(root.querySelectorAll('*').length).toBeLessThan(10); // static DOM, nothing to strobe
  });
});
