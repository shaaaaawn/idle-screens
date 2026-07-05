import { describe, it, expect } from 'vitest';
import { resolveConfigMenu, DEFAULT_MENU_HOTKEY } from './types';

describe('resolveConfigMenu', () => {
  it('is enabled by default (undefined / true)', () => {
    for (const input of [undefined, true] as const) {
      const r = resolveConfigMenu(input);
      expect(r).not.toBeNull();
      expect(r).toMatchObject({ enabled: true, showPicker: true, previewOnPick: true, title: 'Screen Saver' });
      expect(r!.hotkey).toBe(DEFAULT_MENU_HOTKEY);
    }
  });

  it('is disabled by false or { enabled: false }', () => {
    expect(resolveConfigMenu(false)).toBeNull();
    expect(resolveConfigMenu({ enabled: false })).toBeNull();
  });

  it('merges partial overrides onto defaults', () => {
    const hotkey = (e: KeyboardEvent): boolean => e.key === 'F1';
    const r = resolveConfigMenu({ hotkey, previewOnPick: false, title: 'Idle' });
    expect(r).toMatchObject({ enabled: true, showPicker: true, previewOnPick: false, title: 'Idle' });
    expect(r!.hotkey).toBe(hotkey);
  });

  it('default hotkey matches Cmd/Ctrl+K only', () => {
    const k = (init: Partial<KeyboardEvent>): boolean =>
      DEFAULT_MENU_HOTKEY({ key: 'k', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...init } as KeyboardEvent);
    expect(k({ metaKey: true })).toBe(true);
    expect(k({ ctrlKey: true })).toBe(true);
    expect(k({ ctrlKey: true, shiftKey: true })).toBe(false);
    expect(k({ ctrlKey: true, key: 'j' } as Partial<KeyboardEvent>)).toBe(false);
    expect(k({})).toBe(false);
  });
});
