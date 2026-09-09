import { describe, expect, it } from 'vitest';
import { breakTextBlock, textMetricsClassFor, textWidthEm } from './simulate';
import { validateSpec } from './validate';
import { adviseSpec } from './advise';
import { textSprites, perceiveScene, luminanceGrid, type PerceiveOptions, type LuminanceGrid } from './perceive';
import type { SaverSpec } from './types';

function textBlockSpec(overrides: Record<string, unknown> = {}): SaverSpec {
  return {
    schemaVersion: 1,
    id: 'text-block-test',
    label: 'Test',
    background: { type: 'solid', color: '#05050a' },
    layers: [
      {
        count: 1,
        sprite: {
          kind: 'textBlock',
          text: 'Hello world, this is a deterministic text block with wrapping.',
          maxWidth: 0.5,
          fontSize: 0.04,
          color: '#e6e8ef',
          ...overrides,
        },
        motion: { type: 'static' },
        position: { x: 0.1, y: 0.1 },
      },
    ],
  } as SaverSpec;
}

describe('breakTextBlock', () => {
  it('wraps text at word boundaries', () => {
    const lines = breakTextBlock('Hello world foo bar baz', 5);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every((l) => l.widthEm <= 5 || l.text.split(' ').length === 1)).toBe(true);
  });

  it('preserves explicit newlines', () => {
    const lines = breakTextBlock('Line one\nLine two\nLine three', 100);
    expect(lines.length).toBe(3);
    expect(lines[0]!.text).toBe('Line one');
    expect(lines[1]!.text).toBe('Line two');
    expect(lines[2]!.text).toBe('Line three');
  });

  it('handles empty lines', () => {
    const lines = breakTextBlock('A\n\nB', 100);
    expect(lines.length).toBe(3);
    expect(lines[1]!.text).toBe('');
  });

  it('keeps long single words unbroken', () => {
    const lines = breakTextBlock('supercalifragilisticexpialidocious', 5);
    expect(lines.length).toBe(1);
    expect(lines[0]!.text).toBe('supercalifragilisticexpialidocious');
  });

  it('is deterministic', () => {
    const text = 'The quick brown fox jumps over the lazy dog. Again and again and again.';
    const a = breakTextBlock(text, 12);
    const b = breakTextBlock(text, 12);
    expect(a).toEqual(b);
  });
});

