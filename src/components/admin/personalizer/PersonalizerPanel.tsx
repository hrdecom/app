import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, Rocket } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { FieldList } from './FieldList';
import { FieldConfigForm } from './FieldConfigForm';
import { PersonalizerCanvas } from './PersonalizerCanvas';
import {
  getTemplate, createTemplate, updateTemplate, createField, updateField,
  type PersonalizerTemplate, type PersonalizerField,
} from '@/lib/personalizer-api';

interface Props {
  productId: number;
  baseImageUrl: string | null;
  shopifyHandle: string | null;
}

export function PersonalizerPanel({ productId, baseImageUrl, shopifyHandle }: Props) {
  const { toast } = useToast();
  const [tpl, setTpl] = useState<PersonalizerTemplate | null>(null);
  const [selectedFieldId, setSelectedFieldId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const created = await createTemplate({
        product_id: productId,
        base_image_url: baseImageUrl || undefined,
        shopify_product_handle: shopifyHandle || undefined,
      });
      const fresh = await getTemplate(created.id);
      setTpl(fresh);
      const first = (fresh.fields || [])[0];
      if (first) setSelectedFieldId(first.id);
    } catch (e: any) {
      toast({ title: 'Failed to load template', description: e?.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [productId]);

  async function handleAddText() {
    if (!tpl) return;
    const created = await createField(tpl.id, {
      field_kind: 'text',
      label: 'New text',
      placeholder: 'Type here',
      default_value: null,
      required: 0,
      max_chars: 12,
      font_family: 'Pinyon Script',
      font_size_px: 22,
      font_color: '#FAEEDA',
      curve_mode: 'linear',
      position_x: 100, position_y: 100, width: 200, height: 40,
      layer_z: 10,
    });
    await load();
    setSelectedFieldId(created.id);
  }
  async function handleAddImage() {
    if (!tpl) return;
    const created = await createField(tpl.id, {
      field_kind: 'image',
      label: 'Photo',
      mask_shape: 'rect',
      position_x: 100, position_y: 100, width: 200, height: 200,
      layer_z: 5,
    });
    await load();
    setSelectedFieldId(created.id);
  }

  async function handlePatch(patch: Partial<PersonalizerField>) {
    if (!selectedFieldId) return;
    await updateField(selectedFieldId, patch);
    setTpl((prev) => prev && {
      ...prev,
      fields: (prev.fields || []).map((f) => f.id === selectedFieldId ? { ...f, ...patch } as PersonalizerField : f),
    });
  }

  async function handlePublish() {
    if (!tpl) return;
    setSaving(true);
    try {
      await updateTemplate(tpl.id, { status: 'published' });
      toast({ title: 'Personalizer published', description: 'Storefront will pick up the change on next page load.' });
    } catch (e: any) {
      toast({ title: 'Publish failed', description: e?.message, variant: 'destructive' });
    } finally { setSaving(false); }
  }

  if (loading || !tpl) {
    return <div className="flex items-center justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  const selected = (tpl.fields || []).find((f) => f.id === selectedFieldId) || null;

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-gray-200 px-4 py-2 flex items-center justify-between">
        <div className="text-sm font-medium">Personalizer · {tpl.status}</div>
        <Button size="sm" onClick={handlePublish} disabled={saving}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Rocket className="h-3.5 w-3.5 mr-1" />}
          Publish
        </Button>
      </div>
      <div className="flex flex-1 min-h-0">
        <FieldList
          fields={tpl.fields || []}
          selectedId={selectedFieldId}
          onSelect={setSelectedFieldId}
          onAddText={handleAddText}
          onAddImage={handleAddImage}
          onReorder={() => { /* v2 — drag-reorder */ }}
        />
        <div className="flex-1 p-4 overflow-y-auto">
          <PersonalizerCanvas
            template={tpl}
            fields={tpl.fields || []}
            selectedFieldId={selectedFieldId}
            onSelect={setSelectedFieldId}
          />
        </div>
        {selected && <FieldConfigForm field={selected} onPatch={handlePatch} />}
      </div>
    </div>
  );
}
