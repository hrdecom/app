/**
 * Build the human-readable supplier spec block + the structured JSON
 * used as a Shopify order metafield. Pure functions — no I/O. Consumed
 * by the order webhook receiver.
 */

export function buildSpecText({ productTitle, color, snapshot, values }) {
  const lines = ['[PERSONALIZATION]', `Item: ${productTitle}`];
  if (color) lines.push(`Color: ${color}`);
  const fields = [...(snapshot?.fields || [])].sort(
    (a, b) => (a.sort_order || 0) - (b.sort_order || 0),
  );
  for (const f of fields) {
    const value = values?.[String(f.id)] ?? '';
    if (!value && f.allow_empty) continue;
    if (f.field_kind === 'text') {
      lines.push(`Field "${f.label}": ${value}`);
      const meta = [];
      if (f.font_family) meta.push(`Font: ${f.font_family}`);
      if (f.font_size_px) meta.push(`${f.font_size_px}px`);
      if (f.font_color) meta.push(`Color: ${f.font_color}`);
      if (f.curve_mode) meta.push(`Curve: ${f.curve_mode}`);
      if (meta.length) lines.push(`  ${meta.join(' · ')}`);
      lines.push(`  Position: x=${f.position_x} y=${f.position_y} · Layer: ${f.layer_z ?? 10}`);
    } else if (f.field_kind === 'image') {
      lines.push(`Field "${f.label}" (image): ${value}`);
      if (f.mask_shape) lines.push(`  Mask: ${f.mask_shape}`);
    }
  }
  return lines.join('\n');
}

export function buildSpecJson({ productTitle, color, snapshot, values }) {
  const fields = [...(snapshot?.fields || [])]
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
    .map((f) => ({
      id: f.id,
      kind: f.field_kind,
      label: f.label,
      value: values?.[String(f.id)] ?? '',
      font: f.font_family || null,
      size_px: f.font_size_px || null,
      color: f.font_color || null,
      curve: f.curve_mode || 'linear',
      position: { x: f.position_x, y: f.position_y, w: f.width, h: f.height },
      layer_z: f.layer_z ?? 10,
      mask: f.mask_shape || null,
    }))
    .filter((f) => !(f.value === '' && snapshot.fields.find((x) => x.id === f.id)?.allow_empty));
  return {
    product: productTitle,
    color: color || null,
    fields,
  };
}