describe('textBlock validation', () => {
  it('validates a well-formed textBlock spec', () => {
    const result = validateSpec(textBlockSpec());
    expect(result.valid).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  it('rejects empty text', () => {
    const result = validateSpec(textBlockSpec({ text: '' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path.includes('text'))).toBe(true);
  });

  it('rejects missing maxWidth', () => {
    const spec = textBlockSpec();
    delete (spec.layers[0]!.sprite as Record<string, unknown>).maxWidth;
    const result = validateSpec(spec);
    expect(result.valid).toBe(false);
  });

  it('rejects fontSize out of range', () => {
    expect(validateSpec(textBlockSpec({ fontSize: 0.001 })).valid).toBe(false);
    expect(validateSpec(textBlockSpec({ fontSize: 0.5 })).valid).toBe(false);
  });

  it('rejects bad lineHeight', () => {
    expect(validateSpec(textBlockSpec({ lineHeight: 0.1 })).valid).toBe(false);
    expect(validateSpec(textBlockSpec({ lineHeight: 5 })).valid).toBe(false);
  });

  it('accepts valid lineHeight', () => {
    expect(validateSpec(textBlockSpec({ lineHeight: 1.6 })).valid).toBe(true);
  });

  it('warns about unknown sprite properties', () => {
    const result = validateSpec(textBlockSpec({ bogus: true }));
    expect(result.warnings?.some((w) => w.code === 'unknown-property')).toBe(true);
  });

  it('rejects units: px with textBlock', () => {
    const spec = textBlockSpec();
    (spec as unknown as Record<string, unknown>).units = 'px';
    const result = validateSpec(spec);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === 'units' && e.message.includes('textBlock'))).toBe(true);
  });
});

describe('textBlock perception', () => {
  it('align shifts box position', () => {
    const shortSpec = (align: string) => textBlockSpec({ text: 'Hi', maxWidth: 0.5, align });
    const lGrid = luminanceGrid(shortSpec('left'), { t: 0 });
    const cGrid = luminanceGrid(shortSpec('center'), { t: 0 });
    const rGrid = luminanceGrid(shortSpec('right'), { t: 0 });
    const litCols = (grid: LuminanceGrid) => {
      const cols = new Set<number>();
      for (let r = 0; r < grid.rows; r++)
        for (let c = 0; c < grid.cols; c++)
          if (grid.cells[r * grid.cols + c]! > grid.background[r]! + 0.01) cols.add(c);
      return cols;
    };
    const lCols = litCols(lGrid);
    const cCols = litCols(cGrid);
    const rCols = litCols(rGrid);
    const minOf = (s: Set<number>) => Math.min(...s);
    expect(minOf(cCols)).toBeGreaterThan(minOf(lCols));
    expect(minOf(rCols)).toBeGreaterThan(minOf(cCols));
    expect(minOf(cCols) - minOf(lCols)).toBeGreaterThan(5);
  });
  it('reports textBlock in textSprites', () => {
    const spec = textBlockSpec();
    const sprites = textSprites(spec);
    expect(sprites.length).toBe(1);
    expect(sprites[0]!.strings).toEqual([
      'Hello world, this is a deterministic text block with wrapping.',
    ]);
    expect(sprites[0]!.sizePx).toBeGreaterThan(0);
  });

  it('contributes to luminance coverage', () => {
    const spec = textBlockSpec();
    const opts: PerceiveOptions = { t: 0 };
    const scene = perceiveScene(spec, opts);
    expect(scene.coverage).toBeGreaterThan(0);
  });
});

describe('textBlock advisory', () => {
  it('flags text-heavy spec', () => {
    const spec: SaverSpec = {
      schemaVersion: 1,
      id: 'heavy',
      label: 'Heavy',
      layers: [
        {
          count: 1,
          sprite: { kind: 'textBlock', text: 'A', maxWidth: 0.5, fontSize: 0.04 },
          motion: { type: 'static' },
          position: { x: 0.1, y: 0.1 },
        },
        {
          count: 1,
          sprite: { kind: 'textBlock', text: 'B', maxWidth: 0.5, fontSize: 0.04 },
          motion: { type: 'static' },
          position: { x: 0.1, y: 0.5 },
        },
      ],
    };
    const warnings = adviseSpec(spec);
    expect(warnings.some((w) => w.code === 'text-heavy')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// reveal — animated typing/deleting (G6)
// ---------------------------------------------------------------------------

import { graphemeClusters, revealState } from './simulate';
import { structuralSignature, applyDeltasToSpec } from './steer';

describe('graphemeClusters', () => {
  it('splits plain ASCII per character', () => {
    expect(graphemeClusters('abc')).toEqual(['a', 'b', 'c']);
  });

  it('keeps surrogate pairs whole', () => {
    expect(graphemeClusters('a😀b')).toEqual(['a', '😀', 'b']);
  });

  it('attaches combining marks to their base', () => {
    expect(graphemeClusters('éx')).toEqual(['é', 'x']);
  });

  it('keeps ZWJ emoji families as one cluster', () => {
    const family = '👨‍👩‍👧';
    expect(graphemeClusters(`${family}!`)).toEqual([family, '!']);
  });

  it('pairs regional indicators into flags', () => {
    const flag = '🇺🇸';
    expect(graphemeClusters(`${flag}a`)).toEqual([flag, 'a']);
  });

  it('attaches skin-tone modifiers', () => {
    const waving = '👋🏽';
    expect(graphemeClusters(waving)).toEqual([waving]);
  });
});

describe('revealState', () => {
  const lines = breakTextBlock('Hello world\nsecond line', 100);

  it('progress 1 shows everything', () => {
    const st = revealState(lines, { progress: 1 }, 0);
    expect(st.fullLines).toBe(lines.length);
    expect(st.partialText).toBe('');
    expect(st.progress).toBe(1);
  });

  it('progress 0 shows nothing, caret at start', () => {
    const st = revealState(lines, { progress: 0 }, 0);
    expect(st.fullLines).toBe(0);
    expect(st.partialText).toBe('');
    expect(st.caretLine).toBe(0);
    expect(st.caretPrefix).toBe('');
  });

  it('typewriter mid-progress yields a grapheme prefix of line 0', () => {
    const total = lines.reduce((n, l) => n + graphemeClusters(l.text).length, 0);
    const st = revealState(lines, { progress: 4 / total }, 0);
    expect(st.fullLines).toBe(0);
    expect(st.partialText).toBe('Hell');
    expect(st.caretLine).toBe(0);
    expect(st.caretPrefix).toBe('Hell');
  });

  it('word mode reveals whole words', () => {
    const st = revealState(lines, { progress: 0.25, mode: 'word' }, 0);
    // 4 words total; 25% = 1 word.
    expect(st.partialText).toBe('Hello');
  });

  it('line mode reveals whole lines only', () => {
    const st = revealState(lines, { progress: 0.5, mode: 'line' }, 0);
    expect(st.fullLines).toBe(1);
    expect(st.partialText).toBe('');
  });

  it('speed drives progress from t and is capped by authored progress', () => {
    const total = lines.reduce((n, l) => n + graphemeClusters(l.text).length, 0);
    // 10 graphemes/sec at t=1000ms → 10 graphemes.
    const timed = revealState(lines, { speed: 10 }, 1000);
    expect(timed.progress).toBeCloseTo(10 / total, 5);
    // Authored progress holds a self-typing block back.
    const held = revealState(lines, { speed: 10, progress: 0.1 }, 60000);
    expect(held.progress).toBeCloseTo(0.1, 5);
    // And past the end, timed progress clamps to 1.
    const done = revealState(lines, { speed: 10 }, 60000);
    expect(done.progress).toBe(1);
  });

  it('never splits a surrogate pair at the frontier', () => {
    const emojiLines = breakTextBlock('😀😀😀😀', 100);
    for (let p = 0; p <= 1; p += 0.1) {
      const st = revealState(emojiLines, { progress: p }, 0);
      // Any prefix must be valid (no lone surrogates).
      expect(st.partialText).not.toMatch(/[\uD800-\uDBFF]$/);
    }
  });
});

describe('reveal is paint, not carpentry', () => {
  it('structuralSignature ignores reveal entirely', () => {
    const a = textBlockSpec();
    const b = textBlockSpec({ reveal: { progress: 0.3, mode: 'word', caret: true } });
    expect(structuralSignature(b)).toBe(structuralSignature(a));
  });

  it('reveal.progress is steerable via applyDeltasToSpec', () => {
    const spec = textBlockSpec({ reveal: { progress: 0 } });
    const out = applyDeltasToSpec(spec, [{ t: 0, path: 'layers.0.sprite.reveal.progress', value: 0.75 }]);
    const sprite = out.layers[0]!.sprite as { reveal?: { progress?: number } };
    expect(sprite.reveal?.progress).toBe(0.75);
    expect(structuralSignature(out)).toBe(structuralSignature(spec));
  });
});

describe('reveal validation', () => {
  it('accepts a full valid reveal', () => {
    const res = validateSpec(textBlockSpec({
      reveal: { progress: 0.5, mode: 'typewriter', speed: 12, caret: { blink: 1.5, color: '#ffffff' } },
    }));
    expect(res.valid).toBe(true);
  });

  it('rejects out-of-range progress', () => {
    const res = validateSpec(textBlockSpec({ reveal: { progress: 1.5 } }));
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.path.includes('reveal.progress'))).toBe(true);
  });

  it('rejects bad mode', () => {
    const res = validateSpec(textBlockSpec({ reveal: { mode: 'glyph' } }));
    expect(res.valid).toBe(false);
  });

  it('rejects caret blink above the flash-safety cap', () => {
    const res = validateSpec(textBlockSpec({ reveal: { caret: { blink: 5 } } }));
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.path.includes('caret.blink'))).toBe(true);
  });

  it('rejects unknown reveal fields', () => {
    const res = validateSpec(textBlockSpec({ reveal: { progress: 1, wobble: true } }));
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.path.includes('reveal.wobble'))).toBe(true);
  });

  it('rejects excessive speed', () => {
    const res = validateSpec(textBlockSpec({ reveal: { speed: 500 } }));
    expect(res.valid).toBe(false);
  });
});

