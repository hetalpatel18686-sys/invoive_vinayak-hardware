
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

/**
 * We store UoM as a simple string code (uom_code) after normalizing the join.
 * This avoids the array/object shape mismatch from Supabase.
 */
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

  uom_id?: string | null;    // FK on items
  uom_code?: string;         // normalized from relation ('' if missing)
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

  // --- Scanner/UX helpers ---
  const [scanMode, setScanMode] = useState<boolean>(true); // return focus to SKU after add
  const skuRef = useRef<HTMLInputElement | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const priceRef = useRef<HTMLInputElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);

  const load = async () => {
    setLoading(true);

    // 1) Load items + join UoM, then normalize to { uom_code: string }
    const { data: itemsData, error: itemsError } = await supabase
      .from('items')
      .select(`
        id, sku, name, description, unit_cost, unit_price, tax_rate, stock_qty, low_stock_threshold, uom_id,
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
        unit_cost: Number(d.unit_cost ?? 0),
        unit_price: Number(d.unit_price ?? 0),
        tax_rate: Number(d.tax_rate ?? 0),
        stock_qty: Number(d.stock_qty ?? 0),
        low_stock_threshold: d.low_stock_threshold ?? null,
        uom_id: d.uom_id ?? null,
        // if Supabase returns uom as array, take first element's code
        uom_code: Array.isArray(d.uom) ? (d.uom[0]?.code ?? '') : (d.uom?.code ?? ''),
      }));
      setItems(normalized);
    }

    // 2) Load UoMs for the Add form dropdown
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

  // Initial load and focus to SKU for scanner
  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    // Auto-focus SKU on mount
    tryFocusSku(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  const tryFocusSku = (selectAll = false) => {
    requestAnimationFrame(() => {
      const el = skuRef.current;
      if (el) {
        el.focus();
        if (selectAll) {
          try { el.select(); } catch {}
        }
      }
    });
  };

  const validateRequireds = () => {
    const nameOk = !!form.name.trim();
    const priceOk = Number(form.unit_price) > 0;
    return { nameOk, priceOk, allOk: nameOk && priceOk };
  };

  // Submit helper (submit programmatically)
  const submitForm = () => {
    if (!formRef.current) return;
    // requestSubmit works better than formRef.current.submit() in React
    (formRef.current as any).requestSubmit?.();
  };

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
      uom_id: form.uom_id || null, // save selection
    };

    const { error } = await supabase.from('items').insert([payload]);
    if (error) {
      alert(error.message);
    } else {
      // Reset form
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
      // Reload table
      load();

      // Return to SKU for continuous scanning
      if (scanMode) tryFocusSku(true);
    }
  };

  // -------- Key handlers to support scanner "Enter" workflow --------
  const onSkuKeyDown: React.KeyboardEventHandler<HTMLInputElement> = (e) => {
    if (e.key !== 'Enter') return;

    e.preventDefault();
    const { nameOk, priceOk, allOk } = validateRequireds();

    // If all required fields are ready, submit immediately (scanner auto-enter)
    if (allOk) {
      submitForm();
      return;
    }

    // If Name missing, go to Name first; else if Price missing, go to Price
    if (!nameOk) {
      nameRef.current?.focus();
      nameRef.current?.select?.();
      return;
    }
    if (!priceOk) {
      priceRef.current?.focus();
      priceRef.current?.select?.();
      return;
    }
  };

  const onNameKeyDown: React.KeyboardEventHandler<HTMLInputElement> = (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    // Move to Price
    priceRef.current?.focus();
    priceRef.current?.select?.();
  };

  const onPriceKeyDown: React.KeyboardEventHandler<HTMLInputElement> = (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    // With Price done, submit (works nicely with scanners too)
    submitForm();
  };

  return (
    <Protected>
      <div className="grid md:grid-cols-3 gap-4">
        {/* LEFT: Items table */}
        <div className="card md:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-xl font-semibold">
              Items &amp; Pricing <span className="text-xs text-gray-500">(UoM v2)</span>
            </h1>

            {/* Scan mode toggle */}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={scanMode}
                onChange={(e) => setScanMode(e.target.checked)}
              />
              <span>Scan Mode (auto focus SKU)</span>
            </label>
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
                    <th>Price</th>
                    <th>Cost</th>
                    <th>Margin</th>
                    <th>Stock</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => {
                    const price = Number(it.unit_price || 0);
                    const cost = Number(it.unit_cost || 0);
                    const margin = price - cost;
                    const pct = price > 0 ? (margin / price) * 100 : 0;
                    const low =
                      it.low_stock_threshold != null &&
                      it.low_stock_threshold > 0 &&
                      (it.stock_qty || 0) <= it.low_stock_threshold;

                    return (
                      <tr key={it.id} className={low ? 'bg-orange-50' : ''}>
                        <td>{it.sku}</td>
                        <td>{it.name}</td>
                        <td>{it.uom_code || '-'}</td>
                        <td>₹ {price.toFixed(2)}</td>
                        <td>₹ {cost.toFixed(2)}</td>
                        <td>
                          {margin.toFixed(2)} ({pct.toFixed(1)}%)
                        </td>
                        <td>{it.stock_qty ?? 0}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* RIGHT: Add item form */}
        <div className="card">
          <h2 className="font-semibold mb-2">Add New Item</h2>

          <form ref={formRef} onSubmit={add} className="space-y-3">
            <input
              ref={skuRef}
              className="input"
              placeholder="SKU (scan barcode here)"
              value={form.sku}
              onChange={(e) => setForm({ ...form, sku: e.target.value })}
              onKeyDown={onSkuKeyDown}
              required
            />
            <input
              ref={nameRef}
              className="input"
              placeholder="Name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              onKeyDown={onNameKeyDown}
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
                ref={priceRef}
                className="input"
                type="number"
                step="0.01"
                placeholder="Price"
                value={form.unit_price}
                onChange={(e) =>
                  setForm({ ...form, unit_price: parseFloat(e.target.value || '0') })
                }
                onKeyDown={onPriceKeyDown}
                required
                min={0}
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
