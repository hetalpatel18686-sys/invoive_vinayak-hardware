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

  /** When a draft is created by "Add Item", we keep its ID to update on "Save" */
  const [draftId, setDraftId] = useState<string | null>(null);

  /** Form state (no price/cost/margin) */
  const [form, setForm] = useState({
    sku: '',             // read-only; filled after "Add Item" (from trigger)
    name: '',
    description: '',
    low_stock_threshold: 0,
    uom_id: '' as string | '',
  });

  /** UI helpers */
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement | null>(null);

  const load = async () => {
    setLoading(true);

    // 1) Load items with joined UoM (normalized uom_code)
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

    // 2) Load UoMs for dropdown
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

  /** "Add Item" now creates a draft row so the DB trigger assigns VH-xxx immediately */
  const onAddItem = async () => {
    if (draftId) {
      // Already have a draft; just focus name
      nameRef.current?.focus();
      nameRef.current?.select?.();
      return;
    }
    setIsGenerating(true);
    try {
      // If items.name is NOT NULL, use a placeholder that you'll overwrite on Save
      const { data, error } = await supabase
        .from('items')
        .insert([
          {
            name: '(draft)',           // placeholder; will be updated on Save
            description: null,
            uom_id: null,
            low_stock_threshold: 0,
            // stock_qty will default to 0 if your trigger sets it; else leave out
            // item_no/sku are set by BEFORE INSERT trigger
          },
        ])
        .select('id, sku')
        .single();

      if (error) throw error;

      // Use the trigger-generated SKU (e.g., "VH-009")
      setDraftId(data!.id);
      setForm({
        sku: data!.sku,
        name: '',
        description: '',
        low_stock_threshold: 0,
        uom_id: '',
      });

      // Focus Name for quick typing
      requestAnimationFrame(() => {
        nameRef.current?.focus();
        nameRef.current?.select?.();
      });

      // Refresh table so you can see the draft row as well
      await load();
    } catch (err: any) {
      alert(err?.message || 'Failed to create draft item.');
    } finally {
      setIsGenerating(false);
    }
  };

  /** Save updates the draft row (id = draftId) with real values */
  const onSave = async () => {
    if (!draftId) {
      alert('Please click "Add Item" first to generate the item number.');
      return;
    }
    if (!form.name.trim()) {
      alert('Name is required.');
      return;
    }

    setIsSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description?.trim() || null,
        low_stock_threshold: Number.isFinite(form.low_stock_threshold)
          ? Number(form.low_stock_threshold)
          : 0,
        uom_id: form.uom_id || null,
      };

      const { error } = await supabase.from('items').update(payload).eq('id', draftId);
      if (error) throw error;

      setDraftId(null);
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

  /** Cancel removes the draft; your AFTER DELETE trigger returns the number to the free pool */
  const onCancel = async () => {
    if (!draftId) return;
    const ok = confirm('Cancel this new item and release its number?');
    if (!ok) return;

    const { error } = await supabase.from('items').delete().eq('id', draftId);
    if (error) {
      alert(error.message);
    } else {
      setDraftId(null);
      setForm({
        sku: '',
        name: '',
        description: '',
        low_stock_threshold: 0,
        uom_id: '',
      });
      await load();
    }
  };

  /** Delete any existing row */
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

        {/* RIGHT: New item panel */}
        <div className="card">
          <h2 className="font-semibold mb-2">New Item</h2>

          <div className="space-y-3">
            {/* Buttons row */}
            <div className="flex items-center gap-2">
              <Button onClick={onAddItem} disabled={isGenerating || isSaving}>
                {isGenerating ? 'Generating…' : draftId ? 'Item Number Created' : 'Add Item'}
              </Button>
              <Button onClick={onSave} disabled={isSaving || !draftId}>
                {isSaving ? 'Saving…' : 'Save'}
              </Button>
              <Button
                onClick={onCancel}
                disabled={!draftId || isSaving}
                className="bg-gray-200 hover:bg-gray-300 text-gray-900 px-3 py-2 rounded"
              >
                Cancel
              </Button>
            </div>

            {/* Read-only SKU (auto from trigger) */}
            <input
              className="input"
              placeholder="Item Number (auto)"
              value={form.sku}
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
