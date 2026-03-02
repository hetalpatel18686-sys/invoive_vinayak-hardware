'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

/**
 * Replace or extend the types below with your actual data models as needed.
 */
type LineItem = {
  id: string;
  name: string;
  qty: number;
  price: number;
};

type Customer = {
  id: string;
  name: string;
  email?: string;
};

type Estimate = {
  id?: string;
  number?: string;
  date?: string;
  customer?: Customer | null;
  items: LineItem[];
  notes?: string;
  terms?: string;
  currency?: string; // e.g., 'USD'
};

export default function EstimateClient() {
  /**
   * ====== State (adapt or replace with your real state management) ======
   */
  const [estimate, setEstimate] = useState<Estimate>({
    items: [],
    currency: 'USD',
  });
  const [isSaving, setIsSaving] = useState(false);

  /**
   * ====== Effects (example only; keep/remove according to your app) ======
   * If you seed from localStorage, keep it here. Your log showed `estimate-seed`.
   */
  useEffect(() => {
    try {
      const seed = localStorage.getItem('estimate-seed');
      if (seed) {
        const parsed = JSON.parse(seed);
        setEstimate((prev) => ({ ...prev, ...parsed }));
      }
    } catch {
      // ignore
    }
  }, []);

  /**
   * ====== Derived values ======
   */
  const subtotal = useMemo(() => {
    return estimate.items.reduce((sum, it) => sum + it.qty * it.price, 0);
  }, [estimate.items]);

  const taxRate = 0.0; // plug in your logic or configuration
  const tax = useMemo(() => subtotal * taxRate, [subtotal, taxRate]);
  const total = useMemo(() => subtotal + tax, [subtotal, tax]);

  /**
   * ====== Handlers ======
   */
  const addItem = () => {
    setEstimate((prev) => ({
      ...prev,
      items: [
        ...prev.items,
        {
          id: crypto.randomUUID(),
          name: '',
          qty: 1,
          price: 0,
        },
      ],
    }));
  };

  const updateItem = (id: string, patch: Partial<LineItem>) => {
    setEstimate((prev) => ({
      ...prev,
      items: prev.items.map((it) => (it.id === id ? { ...it, ...patch } : it)),
    }));
  };

  const removeItem = (id: string) => {
    setEstimate((prev) => ({
      ...prev,
      items: prev.items.filter((it) => it.id !== id),
    }));
  };

  const saveDraft = async () => {
    setIsSaving(true);
    try {
      // TODO: hook up to your API/Supabase call
      // await saveEstimate(estimate);
      await new Promise((r) => setTimeout(r, 600));
      alert('Estimate saved (demo)');
    } catch (e) {
      console.error(e);
      alert('Failed to save estimate');
    } finally {
      setIsSaving(false);
    }
  };

  const clearSeed = () => {
    try {
      localStorage.removeItem('estimate-seed');
      alert('Seed cleared');
    } catch {
      // ignore
    }
  };

  /**
   * ====== Render ======
   */
  return (
    <div className="flex flex-col gap-6">
      {/* Header / actions */}
      <div className="flex items-center gap-2">
        <div className="text-lg font-semibold mr-auto">Estimate</div>

        {/* ✅ Corrected Link (was malformed in your logs) */}
        <Link
          href="/inventory"
          className="text-sm text-blue-600 hover:underline"
          prefetch={false}
        >
          Back to Inventory
        </Link>

        {/* Refresh Button */}
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded bg-gray-200 px-3 py-1.5 text-sm hover:bg-gray-300"
          aria-label="Refresh page"
        >
          Refresh
        </button>

        {/* Clear Seed Button */}
        <button
          type="button"
          className="rounded bg-gray-700 px-3 py-1.5 text-sm text-white hover:bg-gray-800"
          onClick={clearSeed}
        >
          Clear Seed
        </button>
      </div>

      {/* Estimate meta */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium">Estimate No.</label>
          <input
            className="rounded border px-3 py-2"
            placeholder="e.g. EST-1005"
            value={estimate.number ?? ''}
            onChange={(e) =>
              setEstimate((prev) => ({ ...prev, number: e.target.value }))
            }
          />
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium">Date</label>
          <input
            type="date"
            className="rounded border px-3 py-2"
            value={estimate.date ?? ''}
            onChange={(e) =>
              setEstimate((prev) => ({ ...prev, date: e.target.value }))
            }
          />
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium">Customer</label>
          <input
            className="rounded border px-3 py-2"
            placeholder="Customer name"
            value={estimate.customer?.name ?? ''}
            onChange={(e) =>
              setEstimate((prev) => ({
                ...prev,
                customer: { ...(prev.customer ?? { id: '' }), name: e.target.value },
              }))
            }
          />
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium">Currency</label>
          <input
            className="rounded border px-3 py-2"
            placeholder="USD"
            value={estimate.currency ?? ''}
            onChange={(e) =>
              setEstimate((prev) => ({ ...prev, currency: e.target.value }))
            }
          />
        </div>
      </section>

      {/* Line items */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center">
          <div className="text-base font-semibold mr-auto">Line Items</div>
          <button
            type="button"
            className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
            onClick={addItem}
          >
            Add Item
          </button>
        </div>

        <div className="flex flex-col gap-3">
          {estimate.items.length === 0 && (
            <div className="text-sm text-gray-500">No items yet</div>
          )}

          {estimate.items.map((it) => (
            <div
              key={it.id}
              className="grid grid-cols-12 items-center gap-2 rounded border p-3"
            >
              <input
                className="col-span-5 rounded border px-2 py-1.5"
                placeholder="Item name"
                value={it.name}
                onChange={(e) => updateItem(it.id, { name: e.target.value })}
              />
              <input
                type="number"
                className="col-span-2 rounded border px-2 py-1.5"
                placeholder="Qty"
                min={0}
                value={it.qty}
                onChange={(e) =>
                  updateItem(it.id, { qty: Number(e.target.value || 0) })
                }
              />
              <input
                type="number"
                className="col-span-3 rounded border px-2 py-1.5"
                placeholder="Price"
                min={0}
                step="0.01"
                value={it.price}
                onChange={(e) =>
                  updateItem(it.id, { price: Number(e.target.value || 0) })
                }
              />
              <div className="col-span-1 text-right font-medium">
                {(it.qty * it.price).toFixed(2)}
              </div>
              <div className="col-span-1 text-right">
                <button
                  className="rounded bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-700"
                  onClick={() => removeItem(it.id)}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Notes / Terms */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium">Notes</label>
          <textarea
            className="min-h-28 rounded border px-3 py-2"
            placeholder="Optional notes for the customer"
            value={estimate.notes ?? ''}
            onChange={(e) =>
              setEstimate((prev) => ({ ...prev, notes: e.target.value }))
            }
          />
        </div>
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium">Terms</label>
          <textarea
            className="min-h-28 rounded border px-3 py-2"
            placeholder="Payment terms, validity, etc."
            value={estimate.terms ?? ''}
            onChange={(e) =>
              setEstimate((prev) => ({ ...prev, terms: e.target.value }))
            }
          />
        </div>
      </section>

      {/* Summary & actions */}
      <section className="flex flex-col gap-4 rounded border p-4">
        <div className="ml-auto w-full max-w-sm">
          <div className="flex justify-between py-1 text-sm">
            <span>Subtotal</span>
            <span>{subtotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between py-1 text-sm">
            <span>Tax ({(taxRate * 100).toFixed(0)}%)</span>
            <span>{tax.toFixed(2)}</span>
          </div>
          <div className="mt-2 flex justify-between border-t pt-2 text-base font-semibold">
            <span>Total</span>
            <span>{total.toFixed(2)}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={isSaving}
            onClick={saveDraft}
            className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {isSaving ? 'Saving…' : 'Save Draft'}
          </button>
          <button
            type="button"
            onClick={() => alert('Submit/Send not implemented')}
            className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            Submit / Send
          </button>
        </div>
      </section>
    </div>
  );
}
``
