'use client';

import { useEffect, useRef, useState } from 'react';
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
  stock_qty: number;
  low_stock_threshold: number | null;

  uom_id?: string | null; // FK
  uom_code?: string;      // normalized
}

export default function Items() {
  const [items, setItems] = useState<Item[]>([]);
  const [uoms, setUoms] = useState<Uom[]>([]);
  const [loading, setLoading] = useState(true);

  /** Form state: no price/cost/margin fields anymore */
  const [form, setForm] = useState({
    sku: '',             // will be auto-generated when "Add Item" is pressed
    name: '',
    description: '',
    low_stock_threshold: 0,
    uom_id: '' as string | '',
  });

  /** UI helpers */
  const [isGeneratingSku, setIsGeneratingSku] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement | null>(null);

  const load = async () => {
    setLoading(true);

    // 1) Load items + join UoM, normalize to { uom_code: string }
    const { data: itemsData, error: itemsError } = await supabase
      .from('items')
      .select(`
        id, sku, name, description, stock_qty, low_stock_threshold, uom_id,
        uom:units_of_measure ( code )
      `)
      .order('created_at', { ascending: false });

    if (itemsError) {
      alert(itemsError.message);
    } else {
      const normalized: Item[] = (itemsData ?? []).map((d: any) => ({
        id: d.id,
        sku: d.sku,
        name: d.name,
        description: d.description,
        stock_qty: Number(d.stock_qty ?? 0),
        low_stock_threshold: d.low_stock_threshold ?? null,
        uom_id: d.uom_id ?? null,
        uom_code: Array.isArray(d.uom) ? (d.uom[0]?.code ?? '') : (d.uom?.code ?? ''),
      }));
      setItems(normalized);
    }

    // 2) Load UoMs for the dropdown
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

  /** Generate an item number (SKU) before saving.
   *  Calls Postgres function (RPC) `generate_item_sku`.
   */
  const onAddItem = async () => {
    setIsGeneratingSku(true);
    try {
      const { data, error } = await supabase.rpc('generate_item_sku'); // returns text
      if (error) throw error;
      const nextSku = String(data ?? '').trim();
      if (!nextSku) {
        alert('SKU generator returned empty value.');
        return;
      }

      // Prepare the form for a new item using the generated SKU
      setForm({
        sku: nextSku,
        name: '',
        description: '',
        low_stock_threshold: 0,
        uom_id: '',
      });

      // Move focus to Name
      requestAnimationFrame(() => {
        nameRef.current?.focus();
        nameRef.current?.select?.();
      });
    } catch (err: any) {
      alert(err?.message || 'Failed to generate item number.');
    } finally {
      setIsGeneratingSku(false);
    }
  };

  /** Save new item */
  const onSave = async () => {
    if (!form.sku.trim()) {
      alert('Please click "Add Item" to generate Item Number first.');
      return;
    }
    if (!form.name.trim()) {
      alert('Name is required.');
      return;
    }

    setIsSaving(true);
    try {
      const payload = {
        sku: form.sku.trim(),
        name: form.name.trim(),
        description: form.description?.trim() || null,
        low_stock_threshold: Number.isFinite(form.low_stock_threshold)
          ? Number(form.low_stock_threshold)
          : 0,
        uom_id: form.uom_id || null,
      };

      const { error } = await supabase.from('items').insert([payload]);
      if (error) throw error;

      // Reset and reload
      setForm({
        sku: '',
        name: '',
        description: '',
        low_stock_threshold: 0,
        uom_id: '',
      });
      await load();
      alert('Item saved.');
    } catch (err: any) {
      alert(err?.message || 'Failed to save item.');
    } finally {
      setIsSaving(false);
    }
  };

  /** Delete item */
  const onDelete = async (id: string, sku: string) => {
    const ok = confirm(`Delete item ${sku}? This cannot be undone.`);
    if (!ok) return;

    const { error } = await supabase.from('items').delete().eq('id', id);
    if (error) {
      alert(error.message);
    } else {
      await load();
    }
  };

  return (
    <Protected>
      <div className="grid md:grid-cols-3 gap-4">
        {/* LEFT: Items table */}
        <div className="card md:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-xl font-semibold">Items (Stock)</h1>
          </div>

          {loading ? (
            <p>Loading...</p>
          ) : (
            <div className="overflow-auto">
              <table className="table w-full">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Name</th>
                    <th>UoM</th>
                    <th>Stock</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => {
                    const low =
                      it.low_stock_threshold != null &&
                      it.low_stock_threshold > 0 &&
                      (it.stock_qty || 0) <= it.low_stock_threshold;

                    return (
                      <tr key={it.id} className={low ? 'bg-orange-50' : ''}>
                        <td>{it.sku}</td>
                        <td>{it.name}</td>
                        <td>{it.uom_code || '-'}</td>
                        <td>{it.stock_qty ?? 0}</td>
                        <td className="text-right">
                          <Button
                            onClick={() => onDelete(it.id, it.sku)}
                            className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded"
                          >
                            Delete
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                  {items.length === 0 && (
                    <tr>
                      <td colSpan={5} className="text-center text-gray-500 py-4">
                        No items yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* RIGHT: Add item panel */}
        <div className="card">
          <h2 className="font-semibold mb-2">New Item</h2>

          <div className="space-y-3">
            {/* Top row: two buttons */}
            <div className="flex items-center gap-2">
              <Button onClick={onAddItem} disabled={isGeneratingSku || isSaving}>
                {isGeneratingSku ? 'Generating…' : 'Add Item'}
              </Button>
              <Button onClick={onSave} disabled={isSaving || !form.sku.trim()}>
                {isSaving ? 'Saving…' : 'Save'}
              </Button>
            </div>

            {/* Read-only SKU (auto-generated) */}
            <input
              className="input"
              placeholder="Item Number (auto)"
              value={form.sku}
              onChange={() => {}}
              readOnly
            />

            {/* Name */}
            <input
              ref={nameRef}
              className="input"
              placeholder="Name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
            {/* Description */}
            <textarea
              className="input"
              placeholder="Description"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />

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

            {/* Low stock threshold (optional) */}
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
          </div>
        </div>
      </div>
    </Protected>
  );
}
``
