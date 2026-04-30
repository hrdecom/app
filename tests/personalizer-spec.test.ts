import { describe, it, expect } from 'vitest';
import { buildSpecText, buildSpecJson } from '../functions/lib/personalizer-spec.js';

const snapshot = {
  template: { id: 42, canvas_width: 1080, canvas_height: 1080 },
  fields: [
    {
      id: 1, field_kind: 'text', label: 'First name',
      font_family: 'Pinyon Script', font_size_px: 22, font_color: '#FAEEDA',
      curve_mode: 'linear', position_x: 160, position_y: 151,
      width: 70, height: 22, layer_z: 3,
    },
  ],
};

describe('personalizer-spec.buildSpecText', () => {
  it('formats a single text field for the supplier note', () => {
    const out = buildSpecText({
      productTitle: 'Angel wings heart pendant',
      color: 'Gold',
      snapshot,
      values: { '1': 'Iris' },
    });
    expect(out).toContain('[PERSONALIZATION]');
    expect(out).toContain('Item: Angel wings heart pendant');
    expect(out).toContain('Color: Gold');
    expect(out).toContain('Field "First name": Iris');
    expect(out).toContain('Font: Pinyon Script');
    expect(out).toContain('Position: x=160 y=151');
  });

  it('omits empty optional fields when allow_empty=1', () => {
    const snap = {
      ...snapshot,
      fields: [{ ...snapshot.fields[0], allow_empty: 1 }],
    };
    const out = buildSpecText({ productTitle: 'X', color: '', snapshot: snap, values: { '1': '' } });
    expect(out).not.toContain('Field "First name"');
  });

  it('renders multiple fields stably ordered by sort_order', () => {
    const snap = {
      template: snapshot.template,
      fields: [
        { ...snapshot.fields[0], id: 1, sort_order: 1, label: 'Name 1' },
        { ...snapshot.fields[0], id: 2, sort_order: 0, label: 'Name 2' },
      ],
    };
    const out = buildSpecText({ productTitle: 'X', color: '', snapshot: snap, values: { '1': 'A', '2': 'B' } });
    const idxA = out.indexOf('Name 2');
    const idxB = out.indexOf('Name 1');
    expect(idxA).toBeLessThan(idxB);
  });
});

describe('personalizer-spec.buildSpecJson', () => {
  it('returns a structured object suitable for a Shopify metafield', () => {
    const out = buildSpecJson({
      productTitle: 'Angel wings heart pendant',
      color: 'Gold',
      snapshot,
      values: { '1': 'Iris' },
    });
    expect(out.product).toBe('Angel wings heart pendant');
    expect(out.color).toBe('Gold');
    expect(out.fields).toHaveLength(1);
    expect(out.fields[0]).toMatchObject({
      label: 'First name',
      value: 'Iris',
      font: 'Pinyon Script',
      curve: 'linear',
    });
  });
});
