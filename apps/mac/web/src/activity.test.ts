// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { renderActivity, sanitizeSections } from './activity';

describe('sanitizeSections', () => {
  it('drops malformed payloads and empty sections', () => {
    expect(sanitizeSections(null)).toEqual([]);
    expect(sanitizeSections('nope')).toEqual([]);
    expect(
      sanitizeSections([
        { title: '🐳 Docker', lines: [] },
        { title: '🔌 MCP', lines: ['node · mcp-fs [123]', 42] },
        { bad: true },
      ]),
    ).toEqual([{ title: '🔌 MCP', lines: ['node · mcp-fs [123]'] }]);
  });
});

describe('renderActivity', () => {
  it('renders titles and lines as text, never HTML', () => {
    const el = document.createElement('div');
    renderActivity(el, [
      { title: '🐳 Docker', lines: ['web — <img src=x onerror=alert(1)>'] },
    ]);
    expect(el.classList.contains('show')).toBe(true);
    expect(el.children).toHaveLength(2);
    expect(el.querySelector('img')).toBeNull();
    expect(el.children[1]!.textContent).toContain('<img');
  });

  it('hides the panel when nothing is running', () => {
    const el = document.createElement('div');
    el.classList.add('show');
    renderActivity(el, [{ title: '🐳 Docker', lines: [] }]);
    expect(el.classList.contains('show')).toBe(false);
    expect(el.children).toHaveLength(0);
  });
});
