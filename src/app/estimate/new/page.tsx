'use client';

import { useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

const rupeeCeil = (n: number) => Math.ceil((n ?? 0) + Number.EPSILON);
const INR0 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const withGst = (base: number, gstPct: number) =>
  rupeeCeil((base ?? 0) * (1 + (gstPct ?? 0) / 100));
const withGstAndMargin = (base: number, gstPct: number, marginPct: number) =>
  rupeeCeil(withGst(base ?? 0, gstPct ?? 0) * (1 + (marginPct ?? 0) / 100));

type Line = { sku: string; name: string; qty: number; price: number };

export default function NewEstimatePage() {
  const [skuInput, setSkuInput] = useState('');
  const [customer, setCustomer] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([]);

  const addSku = async () => {
    const sku = skuInput.trim();
    if (!sku) return;

    const { data, error } = await supabase
      .from('items')
      .select('sku, name, purchase_price, gst_percent, margin_percent, unit_cost')
      .eq('sku', sku)
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      alert('SKU not found');
      return;
    }

    const base = Number(data.purchase_price ?? data.unit_cost ?? 0);
    const price = withGstAndMargin(base, Number(data.gst_percent ?? 0), Number(data.margin_percent ?? 0)); // integer ₹

    setLines(prev => {
      const idx = prev.findIndex(l => l.sku === data.sku);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], qty: copy[idx].qty + 1 };
        return copy;
      }
      return [...prev, { sku: data.sku, name: data.name, qty: 1, price }];
    });

    setSkuInput('');
  };

  const totals = useMemo(() => {
    const sub = lines.reduce((s, l) => s + l.qty * l.price, 0);
    return { sub, grand: sub }; // already GST+margin included and rounded
  }, [lines]);

  const printNow = () => window.print();
  const remove = (sku: string) => setLines(lines.filter(l => l.sku !== sku));

  return (
    <div className="p-6 print:p-0">
      <div className="no-print flex items-center justify-between">
        <h1 className="text-xl font-semibold">Estimate / Quotation</h1>
        <div className="flex gap-2">
          <button onClick={printNow} className="rounded bg-sky-600 px-3 py-2 text-white hover:bg-sky-700">Print</button>
          <a className="rounded border px-3 py-2 hover:bg-neutral-50" href="/inventory">Back to Inventory</a>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 no-print">
        <div>
          <label className="text-sm text-neutral-600">Customer (optional)</label>
          <input className="mt-1 w-full rounded border px-3 py-2" value={customer} onChange={e => setCustomer(e.target.value)} placeholder="Walk-in / Company name" />
        </div>
        <div>
          <label className="text-sm text-neutral-600">Notes (optional)</label>
          <input className="mt-1 w-full rounded border px-3 py-2" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Payment terms, validity, etc." />
        </div>
      </div>

      <div className="no-print mt-6 flex items-center gap-2">
        <input
          value={skuInput}
          onChange={e => setSkuInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') addSku(); }}
          placeholder="Enter SKU and press Enter"
          className="w-full max-w-sm rounded border px-3 py-2"
        />
        <button onClick={addSku} className="rounded border px-3 py-2 hover:bg-neutral-50">Add</button>
      </div>

      {/* Printable area */}
      <div className="mt-6 border rounded">
        <div className="p-4">
          <div className="flex items-baseline justify-between">
            <div>
              <h2 className="text-lg font-semibold">Vinayak Hardware</h2>
              <p className="text-xs text-neutral-600">Estimate / Quotation</p>
              {customer && <p className="text-sm mt-1"><b>To:</b> {customer}</p>}
            </div>
            <div className="text-right text-sm">
              <div>Date: {new Date().toLocaleDateString('en-IN')}</div>
              <div>Estimate #: {Date.now().toString().slice(-6)}</div>
            </div>
          </div>

          <table className="w-full text-sm mt-4 border">
            <thead className="bg-neutral-50">
              <tr>
                <th className="border px-2 py-1 text-left">SKU</th>
                <th className="border px-2 py-1 text-left">Item</th>
                <th className="border px-2 py-1 text-right">Qty</th>
                <th className="border px-2 py-1 text-right">Price</th>
                <th className="border px-2 py-1 text-right">Amount</th>
                <th className="border px-2 py-1 no-print"></th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr><td colSpan={6} className="p-6 text-center text-neutral-500">Add SKUs to build the quote</td></tr>
              ) : lines.map((l, i) => {
                const amount = l.qty * l.price; // already integer ₹
                return (
                  <tr key={l.sku} className="odd:bg-white even:bg-neutral-50/50">
                    <td className="border px-2 py-1">{l.sku}</td>
                    <td className="border px-2 py-1">{l.name}</td>
                    <td className="border px-2 py-1 text-right">
                      <input
                        className="w-16 rounded border px-1 py-0.5 text-right"
                        type="number" min={1} value={l.qty}
                        onChange={(e) => {
                          const n = Math.max(1, Number(e.target.value || 1));
                          setLines(prev => prev.map((x, idx) => idx === i ? { ...x, qty: n } : x));
                        }}
                      />
                    </td>
                    <td className="border px-2 py-1 text-right">
                      {INR0.format(l.price)}
                    </td>
                    <td className="border px-2 py-1 text-right">
                      {INR0.format(amount)}
                    </td>
                    <td className="border px-2 py-1 text-center no-print">
                      <button className="rounded border px-2 py-0.5 text-xs hover:bg-red-50" onClick={() => remove(l.sku)}>Remove</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="flex justify-end mt-4">
            <div className="w-full sm:w-80 border rounded p-3">
              <div className="flex justify-between">
                <span>Subtotal</span>
                <span>{INR0.format(totals.sub)}</span>
              </div>
              <div className="flex justify-between font-semibold mt-2 border-t pt-2">
                <span>Grand Total</span>
                <span>{INR0.format(totals.grand)}</span>
              </div>
              {notes && <div className="text-xs text-neutral-600 mt-2"><b>Notes:</b> {notes}</div>}
            </div>
          </div>

          <div className="text-center text-xs text-neutral-500 mt-8">
            * Prices include GST and margin, rounded up to the next whole rupee.
          </div>
        </div>
      </div>

      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white; }
          @page { margin: 10mm; }
        }
      `}</style>
    </div>
  );
}
