'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import Button from '@/components/Button';

/* =========================
   Helpers (whole-rupee math)
   ========================= */
const rupeeCeil = (n: number) => Math.ceil((n ?? 0) + Number.EPSILON);
const INR0 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

const withGst = (base: number, gstPct: number) =>
  rupeeCeil((base ?? 0) * (1 + (gstPct ?? 0) / 100));

const withGstAndMargin = (base: number, gstPct: number, marginPct: number) =>
  rupeeCeil(withGst(base ?? 0, gstPct ?? 0) * (1 + (marginPct ?? 0) / 100));

/* =========================
   Types
   ========================= */
interface EstimateLine {
  sku: string;
  qty: number;
}

interface ItemRow {
  id?: string;
  sku: string;
  name: string;
  uom_code: string;
  // Pricing ingredients
  purchase_price: number | null;
  gst_percent: number | null;
  margin_percent: number | null;
  unit_cost: number | null; // fallback avg cost
  selling_price_per_unit?: number | null;

  // Final computed for the estimate UI
  selling_price: number; // whole rupees
}

/* =========================
   Parse incoming lines
   ========================= */
function parseLinesParam(linesParam: string | null): EstimateLine[] {
  if (!linesParam) return [];
  // lines=SKU1:QTY1,SKU2:QTY2
  return linesParam
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(pair => {
      const [skuRaw, qtyRaw] = pair.split(':');
      const sku = (skuRaw || '').trim();
      const qty = Math.max(1, Math.min(500, Math.floor(parseInt((qtyRaw || '1').trim(), 10) || 1)));
      return sku ? { sku, qty } : null;
    })
    .filter(Boolean) as EstimateLine[];
}

async function loadItemsForSkus(skus: string[]): Promise<ItemRow[]> {
  if (skus.length === 0) return [];

  // 1) items
  const { data: items, error: itemsErr } = await supabase
    .from('items')
    .select('id, sku, name, unit_cost, uom_id, purchase_price, gst_percent, margin_percent, selling_price_per_unit')
    .in('sku', skus);

  if (itemsErr) {
    console.error('[Estimate] items load error:', itemsErr);
    return skus.map(sku => ({
      sku,
      name: '(Unknown item)',
      uom_code: '',
      purchase_price: null,
      gst_percent: null,
      margin_percent: null,
      unit_cost: null,
      selling_price_per_unit: null,
      selling_price: 0,
    }));
  }

  // 2) UOMs
  const uomIds = Array.from(new Set((items ?? []).map(it => it.uom_id).filter(Boolean)));
  let uomMap = new Map<any, string>();
  if (uomIds.length > 0) {
    const { data: uoms, error: uomsErr } = await supabase
      .from('units_of_measure')
      .select('id, code')
      .in('id', uomIds);
    if (uomsErr) {
      console.warn('[Estimate] uom load error:', uomsErr.message);
    } else {
      (uoms ?? []).forEach((u: any) => uomMap.set(u.id, u.code));
    }
  }

  // 3) Normalize + compute selling price (prefer DB)
  const rows: ItemRow[] = (items ?? []).map((it: any) => {
    const base = Number(it.purchase_price ?? it.unit_cost ?? 0);
    const gst = Number(it.gst_percent ?? 0);
    const margin = Number(it.margin_percent ?? 0);

    const sellingDb = it.selling_price_per_unit;
    const selling = Number.isFinite(Number(sellingDb)) && Number(sellingDb) > 0
      ? rupeeCeil(Number(sellingDb))
      : withGstAndMargin(base, gst, margin);

    return {
      id: it.id,
      sku: it.sku,
      name: it.name || it.sku,
      uom_code: it.uom_id ? (uomMap.get(it.uom_id) ?? '') : '',
      purchase_price: it.purchase_price ?? null,
      gst_percent: it.gst_percent ?? null,
      margin_percent: it.margin_percent ?? null,
      unit_cost: it.unit_cost ?? null,
      selling_price_per_unit: it.selling_price_per_unit ?? null,
      selling_price: selling,
    };
  });

  // 4) Ensure all requested SKUs are represented (handles unknown SKUs gracefully)
  const bySku = new Map(rows.map(r => [r.sku, r]));
  const complete = skus.map(sku => {
    const found = bySku.get(sku);
    return found ?? {
      sku,
      name: '(Unknown item)',
      uom_code: '',
      purchase_price: null,
      gst_percent: null,
      margin_percent: null,
      unit_cost: null,
      selling_price_per_unit: null,
      selling_price: 0,
    };
  });

  return complete;
}

