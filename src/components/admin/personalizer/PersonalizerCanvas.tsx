import { useEffect, useRef } from 'react';
import { renderPreviewSvg } from '@/lib/personalizer-render';
import type { PersonalizerTemplate, PersonalizerField } from '@/lib/personalizer-api';

interface Props {
  template: PersonalizerTemplate;
  fields: PersonalizerField[];
  selectedFieldId: number | null;
  onSelect: (id: number) => void;
}

export function PersonalizerCanvas({ template, fields, selectedFieldId, onSelect }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const values: Record<number, string> = {};
    for (const f of fields) {
      values[f.id] = f.default_value || f.placeholder || (f.field_kind === 'text' ? '' : '');
    }
    const svg = renderPreviewSvg({
      template: { canvas_width: template.canvas_width, canvas_height: template.canvas_height, base_image_url: template.base_image_url },
      fields,
      values,
    });
    const overlays = fields
      .map((f) => {
        const sel = f.id === selectedFieldId;
        return `<rect data-field-id="${f.id}" x="${f.position_x}" y="${f.position_y}" width="${f.width}" height="${f.height}" fill="none" stroke="${sel ? '#185FA5' : '#999'}" stroke-dasharray="${sel ? '0' : '4 3'}" stroke-width="${sel ? 2 : 1}" style="cursor:pointer"/>`;
      })
      .join('');
    ref.current.innerHTML = svg.replace('</svg>', overlays + '</svg>');
    const root = ref.current.querySelector('svg');
    if (root) {
      root.addEventListener('click', (e) => {
        const t = e.target as Element;
        const id = t?.getAttribute?.('data-field-id');
        if (id) onSelect(parseInt(id));
      });
    }
  }, [template, fields, selectedFieldId, onSelect]);

  return (
    <div className="bg-gray-50 border border-gray-200 rounded p-4 min-h-[400px] flex items-center justify-center">
      <div ref={ref} className="w-full max-w-[480px]" />
    </div>
  );
}
