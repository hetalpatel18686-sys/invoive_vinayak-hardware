
'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import Button from '@/components/Button';
import Protected from '@/components/Protected';

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
}

export default function Items() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    sku: '',
    name: '',
    description: '',
    unit_cost: 0,
    unit_price: 0,
    tax_rate: 0,
    low_stock_threshold: 0,
  });

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('items')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error) setItems((data as Item[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.from('items').insert([{ ...form }]);
    if (error) alert(error.message);
    else {
      setForm({
        sku: '',
        name: '',
        description: '',
        unit_cost: 0,
        unit_price: 0,
        tax_rate: 0,
        low_stock_threshold: 0,
      });
      load();
    }
  };

  const marginPreview = useMemo(() => {
    const cost = Number(form.unit_cost || 0),
      price = Number(form.unit_price || 0);
    const margin = price - cost;
    const pct = price > 0 ? (margin / price) * 100 : 0;
    return { margin, pct };
  }, [form.unit_cost, form.unit_price]);

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
                  <th>Price</th>
                  <th>Cost</th>
                  <th>Margin</th>
                  <th>Stock</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => {
                  const margin = it.unit_price - it.unit_cost;
                  const pct = it.unit_price > 0 ? (margin / it.unit_price) * 100 : 0;
                  const low =
                    it.low_stock_threshold != null &&
                    it.low_stock_threshold > 0 &&
                    it.stock_qty <= it.low_stock_threshold;

                  return (
                    <tr key={it.id} className={low ? 'bg-orange-50' : ''}>
                      <td>{it.sku}</td>
                      <td>{it.name}</td>
                      <td>${it.unit_price.toFixed(2)}</td>
                      <td>${it.unit_cost.toFixed(2)}</td>
                      <td>
                        {margin.toFixed(2)} ({pct.toFixed(1)}%)
                      </td>
                      <td>{it.stock_qty}</td>
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

            <p className="text-sm text-gray-600">
              Profit preview: ${marginPreview.margin.toFixed(2)} (
              {marginPreview.pct.toFixed(1)}%)
            </p>

            <input
              className="input"
              type="number"
              placeholder="Low stock threshold"
              value={form.low_stock_threshold}
              onChange={(e) =>
                setForm({
                  ...form,
                  low_stock_threshold: parseInt(e.target.value || '0'),
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