describe('reveal in perceive', () => {
  it('textSprites reports the revealed fraction', () => {
    const spec = textBlockSpec({ reveal: { progress: 0.5 } });
    const infos = textSprites(spec);
    expect(infos[0]!.revealed).toBeCloseTo(0.5, 2);
  });

  it('luminance scales with reveal progress', () => {
    const dark = luminanceGrid(textBlockSpec({ reveal: { progress: 0.1 } }));
    const lit = luminanceGrid(textBlockSpec({ reveal: { progress: 1 } }));
    const sum = (g: LuminanceGrid) => g.cells.reduce((a: number, b: number) => a + b, 0);
    expect(sum(lit)).toBeGreaterThan(sum(dark));
  });
});

// ---------------------------------------------------------------------------
// glyphFade — staggered per-glyph alpha (G6)
// ---------------------------------------------------------------------------

describe('revealState glyphFade', () => {
  const lines = breakTextBlock('Hello world\nsecond line', 100);
  const clusterCounts = lines.map((l) => graphemeClusters(l.text).length);

  it('returns per-line alphas parallel to the grapheme clusters', () => {
    const st = revealState(lines, { mode: 'glyphFade', progress: 0.5 }, 0);
    expect(st.glyphAlphas!.map((a) => a.length)).toEqual(clusterCounts);
  });

  it('other modes return no alphas', () => {
    expect(revealState(lines, { progress: 0.5 }, 0).glyphAlphas).toBeUndefined();
  });

  it('progress 0 is fully transparent, progress 1 fully opaque', () => {
    const at0 = revealState(lines, { mode: 'glyphFade', progress: 0 }, 0);
    expect(at0.glyphAlphas!.flat().every((a) => a === 0)).toBe(true);
    const at1 = revealState(lines, { mode: 'glyphFade', progress: 1 }, 0);
    expect(at1.glyphAlphas!.flat().every((a) => a === 1)).toBe(true);
  });

  it('alphas fall in reading order and rise monotonically with progress', () => {
    let prev: number[] | null = null;
    for (let p = 0; p <= 1.001; p += 0.05) {
      const flat = revealState(lines, { mode: 'glyphFade', progress: p }, 0).glyphAlphas!.flat();
      for (let i = 1; i < flat.length; i++) expect(flat[i]!).toBeLessThanOrEqual(flat[i - 1]!);
      if (prev) for (let i = 0; i < flat.length; i++) expect(flat[i]!).toBeGreaterThanOrEqual(prev[i]!);
      prev = flat;
    }
  });

  it('a wider fade window keeps more glyphs mid-fade', () => {
    const partials = (fade: number) =>
      revealState(lines, { mode: 'glyphFade', progress: 0.5, fade }, 0)
        .glyphAlphas!.flat().filter((a) => a > 0 && a < 1).length;
    expect(partials(0.8)).toBeGreaterThan(partials(0.05));
  });

  it('assigns one alpha per grapheme cluster, not per code unit', () => {
    const emojiLines = breakTextBlock('👨‍👩‍👧😀', 100);
    const st = revealState(emojiLines, { mode: 'glyphFade', progress: 0.5 }, 0);
    expect(st.glyphAlphas![0]!.length).toBe(2);
  });

  it('keeps the typewriter frontier for the caret', () => {
    const total = clusterCounts.reduce((a, b) => a + b, 0);
    const st = revealState(lines, { mode: 'glyphFade', progress: 4 / total }, 0);
    expect(st.caretPrefix).toBe('Hell');
  });

  it('speed still drives progress in glyphFade mode', () => {
    const timed = revealState(lines, { mode: 'glyphFade', speed: 10 }, 500);
    expect(timed.glyphAlphas!.flat().some((a) => a > 0)).toBe(true);
    expect(timed.glyphAlphas!.flat().some((a) => a === 0)).toBe(true);
  });
});

