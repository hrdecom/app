import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { PersonalizerField } from '@/lib/personalizer-api';

const FONTS = [
  'Pinyon Script', 'Great Vibes', 'Cormorant Garamond',
  'Playfair Display', 'Cinzel', 'Inter',
];
const CURVES = ['linear', 'arc', 'circle'] as const;
const MASKS = ['rect', 'circle', 'heart'] as const;

interface Props {
  field: PersonalizerField;
  onPatch: (patch: Partial<PersonalizerField>) => void;
}

export function FieldConfigForm({ field, onPatch }: Props) {
  const [draft, setDraft] = useState(field);
  useEffect(() => { setDraft(field); }, [field.id]);

  function patch<K extends keyof PersonalizerField>(k: K, v: PersonalizerField[K]) {
    setDraft((d) => ({ ...d, [k]: v }));
    onPatch({ [k]: v } as Partial<PersonalizerField>);
  }

  return (
    <div className="bg-white border-l border-gray-200 p-4 space-y-5 min-w-[320px] overflow-y-auto">

      <Section title="Identity">
        <Row label="Label">
          <Input value={draft.label} onChange={(e) => patch('label', e.target.value)} />
        </Row>
        <Row label="Placeholder (gray hint)">
          <Input value={draft.placeholder || ''} onChange={(e) => patch('placeholder', e.target.value || null)} />
        </Row>
        <Row label="Default value (pre-filled, submitted if untouched)">
          <Input value={draft.default_value || ''} onChange={(e) => patch('default_value', e.target.value || null)} />
        </Row>
        <Row label="Required">
          <Select value={draft.required ? 'yes' : 'no'} onValueChange={(v) => patch('required', v === 'yes' ? 1 : 0)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="yes">Required</SelectItem>
              <SelectItem value="no">Optional</SelectItem>
            </SelectContent>
          </Select>
        </Row>
      </Section>

      {draft.field_kind === 'text' && (
        <>
          <Section title="Constraints">
            <Row label="Max characters">
              <Input type="number" value={draft.max_chars || ''} onChange={(e) => patch('max_chars', e.target.value ? parseInt(e.target.value) : null)} />
            </Row>
            <Row label="Allow empty (skip on preview)">
              <Select value={draft.allow_empty ? 'yes' : 'no'} onValueChange={(v) => patch('allow_empty', v === 'yes' ? 1 : 0)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">Allow empty</SelectItem>
                  <SelectItem value="no">Always render</SelectItem>
                </SelectContent>
              </Select>
            </Row>
          </Section>

          <Section title="Typography">
            <Row label="Font family">
              <Select value={draft.font_family || ''} onValueChange={(v) => patch('font_family', v)}>
                <SelectTrigger><SelectValue placeholder="Pick a font" /></SelectTrigger>
                <SelectContent>
                  {FONTS.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                </SelectContent>
              </Select>
            </Row>
            <Row label="Max font size (px)">
              <Input type="number" value={draft.font_size_px || ''} onChange={(e) => patch('font_size_px', e.target.value ? parseInt(e.target.value) : null)} />
            </Row>
            <Row label="Color (hex)">
              <Input value={draft.font_color || ''} onChange={(e) => patch('font_color', e.target.value || null)} placeholder="#FAEEDA" />
            </Row>
            <Row label="Letter spacing (em)">
              <Input type="number" step="0.01" value={draft.letter_spacing ?? ''} onChange={(e) => patch('letter_spacing', e.target.value ? parseFloat(e.target.value) : null)} />
            </Row>
            <Row label="Curve">
              <Select value={draft.curve_mode || 'linear'} onValueChange={(v) => patch('curve_mode', v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CURVES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </Row>
            {(draft.curve_mode === 'arc' || draft.curve_mode === 'circle') && (
              <Row label="Curve radius (px)">
                <Input type="number" value={draft.curve_radius_px || ''} onChange={(e) => patch('curve_radius_px', e.target.value ? parseInt(e.target.value) : null)} />
              </Row>
            )}
          </Section>
        </>
      )}

      {draft.field_kind === 'image' && (
        <Section title="Image">
          <Row label="Mask shape">
            <Select value={draft.mask_shape || 'rect'} onValueChange={(v) => patch('mask_shape', v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {MASKS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </Row>
          <Row label="Max size (KB)">
            <Input type="number" value={draft.image_max_size_kb || 5120} onChange={(e) => patch('image_max_size_kb', parseInt(e.target.value || '5120'))} />
          </Row>
        </Section>
      )}

      <Section title="Geometry">
        <Row label="Position X">
          <Input type="number" value={draft.position_x} onChange={(e) => patch('position_x', parseInt(e.target.value || '0'))} />
        </Row>
        <Row label="Position Y">
          <Input type="number" value={draft.position_y} onChange={(e) => patch('position_y', parseInt(e.target.value || '0'))} />
        </Row>
        <Row label="Width">
          <Input type="number" value={draft.width} onChange={(e) => patch('width', parseInt(e.target.value || '0'))} />
        </Row>
        <Row label="Height">
          <Input type="number" value={draft.height} onChange={(e) => patch('height', parseInt(e.target.value || '0'))} />
        </Row>
        <Row label="Rotation (deg)">
          <Input type="number" step="0.5" value={draft.rotation_deg ?? 0} onChange={(e) => patch('rotation_deg', parseFloat(e.target.value || '0'))} />
        </Row>
        <Row label="Layer z (higher = on top)">
          <Input type="number" value={draft.layer_z} onChange={(e) => patch('layer_z', parseInt(e.target.value || '10'))} />
        </Row>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">{title}</div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
