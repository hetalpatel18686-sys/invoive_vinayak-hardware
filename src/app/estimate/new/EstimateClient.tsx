'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

/* ---------- helpers: prices always in whole rupees ---------- */
const rupeeCeil = (n: number) => Math.ceil((n ?? 0) + Number.EPSILON);
const INR0 = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});
const withGst = (base: number, gstPct: number) =>
  rupeeCeil((base ?? 0) * (1 + (gstPct ?? 0) / 100));
const withGstAndMargin = (base: number, gstPct: number, marginPct: number) =>
  rupeeCeil(withGst(base ?? 0, gstPct ?? 0) * (1 + (marginPct ?? 0) / 100));

type Line = { sku: string; name: string; qty: number; price: number };

type ItemRow = {
  sku: string;
  name: string;
  purchase_price: number | null;
  gst_percent: number | null;
  margin_percent: number | null;
  unit_cost: number | null;
  barcode?: string | null; // optional
};

/* Build a WhatsApp message with all lines */
function buildWhatsappMessage(customer: string, lines: Line[], grand: number) {
  const title = `*Estimate / Quotation*${customer ? `\nTo: ${customer}` : ''}`;
  const list = lines
    .map(
      (l, i) =>
        `${i + 1}. ${l.sku} — ${l.name}\n   Qty: ${l.qty} × ₹${l.price} = ₹${l.qty * l.price}`
    )
    .join('\n');
  const total = `\n*Grand Total:* ₹${grand}`;
  const footer = `\n\nPrices include GST & margin, rounded to next rupee.`;
  return `${title}\n\n${list}\n${total}${footer}`;
}

/* Safe phone normalizer for wa.me (expects country code, no +, no spaces) */
function normalizePhoneForWa(raw: string) {
  return raw.replace(/\D+/g, '');
}

/* ---------- Supabase helpers that TRY barcode and fall back ---------- */
async function selectWithOptionalBarcode(like: string, limitOne = false) {
  // Try with barcode column first
  let q1 = supabase
    .from('items')
    .select('sku, name, purchase_price, gst_percent, margin_percent, unit_cost, barcode')
    .or(`sku.ilike.${like},name.ilike.${like},barcode.ilike.${like}`)
    .order('sku', { ascending: true });
  if (limitOne) q1 = q1.limit(1);

  let r1 = await q1;
  if (!r1.error) return r1;

  // Fallback without barcode (if column doesn't exist)
  let q2 = supabase
    .from('items')
    .select('sku, name, purchase_price, gst_percent, margin_percent, unit_cost')
    .or(`sku.ilike.${like},name.ilike.${like}`)
    .order('sku', { ascending: true });
  if (limitOne) q2 = q2.limit(1);

  return await q2;
}

async function selectExactWithOptionalBarcode(equal: string) {
  // Try exact SKU or exact barcode
  let r1 = await supabase
    .from('items')
    .select('sku, name, purchase_price, gst_percent, margin_percent, unit_cost, barcode')
    .or(`sku.ilike.${equal},barcode.eq.${equal}`)
    .limit(1);

  if (!r1.error) return r1;

  // Fallback: only exact SKU (case-insensitive)
  return await supabase
    .from('items')
    .select('sku, name, purchase_price, gst_percent, margin_percent, unit_cost')
    .or(`sku.ilike.${equal}`)
    .limit(1);
}