describe('glyphFade validation and steering', () => {
  it('accepts glyphFade with a fade window', () => {
    const res = validateSpec(textBlockSpec({ reveal: { mode: 'glyphFade', progress: 0.5, fade: 0.3 } }));
    expect(res.valid).toBe(true);
  });

  it('rejects fade outside (0, 1]', () => {
    for (const fade of [0, -0.1, 1.5]) {
      const res = validateSpec(textBlockSpec({ reveal: { mode: 'glyphFade', fade } }));
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.path.includes('reveal.fade'))).toBe(true);
    }
  });

  it('fade is paint and steerable', () => {
    const spec = textBlockSpec({ reveal: { mode: 'glyphFade', fade: 0.1 } });
    expect(structuralSignature(spec)).toBe(structuralSignature(textBlockSpec()));
    const out = applyDeltasToSpec(spec, [{ t: 0, path: 'layers.0.sprite.reveal.fade', value: 0.4 }]);
    expect((out.layers[0]!.sprite as { reveal?: { fade?: number } }).reveal?.fade).toBe(0.4);
  });
});

describe('glyphFade in perceive', () => {
  it('revealed reports the mean glyph alpha', () => {
    const at = (progress: number) =>
      textSprites(textBlockSpec({ reveal: { mode: 'glyphFade', progress } }))[0]!.revealed!;
    expect(at(0)).toBe(0);
    expect(at(1)).toBe(1);
    const mid = at(0.5);
    expect(mid).toBeGreaterThan(0.3);
    expect(mid).toBeLessThan(0.7);
  });

  it('luminance grows with glyphFade progress', () => {
    const dim = luminanceGrid(textBlockSpec({ reveal: { mode: 'glyphFade', progress: 0.2 } }));
    const lit = luminanceGrid(textBlockSpec({ reveal: { mode: 'glyphFade', progress: 0.9 } }));
    const sum = (g: LuminanceGrid) => g.cells.reduce((a: number, b: number) => a + b, 0);
    expect(sum(lit)).toBeGreaterThan(sum(dim));
  });
});

