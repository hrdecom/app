import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { listOrders, updateOrder, type PersonalizerOrder, type ProductionStatus } from '@/lib/personalizer-api';

const TABS: { id: ProductionStatus; label: string }[] = [
  { id: 'pending', label: 'Pending' },
  { id: 'in_production', label: 'In production' },
  { id: 'shipped', label: 'Shipped' },
  { id: 'cancelled', label: 'Cancelled' },
];

export function ProductionQueuePanel() {
  const { toast } = useToast();
  const [active, setActive] = useState<ProductionStatus>('pending');
  const [orders, setOrders] = useState<PersonalizerOrder[]>([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try { setOrders(await listOrders({ status: active })); }
    catch (e: any) { toast({ title: 'Failed to load', description: e?.message, variant: 'destructive' }); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [active]);

  async function moveTo(id: number, status: ProductionStatus) {
    await updateOrder(id, { production_status: status });
    await load();
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b border-gray-200">
        {TABS.map((t) => (
          <button key={t.id}
            onClick={() => setActive(t.id)}
            className={['px-3 py-2 text-xs font-medium', active === t.id ? 'border-b-2 border-primary text-foreground' : 'text-muted-foreground'].join(' ')}>
            {t.label}
          </button>
        ))}
      </div>
      {loading ? (
        <div className="flex items-center justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : orders.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground">No orders in this bucket.</Card>
      ) : (
        <div className="space-y-3">
          {orders.map((o) => {
            const values = safeParse(o.values_json) || {};
            const snap = safeParse(o.template_snapshot_json) || {};
            const fields = (snap.fields || []) as any[];
            return (
              <Card key={o.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium">{o.product_title || `Product ${o.product_id}`}</div>
                    <div className="text-xs text-muted-foreground">Order {o.shopify_order_name || o.shopify_order_id} · {new Date(o.created_at).toLocaleString()}</div>
                  </div>
                  <div className="flex gap-2">
                    {active !== 'in_production' && <Button size="sm" variant="outline" onClick={() => moveTo(o.id, 'in_production')}>Start</Button>}
                    {active !== 'shipped' && <Button size="sm" variant="outline" onClick={() => moveTo(o.id, 'shipped')}>Mark shipped</Button>}
                  </div>
                </div>
                <div className="mt-3 space-y-1 text-sm">
                  {fields.map((f) => (
                    <div key={f.id} className="flex gap-2">
                      <span className="text-muted-foreground min-w-[140px]">{f.label}</span>
                      <span className="font-mono">{values[String(f.id)] || <em className="text-muted-foreground">empty</em>}</span>
                    </div>
                  ))}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function safeParse(s: string) { try { return JSON.parse(s); } catch { return null; } }