/* =========================
   Main page
   ========================= */
export default function NewEstimatePage() {
  const sp = useSearchParams();

  // ---- read inputs
  const seedFlag = sp?.get('seed') || null; // from Inventory large-selection path
  const linesParam = sp?.get('lines') || null; // small-selection path
  const singleSku = sp?.get('sku') || null;    // backward-compatible
  const singleQty = sp?.get('qty') || null;    // backward-compatible

  // ---- UI state
  const [loading, setLoading] = useState(true);
  const [rawLines, setRawLines] = useState<EstimateLine[]>([]);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [errorMsg, setErrorMsg] = useState<string>('');

  // Seed name (for debug button tooltips)
  const [seedUsed, setSeedUsed] = useState<'lines' | 'localStorage' | 'single' | 'none'>('none');

  // 1) Build the requested lines (in priority order)
  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setErrorMsg('');

        // Priority A: lines query (small/medium selections)
        let lines: EstimateLine[] = parseLinesParam(linesParam);

        // Priority B: long selections via seed=1
        if ((!lines || lines.length === 0) && seedFlag) {
          try {
            const seed = localStorage.getItem('estimate-seed');
            if (seed) {
              const arr = JSON.parse(seed) as EstimateLine[];
              if (Array.isArray(arr) && arr.length > 0) {
                lines = arr.map(x => ({
                  sku: String(x.sku || '').trim(),
                  qty: Math.max(1, Math.min(500, Math.floor(Number(x.qty) || 1))),
                })).filter(x => x.sku);
                setSeedUsed('localStorage');
              }
            }
          } catch (e) {
            console.warn('[Estimate] Failed to parse estimate-seed:', e);
          }
        }

        // Priority C: backward-compat single sku & qty
        if ((!lines || lines.length === 0) && (singleSku || singleQty)) {
          const sku = (singleSku || '').trim();
          const qty = Math.max(1, Math.min(500, Math.floor(parseInt(singleQty || '1', 10) || 1)));
          if (sku) {
            lines = [{ sku, qty }];
            setSeedUsed('single');
          }
        }

        // If nothing provided, remain blank state (friendly message)
        if (!lines || lines.length === 0) {
          setRawLines([]);
          setItems([]);
          setSeedUsed('none');
          setLoading(false);
          return;
        }

        setRawLines(lines);

        // 2) Load item records for those SKUs
        const skus = Array.from(new Set(lines.map(l => l.sku)));
        const rows = await loadItemsForSkus(skus);
        setItems(rows);
      } catch (e: any) {
        console.error('[Estimate] init failed:', e);
        setErrorMsg(e?.message || 'Failed to build estimate.');
      } finally {
        setLoading(false);
      }
    })();
    // NOTE: watch params only (not local state)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linesParam, seedFlag, singleSku, singleQty]);

  // Compose line+item view
  const view = useMemo(() => {
    const qtyBySku = new Map(rawLines.map(l => [l.sku, l.qty]));
    return items.map(it => {
      const qty = Math.max(1, Math.min(500, Math.floor(qtyBySku.get(it.sku) || 1)));
      const lineTotal = rupeeCeil(qty * Number(it.selling_price || 0));
      return { ...it, qty, lineTotal };
    });
  }, [items, rawLines]);

  const total = useMemo(() => {
    let s = 0;
    for (const v of view) s += v.lineTotal;
    return rupeeCeil(s);
  }, [view]);

  // UI handlers
  const setQty = (sku: string, qty: number) => {
    const q = Math.max(1, Math.min(500, Math.floor(qty || 1)));
    setRawLines(prev => {
      const idx = prev.findIndex(l => l.sku === sku);
      if (idx === -1) return prev;
      const next = [...prev];
      next[idx] = { ...next[idx], qty: q };
      return next;
    });
  };

  const removeLine = (sku: string) => {
    setRawLines(prev => prev.filter(l => l.sku !== sku));
    setItems(prev => prev.filter(i => i.sku !== sku));
  };

  const clearSeed = () => {
    try { localStorage.removeItem('estimate-seed'); } catch {}
    alert('Estimate seed cleared from this browser.');
  };

  const reimportSeed = () => {
    // force reload from seed
    window.location.href = '/estimate/new?seed=1';
  };

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="flex items-center gap-3 mb-3">
          <div className="text-lg font-semibold mr-auto">Estimate</div>

          {/* Quick actions */}
          <Link href="/inventory" className="rounded border px-3 py-2 hover:bg-neutral-50">Back to Inventory</Link>
          <Button type="button" onClick={() => window.location.reload()}>Refresh</Button>
          <Button type="button" className="bg-gray-700 hover:bg-gray-800" onClick={clearSeed} title="Remove large-selection seed stored in this browser">Clear Seed</Button>
          <Button type="button" onClick={reimportSeed} title="Reload items from saved seed">Re-import Seed</Button>
        </div>

        {/* State banners */}
        {seedUsed === 'localStorage' && (
          <div className="mb-3 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-3 py-2">
            Loaded from localStorage seed (large selection). You can clear the seed after use.
          </div>
        )}
        {seedUsed === 'lines' && (
          <div className="mb-3 text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded px-3 py-2">
            Loaded from query parameter (<code>lines</code>).
          </div>
        )}
        {seedUsed === 'single' && (
          <div className="mb-3 text-sm text-indigo-700 bg-indigo-50 border border-indigo-200 rounded px-3 py-2">
            Loaded single item (backward compatible).
          </div>
        )}

        {loading ? (
          <div className="py-12 text-center text-gray-600">Loading…</div>
        ) : errorMsg ? (
          <div className="py-12 text-center text-red-600">{errorMsg}</div>
        ) : view.length === 0 ? (
          <div className="py-12 text-center text-gray-700">
            No lines to estimate yet.<br />
            Use <b>Inventory → Estimate (Selected)</b> or open with <code>?lines=SKU:QTY,SKU2:QTY2</code>
          </div>
        ) : (
          <>
            {/* Table */}
            <div className="table-scroll" style={{ maxHeight: 720, overflow: 'auto' }}>
              <table className="table">
                <colgroup>
                  <col style={{ width: 120 }} />  {/* SKU */}
                  <col style={{ width: 260 }} />  {/* Item */}
                  <col style={{ width: 80  }} />  {/* UoM */}
                  <col style={{ width: 110 }} />  {/* Selling */}
                  <col style={{ width: 100 }} />  {/* Qty */}
                  <col style={{ width: 140 }} />  {/* Line Total */}
                  <col style={{ width: 120 }} />  {/* Actions */}
                </colgroup>
                <thead className="sticky-head">
                  <tr>
                    <th>SKU</th>
                    <th>Item</th>
                    <th>UoM</th>
                    <th className="num">Selling</th>
                    <th className="num">Qty</th>
                    <th className="num">Line Total</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {view.map(v => (
                    <tr key={v.sku}>
                      <td>{v.sku}</td>
                      <td className="truncate-cell">{v.name}</td>
                      <td>{v.uom_code || '-'}</td>
                      <td className="num">{INR0.format(v.selling_price)}</td>
                      <td className="num">
                        <input
                          className="input text-right w-24"
                          type="number"
                          min={1}
                          max={500}
                          value={v.qty}
                          onChange={(e) => setQty(v.sku, parseInt(e.target.value || '1', 10))}
                        />
                      </td>
                      <td className="num">{INR0.format(v.lineTotal)}</td>
                      <td>
                        <button
                          type="button"
                          className="rounded bg-red-600 text-white px-2 py-1 text-sm hover:bg-red-700"
                          onClick={() => removeLine(v.sku)}
                          title="Remove line"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-semibold">
                    <td colSpan={4}></td>
                    <td className="num">Total</td>
                    <td className="num">{INR0.format(total)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Next actions area */}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={() => {
                  // Optional: hand over to an Invoice/New page with a seed as well
                  try {
                    const out = view.map(v => ({ sku: v.sku, qty: v.qty }));
                    localStorage.setItem('invoice-seed', JSON.stringify(out));
                  } catch {}
                  window.open('/invoice/new?seed=1', '_blank', 'noopener,noreferrer');
                }}
                className="bg-emerald-600 hover:bg-emerald-700"
                title="(Optional) Continue to Invoice editor with these lines"
              >
                Continue to Invoice (seed)
              </Button>

              <Button
                type="button"
                onClick={() => {
                  try { localStorage.removeItem('estimate-seed'); } catch {}
                  alert('Estimate seed cleared.');
                }}
                className="bg-gray-700 hover:bg-gray-800"
              >
                Clear Seed Now
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