// ---------------------------------------------------------------------------
// anchor / font / opacity / lifted maxWidth (ambient presentations 1a)
// ---------------------------------------------------------------------------

describe('textBlock anchor / font / opacity validation', () => {
  it('accepts every compass anchor', () => {
    for (const anchor of ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right']) {
      expect(validateSpec(textBlockSpec({ anchor })).valid).toBe(true);
    }
  });

  it('rejects an unknown anchor', () => {
    const res = validateSpec(textBlockSpec({ anchor: 'middle' }));
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.path.endsWith('.anchor'))).toBe(true);
  });

  it('accepts a family/weight font and rejects one carrying a size', () => {
    expect(validateSpec(textBlockSpec({ font: 'bold monospace' })).valid).toBe(true);
    expect(validateSpec(textBlockSpec({ font: "300 'Inter', sans-serif" })).valid).toBe(true);
    for (const font of ['bold 14px monospace', '12pt serif', '1.2em sans-serif', '50% monospace', '50%monospace', '14pxmonospace', '']) {
      const res = validateSpec(textBlockSpec({ font }));
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.path.endsWith('.font'))).toBe(true);
    }
    expect(validateSpec(textBlockSpec({ font: 12 })).valid).toBe(false);
  });

  it('accepts opacity in 0..1 and rejects outside', () => {
    expect(validateSpec(textBlockSpec({ opacity: 0 })).valid).toBe(true);
    expect(validateSpec(textBlockSpec({ opacity: 0.4 })).valid).toBe(true);
    expect(validateSpec(textBlockSpec({ opacity: 1 })).valid).toBe(true);
    expect(validateSpec(textBlockSpec({ opacity: 1.2 })).valid).toBe(false);
    expect(validateSpec(textBlockSpec({ opacity: -0.1 })).valid).toBe(false);
    expect(validateSpec(textBlockSpec({ opacity: '1' })).valid).toBe(false);
  });

  it('maxWidth may exceed the frame up to 2.0 of min(w,h)', () => {
    expect(validateSpec(textBlockSpec({ maxWidth: 1.5 })).valid).toBe(true);
    expect(validateSpec(textBlockSpec({ maxWidth: 2 })).valid).toBe(true);
    expect(validateSpec(textBlockSpec({ maxWidth: 2.01 })).valid).toBe(false);
    expect(validateSpec(textBlockSpec({ maxWidth: 0 })).valid).toBe(false);
  });

  it('the new fields are known properties (no unknown-property warning)', () => {
    const res = validateSpec(textBlockSpec({ anchor: 'center', font: 'bold monospace', opacity: 0.8 }));
    expect(res.valid).toBe(true);
    expect(res.warnings?.some((w) => w.code === 'unknown-property')).toBeFalsy();
  });
});

