import { describe, it, expect } from 'vitest';
import { renderPreviewSvg, autoShrinkFontSize } from '../src/lib/personalizer-render';

describe('autoShrinkFontSize', () => {
  it('keeps the requested size when the text fits', () => {
    expect(autoShrinkFontSize('Iris', 22, 70, 12)).toBe(22);
  });

  it('shrinks proportionally when the text overflows', () => {
    const got = autoShrinkFontSize('Constantinople', 22, 70, 12);
    expect(got).toBeGreaterThanOrEqual(12);
    expect(got).toBeLessThan(22);
  });

  it('clamps at the floor', () => {
    expect(autoShrinkFontSize('AVeryLongNameIndeed', 22, 30, 12)).toBe(12);
  });
});

describe('renderPreviewSvg', () => {
  const template = { canvas_width: 1080, canvas_height: 1080, base_image_url: 'https://example.com/p.jpg' };
  const fields = [{
    id: 1, field_kind: 'text' as const, label: 'First name', layer_z: 3,
    font_family: 'Pinyon Script', font_size_px: 22, font_color: '#FAEEDA',
    curve_mode: 'linear' as const, position_x: 160, position_y: 151,
    width: 70, height: 22, sort_order: 0,
  }];

  it('emits a valid SVG with the typed value', () => {
    const svg = renderPreviewSvg({ template, fields, values: { 1: 'Iris' } });
    expect(svg).toMatch(/^<svg /);
    expect(svg).toContain('Iris');
    expect(svg).toContain('viewBox="0 0 1080 1080"');
  });

  it('falls back to default_value when value is missing', () => {
    const f = [{ ...fields[0], default_value: 'Camille' }];
    const svg = renderPreviewSvg({ template, fields: f, values: {} });
    expect(svg).toContain('Camille');
    expect(svg).not.toContain('Iris');
  });

  it('emits a textPath element when curve_mode=circle', () => {
    const f = [{ ...fields[0], curve_mode: 'circle' as const, curve_radius_px: 80 }];
    const svg = renderPreviewSvg({ template, fields: f, values: { 1: 'Iris' } });
    expect(svg).toContain('<path');
    expect(svg).toContain('textPath');
  });

  it('orders fields by layer_z ascending so higher z renders on top', () => {
    const f = [
      { ...fields[0], id: 1, layer_z: 5, default_value: 'BACK' },
      { ...fields[0], id: 2, layer_z: 1, default_value: 'FRONT' },
    ];
    const svg = renderPreviewSvg({ template, fields: f, values: {} });
    const idxFront = svg.indexOf('FRONT');
    const idxBack = svg.indexOf('BACK');
    expect(idxFront).toBeLessThan(idxBack);
  });
});
