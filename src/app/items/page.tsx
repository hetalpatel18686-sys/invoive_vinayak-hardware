
'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import Button from '@/components/Button';
import Protected from '@/components/Protected';

/* ---------- Types ---------- */
interface Uom {
  id: string;
  code: string; // e.g., 'EA', 'BOX'
  name: string; // e.g., 'Each', 'Box'
}

interface Item {
  id: string;
  sku: string;
  name: string;
  description?: string | null;
  unit_cost: number;
  unit_price: number;
  tax_rate: number;
  stock_qty: number;
  low_stock_threshold: number | null;

  // From DB
  uom_id?: string | null;
  // Joined (for display)
  uom?: { code: string; name: string } | null;
}

export default function Items() {
  const [items, setItems] = useState<Item[]>([]);
  const [uoms, setUoms] = useState<Uom[]>([]);
  const [loading, setLoading] = useState(true);

  const [form, setForm] = useState({
    sku: '',
    name: '',
    description: '',
    unit_cost: 0,
    unit_price: 0,
    tax_rate: 0,
    low_stock_threshold: 0,
    uom_id: '' as string | '',
  });

  const load = async () => {
    setLoading(true);

    // Load items with join to UoM so we can show code in the table
    const { data: itemsData, error: itemsError } = await supabase
      .from('items')
      .select(`
        id, sku, name, description, unit_cost, unit_price, tax_rate, stock_qty, low_stock_threshold, uom_id,
        uom:units_of_measure ( code, name )
      `)
      .order('created_at', { ascending: false });

    if (itemsError) {
      alert(itemsError.message);
    } else {
      setItems((itemsData as Item[]) ?? []);
    }

    // Load UoMs for the dropdown
    const { data: uomsData, error: uomsError } = await supabase
      .from('units_of_measure')
      .select('id, code, name')
      .order('code', { ascending: true });

    if (uomsError) {
      alert(uomsError.message);
    } else {
      setUoms((uomsData as Uom[]) ?? []);
    }

    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();

    const payload = {
      sku: form.sku.trim(),
      name: form.name.trim(),
      description: form.description?.trim() || null,
      unit_cost: Number(form.unit_cost || 0),
      unit_price: Number(form.unit_price || 0),
      tax_rate: Number(form.tax_rate || 0),
      low_stock_threshold: Number.isFinite(form.low_stock_threshold)
        ? Number(form.low_stock_threshold)
        : 0,
      uom_id: form.uom_id || null,   // <-- save selection (null allowed)
    };

    const { error } = await supabase.from('items').insert([payload]);
    if (error) {
      alert(error.message);
    } else {
      // Reset the form
      setForm({
        sku: '',
        name: '',
        description: '',
        unit_cost: 0,
        unit_price: 0,
        tax_rate: 0,
        low_stock_threshold: 0,
        uom_id: '',
      });
      load();
    }
  };

  return (
    <Protected>
      <div className="grid md:grid-cols-3 gap-4">
        {/* LEFT: Items table */}
        <div className="card md:col-span-2">
          <h1 className="text-xl font-semibold mb-3">Items &amp; Pricing</h1>
          {loading ? (
            <p>Loading...</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Name</th>
                  <th>UoM</th>
                  <th>Price</th>
                  <th>Cost</th>
                  <th>Margin</th>
                  <th>Stock</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => {
                  const margin = (it.unit_price || 0) - (it.unit_cost || 0);
                  const pct =
                    (it.unit_price || 0) > 0
                      ? (margin / it.unit_price) * 100
                      : 0;
                  const low =
                    it.low_stock_threshold != null &&
                    it.low_stock_threshold > 0 &&
                    (it.stock_qty || 0) <= it.low_stock_threshold;

                  return (
                    <tr key={it.id} className={low ? 'bg-orange-50' : ''}>
                      <td>{it.sku}</td>
                      <td>{it.name}</td>
                      <td>{it.uom?.code ?? '-'}</td>
                      <td>${(it.unit_price || 0).toFixed(2)}</td>
                      <td>${(it.unit_cost || 0).toFixed(2)}</td>
                      <td>
                        {margin.toFixed(2)} ({pct.toFixed(1)}%)
                      </td>
                      <td>{it.stock_qty ?? 0}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* RIGHT: Add item form */}
        <div className="card">
          <h2 className="font-semibold mb-2">Add New Item</h2>
          <form onSubmit={add} className="space-y-3">
            <input
              className="input"
              placeholder="SKU"
              value={form.sku}
              onChange={(e) => setForm({ ...form, sku: e.target.value })}
              required
            />
            <input
              className="input"
              placeholder="Name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
            <textarea
              className="input"
              placeholder="Description"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />

            <div className="grid grid-cols-3 gap-2">
              <input
                className="input"
                type="number"
                step="0.01"
                placeholder="Cost"
                value={form.unit_cost}
                onChange={(e) =>
                  setForm({ ...form, unit_cost: parseFloat(e.target.value || '0') })
                }
              />
              <input
                className="input"
                type="number"
                step="0.01"
                placeholder="Price"
                value={form.unit_price}
                onChange={(e) =>
                  setForm({ ...form, unit_price: parseFloat(e.target.value || '0') })
                }
              />
              <input
                className="input"
                type="number"
                step="0.01"
                placeholder="Tax %"
                value={form.tax_rate}
                onChange={(e) =>
                  setForm({ ...form, tax_rate: parseFloat(e.target.value || '0') })
                }
              />
            </div>

            {/* UoM SELECT */}
            <select
              className="input"
              value={form.uom_id}
              onChange={(e) => setForm({ ...form, uom_id: e.target.value })}
            >
              <option value="">Select Unit of Measure (optional)</option>
              {uoms.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.code} — {u.name}
                </option>
              ))}
            </select>

            {/* Removed: Profit preview line */}

            <input
              className="input"
              type="number"
              placeholder="Low stock threshold"
              value={form.low_stock_threshold}
              onChange={(e) =>
                setForm({
                  ...form,
                  low_stock_threshold: parseInt(e.target.value || '0', 10),
                })
              }
            />
            <Button type="submit">Add Item</Button>
          </form>
        </div>
      </div>
    </Protected>
  );
}