describe('textBlock anchor in perception and steering', () => {
  const litCols = (grid: LuminanceGrid) => {
    const cols: number[] = [];
    for (let r = 0; r < grid.rows; r++)
      for (let c = 0; c < grid.cols; c++)
        if (grid.cells[r * grid.cols + c]! > grid.background[r]! + 0.01) cols.push(c);
    return cols;
  };

  for (const [width, height] of [[1920, 1080], [1080, 1080]] as const) {
    it(`anchor: 'center' at position 0.5/0.5 is centred in the luminance grid on ${width}×${height}`, () => {
      const spec = textBlockSpec({ text: 'Centred title', maxWidth: 0.9, anchor: 'center' });
      spec.layers[0]!.position = { x: 0.5, y: 0.5 };
      const grid = luminanceGrid(spec, { t: 0, viewport: { width, height } });
      const cols = litCols(grid);
      expect(cols.length).toBeGreaterThan(0);
      const mid = (Math.min(...cols) + Math.max(...cols) + 1) / 2 / grid.cols;
      expect(Math.abs(mid - 0.5)).toBeLessThan(0.03);
      const scene = perceiveScene(spec, { t: 0, viewport: { width, height } });
      expect(Math.abs(scene.centroid!.y - 0.5)).toBeLessThan(0.05);
    });
  }

  it('advisory boxes follow the anchor (text-off-screen)', () => {
    const wide = (anchor?: string) => {
      const spec = textBlockSpec({ text: 'A caption that is long enough to run off the frame', maxWidth: 1.2, fontSize: 0.06, ...(anchor ? { anchor } : {}) });
      spec.layers[0]!.position = { x: 0.95, y: 0.5 };
      return adviseSpec(spec).some((w) => w.code === 'text-off-screen');
    };
    expect(wide()).toBe(true);
    expect(wide('top-left')).toBe(true);
    expect(wide('right')).toBe(false);
  });

  it('anchor is structural; font and opacity are paint', () => {
    const base = structuralSignature(textBlockSpec());
    expect(structuralSignature(textBlockSpec({ anchor: 'center' }))).not.toBe(base);
    expect(structuralSignature(textBlockSpec({ font: 'bold monospace', opacity: 0.3 }))).toBe(base);
    // Gliding opacity keeps the signature equal — no rebuild.
    const spec = textBlockSpec({ opacity: 1 });
    const out = applyDeltasToSpec(spec, [{ t: 0, path: 'layers.0.sprite.opacity', value: 0 }]);
    expect((out.layers[0]!.sprite as { opacity?: number }).opacity).toBe(0);
    expect(structuralSignature(out)).toBe(structuralSignature(spec));
  });

  it('opacity scales perceived ink', () => {
    const sum = (g: LuminanceGrid) => g.cells.reduce((a: number, b: number) => a + b, 0);
    expect(sum(luminanceGrid(textBlockSpec({ opacity: 0.2 }), { t: 0 })))
      .toBeLessThan(sum(luminanceGrid(textBlockSpec(), { t: 0 })));
  });
});