export default function EstimateClient() {
  const params = useSearchParams();

  const [skuInput, setSkuInput] = useState('');
  const [customer, setCustomer] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([]);

  /** live suggestions */
  const [suggest, setSuggest] = useState<ItemRow[]>([]);
  const [loadingSuggest, setLoadingSuggest] = useState(false);

  /** WhatsApp phone number (with country code, e.g., 91XXXXXXXXXX) */
  const [waPhone, setWaPhone] = useState('');

  /* ---------- add one item by sku | name | barcode (case-insensitive) ---------- */
  async function fetchBestItem(query: string): Promise<ItemRow | null> {
    const q = query.trim();
    if (!q) return null;

    // 1) Try exact SKU or exact barcode (case-insensitive for SKU, exact for barcode)
    {
      const { data, error } = await selectExactWithOptionalBarcode(q);
      if (!error && data && data.length > 0) return data[0] as ItemRow;
    }

    // 2) Partial match by SKU or NAME (and barcode if available)
    {
      const like = `%${q}%`;
      const { data, error } = await selectWithOptionalBarcode(like, true);
      if (!error && data && data.length > 0) return data[0] as ItemRow;
    }

    return null;
  }

  async function addSkuOnce(query: string, qty = 1) {
    const item = await fetchBestItem(query);
    if (!item) {
      alert(`Item not found for "${query}"`);
      return;
    }
    const base = Number(item.purchase_price ?? item.unit_cost ?? 0);
    const price = withGstAndMargin(
      base,
      Number(item.gst_percent ?? 0),
      Number(item.margin_percent ?? 0)
    ); // integer ₹

    setLines((prev) => {
      const idx = prev.findIndex((l) => l.sku === item.sku);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: next[idx].qty + qty };
        return next;
      }
      return [...prev, { sku: item.sku, name: item.name, qty, price }];
    });
  }

  /* ---------- read ?sku= and ?qty= on first load ---------- */
  useEffect(() => {
    const skuParam = params.get('sku'); // supports "SKU-001" or "SKU-001,SKU-007"
    const qtyParam = params.get('qty');
    const qty = Math.max(1, Number(qtyParam ?? 1) || 1);

    if (skuParam) {
      const skus = skuParam.split(',').map((s) => s.trim()).filter(Boolean);
      (async () => {
        for (const s of skus) await addSkuOnce(s, qty);
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // only once

  /* ---------- suggestions: runs when user types ---------- */
  useEffect(() => {
    let active = true;
    (async () => {
      const q = skuInput.trim();
      if (!q) {
        if (active) setSuggest([]);
        return;
      }
      setLoadingSuggest(true);
      const like = `%${q}%`;

      const { data, error } = await selectWithOptionalBarcode(like, false);

      setLoadingSuggest(false);
      if (!active) return;
      if (error || !data) {
        setSuggest([]);
      } else {
        setSuggest((data as ItemRow[]).slice(0, 8));
      }
    })();

    return () => {
      active = false;
    };
  }, [skuInput]);

  const addSkuFromInput = async () => {
    if (!skuInput.trim()) return;
    // also allow comma-separated input for multiple items
    const parts = skuInput.split(',').map((s) => s.trim()).filter(Boolean);
    for (const p of parts) await addSkuOnce(p, 1);
    setSkuInput('');
    setSuggest([]);
  };

  const totals = useMemo(() => {
    const sub = lines.reduce((s, l) => s + l.qty * l.price, 0);
    return { sub, grand: sub }; // already GST+margin included and rounded
  }, [lines]);

  const printNow = () => window.print();
  const remove = (sku: string) =>
    setLines((prev) => prev.filter((l) => l.sku !== sku));

  const sendWhatsapp = () => {
    const phone = normalizePhoneForWa(waPhone);
    if (!phone) {
      alert('Enter WhatsApp number with country code (e.g., 91XXXXXXXXXX)');
      return;
    }
    if (lines.length === 0) {
      alert('Add at least one item before sending.');
      return;
    }
    const text = buildWhatsappMessage(customer, lines, totals.grand);
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="p-6 print:p-0">
      {/* Toolbar */}
      <div className="no-print flex items-center justify-between">
        <h1 className="text-xl font-semibold">Estimate / Quotation</h1>
        <div className="flex flex-wrap gap-2">
          <input
            className="input w-48"
            placeholder="WhatsApp (e.g., 91XXXXXXXXXX)"
            value={waPhone}
            onChange={(e) => setWaPhone(e.target.value)}
          />
          <button
            onClick={sendWhatsapp}
            className="rounded bg-green-600 px-3 py-2 text-white hover:bg-green-700"
            title="Send to WhatsApp"
          >
            Send WhatsApp
          </button>
          <button
            onClick={printNow}
            className="rounded bg-sky-600 px-3 py-2 text-white hover:bg-sky-700"
          >
            Print
          </button>
          <Link href="/inventory" className="rounded border px-3 py-2 hover:bg-neutral-50">
            Back to Inventory
          </Link>
        </div>
      </div>

      {/* Customer + Notes */}
      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 no-print">
        <div>
          <label className="text-sm text-neutral-600">Customer (optional)</label>
          <input
            className="mt-1 w-full rounded border px-3 py-2"
            value={customer}
            onChange={(e) => setCustomer(e.target.value)}
            placeholder="Walk-in / Company name"
          />
        </div>
        <div>
          <label className="text-sm text-neutral-600">Notes (optional)</label>
          <input
            className="mt-1 w-full rounded border px-3 py-2"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Payment terms, validity, etc."
          />
        </div>
      </div>

      {/* Search box with suggestions (SKU / Name / (optional) Barcode) */}
      <div className="no-print mt-6">
        <div className="flex items-center gap-2">
          <input
            value={skuInput}
            onChange={(e) => setSkuInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addSkuFromInput();
            }}
            placeholder="Search by SKU, Name, or Barcode…"
            className="w-full max-w-lg rounded border px-3 py-2"
          />
          <button
            onClick={addSkuFromInput}
            className="rounded border px-3 py-2 hover:bg-neutral-50"
          >
            Add
          </button>
        </div>

        {/* suggestions dropdown */}
        {skuInput && suggest.length > 0 && (
          <div className="mt-2 w-full max-w-lg rounded border bg-white shadow-sm">
            {suggest.map((it) => (
              <button
                key={it.sku}
                type="button"
                onClick={() => {
                  addSkuOnce(it.sku, 1);
                  setSkuInput('');
                  setSuggest([]);
                }}
                className="block w-full text-left px-3 py-2 hover:bg-neutral-50"
              >
                <div className="font-medium">{it.sku}</div>
                <div className="text-xs text-neutral-600">{it.name}</div>
              </button>
            ))}
            {loadingSuggest && (
              <div className="px-3 py-2 text-xs text-neutral-500">Searching…</div>
            )}
          </div>
        )}
      </div>

      {/* Printable area */}
      <div className="mt-6 border rounded">
        <div className="p-4">
          <div className="flex items-baseline justify-between">
            <div>
              <h2 className="text-lg font-semibold">Vinayak Hardware</h2>
              <p className="text-xs text-neutral-600">Estimate / Quotation</p>
              {customer && (
                <p className="text-sm mt-1">
                  <b>To:</b> {customer}
                </p>
              )}
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
                <tr>
                  <td colSpan={6} className="p-6 text-center text-neutral-500">
                    Use the search above or click <em>Estimate</em> from Inventory
                  </td>
                </tr>
              ) : (
                lines.map((l, i) => {
                  const amount = l.qty * l.price; // already whole ₹
                  return (
                    <tr key={l.sku} className="odd:bg-white even:bg-neutral-50/50">
                      <td className="border px-2 py-1">{l.sku}</td>
                      <td className="border px-2 py-1">{l.name}</td>
                      <td className="border px-2 py-1 text-right">
                        <input
                          className="w-16 rounded border px-1 py-0.5 text-right"
                          type="number"
                          min={1}
                          value={l.qty}
                          onChange={(e) => {
                            const n = Math.max(1, Number(e.target.value || 1));
                            setLines((prev) =>
                              prev.map((x, idx) => (idx === i ? { ...x, qty: n } : x))
                            );
                          }}
                        />
                      </td>
                      <td className="border px-2 py-1 text-right">{INR0.format(l.price)}</td>
                      <td className="border px-2 py-1 text-right">{INR0.format(amount)}</td>
                      <td className="border px-2 py-1 text-center no-print">
                        <button
                          className="rounded border px-2 py-0.5 text-xs hover:bg-red-50"
                          onClick={() => remove(l.sku)}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
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
              {notes && (
                <div className="text-xs text-neutral-600 mt-2">
                  <b>Notes:</b> {notes}
                </div>
              )}
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
