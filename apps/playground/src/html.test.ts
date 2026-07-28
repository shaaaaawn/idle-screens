import { describe, it, expect } from 'vitest';
import { escapeHtml, safeHttpUrl } from './html';

describe('escapeHtml', () => {
  it('escapes the quote characters, not just the text delimiters', () => {
    // The bug CodeQL caught: an escaper that stops at `<`/`>`/`&` looks correct
    // in text position and is broken the moment the value lands in an attribute.
    expect(escapeHtml('" onerror="alert(1)')).toBe('&quot; onerror=&quot;alert(1)');
    expect(escapeHtml("' onload='x")).toBe('&#39; onload=&#39;x');
  });

  it('escapes the ampersand first so entities are not double-decoded', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });

  it('closes the injection point in an attribute', () => {
    // The payload that gets in when only `<`/`>`/`&` are handled: the quote ends
    // the attribute, and everything after it is parsed as new markup.
    const payload = '"><img src=x onerror=alert(1)>';
    const attr = `<span title="${escapeHtml(payload)}"></span>`;
    expect(attr).toBe('<span title="&quot;&gt;&lt;img src=x onerror=alert(1)&gt;"></span>');
    // Exactly two unescaped quotes remain — the ones that delimit the attribute.
    expect(attr.split('"')).toHaveLength(3);
  });
});

describe('safeHttpUrl', () => {
  it('passes plain web links through', () => {
    expect(safeHttpUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(safeHttpUrl('http://example.com/')).toBe('http://example.com/');
  });

  it('rejects schemes that execute — which escaping alone would let through', () => {
    // `javascript:alert(1)` contains no character escapeHtml touches, so an
    // escaped href is still a live payload. Only a scheme allowlist stops it.
    expect(escapeHtml('javascript:alert(1)')).toBe('javascript:alert(1)');
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull();
    expect(safeHttpUrl('JaVaScRiPt:alert(1)')).toBeNull();
    expect(safeHttpUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(safeHttpUrl('vbscript:msgbox(1)')).toBeNull();
  });

  it('escapes what it does return, so the href cannot break out of its quotes', () => {
    const out = safeHttpUrl('https://example.com/?q="onmouseover="alert(1)');
    expect(out).not.toBeNull();
    expect(out).not.toContain('"');
  });

  it('fails closed on garbage and on relative input', () => {
    expect(safeHttpUrl('')).toBeNull();
    expect(safeHttpUrl('http://')).toBeNull();
    // Relative is not a scheme this can judge, and an attribution link is always
    // external — so it is a link we decline to render, not one we guess at.
    expect(safeHttpUrl('/local/path')).toBeNull();
    expect(safeHttpUrl('example.com')).toBeNull();
  });
});