describe('monospace metrics class (textBlock.font)', () => {
  it('selects mono for monospace families and proportional otherwise', () => {
    for (const f of ['monospace', 'bold monospace', "'SF Mono', monospace", 'Menlo', 'Courier New', 'ui-monospace', 'Fira Code', 'JetBrains Mono', 'SFMono-Regular', '-apple-system, BlinkMacSystemFont, "SFMono-Regular", Menlo, monospace']) {
      expect(textMetricsClassFor(f)).toBe('mono');
    }
    for (const f of [undefined, 'bold sans-serif', "300 'Inter', sans-serif", 'serif', 'Monotype Corsiva']) {
      expect(textMetricsClassFor(f)).toBe('proportional');
    }
  });

  it('mono advances every glyph by the same cell', () => {
    expect(textWidthEm('iiii', 'mono')).toBe(textWidthEm('mmmm', 'mono'));
    expect(textWidthEm('a b', 'mono')).toBeCloseTo(1.8, 9);
    expect(textWidthEm('iiii')).toBeLessThan(textWidthEm('mmmm'));
  });

  it('mono counts grapheme clusters, not UTF-16 code units — an emoji is one cell', () => {
    // '😀' is a surrogate pair (2 UTF-16 units) but one grapheme / one advance cell.
    expect(textWidthEm('a😀b', 'mono')).toBeCloseTo(3 * 0.6, 9);
    expect(textWidthEm('a😀b', 'mono')).toBe(textWidthEm('abc', 'mono'));
  });

  it('breaks differ from the proportional table for narrow-heavy text; default is unchanged', () => {
    const text = 'iiii iiii iiii iiii';
    expect(breakTextBlock(text, 8).length).toBe(1);
    expect(breakTextBlock(text, 8, 'proportional')).toEqual(breakTextBlock(text, 8));
    const mono = breakTextBlock(text, 8, 'mono');
    expect(mono.length).toBeGreaterThan(1);
    expect(mono.every((l) => l.widthEm <= 8)).toBe(true);
  });

  it('a mono font widens the perceived box', () => {
    const prop = textSprites(textBlockSpec({ text: 'iiii iiii', maxWidth: 1 }));
    const mono = textSprites(textBlockSpec({ text: 'iiii iiii', maxWidth: 1, font: 'monospace' }));
    expect(prop[0]!.sizePx).toBe(mono[0]!.sizePx);
    const cols = (spec: SaverSpec) => {
      const g = luminanceGrid(spec, { t: 0 });
      let n = 0;
      for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) if (g.cells[r * g.cols + c]! > g.background[r]! + 0.01) n++;
      return n;
    };
    expect(cols(textBlockSpec({ text: 'iiii iiii', maxWidth: 1, font: 'monospace', fontSize: 0.08 })))
      .toBeGreaterThan(cols(textBlockSpec({ text: 'iiii iiii', maxWidth: 1, fontSize: 0.08 })));
  });
});
