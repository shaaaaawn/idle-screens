import { describe, expect, it } from 'vitest';
import { breakTextBlock } from './simulate';
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
