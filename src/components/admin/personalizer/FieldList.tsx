import { Button } from '@/components/ui/button';
import { Plus, Type, Image as ImageIcon, GripVertical } from 'lucide-react';
import type { PersonalizerField } from '@/lib/personalizer-api';

interface Props {
  fields: PersonalizerField[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onAddText: () => void;
  onAddImage: () => void;
  onReorder: (ids: number[]) => void;
}

export function FieldList({ fields, selectedId, onSelect, onAddText, onAddImage, onReorder: _onReorder }: Props) {
  return (
    <div className="border-r border-gray-200 bg-white p-3 space-y-2 min-w-[220px]">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Fields</div>
      <ul className="space-y-1">
        {fields.map((f) => (
          <li
            key={f.id}
            onClick={() => onSelect(f.id)}
            className={[
              'flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-sm',
              selectedId === f.id ? 'bg-primary/10 text-primary' : 'hover:bg-gray-50',
            ].join(' ')}
          >
            <GripVertical className="h-3 w-3 text-muted-foreground" />
            {f.field_kind === 'text' ? <Type className="h-3.5 w-3.5" /> : <ImageIcon className="h-3.5 w-3.5" />}
            <span className="flex-1 truncate">{f.label}</span>
            <span className="text-[10px] text-muted-foreground">z{f.layer_z}</span>
          </li>
        ))}
      </ul>
      <div className="pt-2 space-y-1">
        <Button variant="outline" size="sm" className="w-full justify-start" onClick={onAddText}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Add text field
        </Button>
        <Button variant="outline" size="sm" className="w-full justify-start" onClick={onAddImage}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Add image field
        </Button>
      </div>
    </div>
  );
}
