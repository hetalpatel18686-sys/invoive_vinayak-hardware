'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import Button from '@/components/Button';

/* ---------------- Whole-rupee helpers ---------------- */
const rupeeCeil = (n: number) => Math.ceil((n ?? 0) + Number.EPSILON);
const INR0 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

const withGst = (base: number, gstPct: number) =>
  rupeeCeil((base ?? 0) * (1 + (gstPct ?? 0) / 100));

const withGstAndMargin = (base: number, gstPct: number, marginPct: number) =>
  rupeeCeil(withGst(base ?? 0, gstPct ?? 0) * (1 + (marginPct ?? 0) / 100));

/* ---------------- Branding (env overrides) ---------------- */
const BRAND_NAME    = process.env.NEXT_PUBLIC_BRAND_NAME     || 'Vinayak Hardware';
const BRAND_LOGO    = process.env.NEXT_PUBLIC_BRAND_LOGO_URL || '/logo.png';
const BRAND_ADDRESS = process.env.NEXT_PUBLIC_BRAND_ADDRESS  || 'Bilimora, Gandevi, Navsari, Gujarat, 396321';
const BRAND_PHONE   = process.env.NEXT_PUBLIC_BRAND_PHONE    || '+91 7046826808';

/* ---------------- Types ---------------- */
interface EstimateLineReq { sku: string; qty: number; }

interface ItemRow {
  id?: string;
  sku: string;
  name: string;
  uom_code: string;
  purchase_price: number | null;
  gst_percent: number | null;
  margin_percent: number | null;
  unit_cost: number | null;
  selling_price_per_unit?: number | null;
  selling_price: number; // computed
}

/* ---------------- Barcode / QR helpers ---------------- */
const JSBARCODE_STATIC_URL =
  process.env.NEXT_PUBLIC_JSBARCODE_URL ||
  '/vendor/jsbarcode.min.js' ||
  'https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js';

async function ensureJsBarcode(): Promise<any> {
  if (typeof window !== 'undefined' && (window as any).JsBarcode) return (window as any).JsBarcode;

  await new Promise<void>((resolve, reject) => {
    const id = 'injected-jsbarcode';
    if (document.getElementById(id)) return resolve();
    const s = document.createElement('script');
    s.id = id;
    s.src = JSBARCODE_STATIC_URL;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      const fid = 'injected-jsbarcode-cdn';
      if (document.getElementById(fid)) return resolve();
      const f = document.createElement('script');
      f.id = fid;
      f.src = 'https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js';
      f.async = true;
      f.onload = () => resolve();
      f.onerror = () => reject(new Error('Failed to load JsBarcode'));
      document.head.appendChild(f);
    };
    document.head.appendChild(s);
  });
  return (window as any).JsBarcode;
}

const QRCODE_STATIC_URL =
  process.env.NEXT_PUBLIC_QRCODE_URL ||
  '/vendor/qrcode.min.js' ||
  'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js';

async function ensureQRCodeFromStatic(): Promise<any> {
  const g: any = typeof window !== 'undefined' ? window : {};
  if (g.QRCode || g.qrcode) return g.QRCode || g.qrcode;

  await new Promise<void>((resolve, reject) => {
    const id = 'injected-qrcode';
    if (document.getElementById(id)) return resolve();
    const s = document.createElement('script');
    s.id = id;
    s.src = QRCODE_STATIC_URL;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      const fid = 'injected-qrcode-cdn';
      if (document.getElementById(fid)) return resolve();
      const f = document.createElement('script');
      f.id = fid;
      f.src = 'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js';
      f.async = true;
      f.onload = () => resolve();
      f.onerror = () => reject(new Error('Failed to load QRCode'));
      document.head.appendChild(f);
    };
    document.head.appendChild(s);
  });
  return (window as any).QRCode || (window as any).qrcode;
}

function BarcodeSvg({ value }: { value: string }) {
  const ref = React.useRef<SVGSVGElement | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!ref.current || !value) return;
      try {
        const JsBarcode = await ensureJsBarcode();
        if (cancelled || !ref.current) return;
        while (ref.current.firstChild) ref.current.removeChild(ref.current.firstChild);
        JsBarcode(ref.current, value, {
          format: 'CODE128',
          width: 1.2,
          height: 30,
          displayValue: true,
          fontSize: 10,
          textMargin: 0,
          margin: 0,
          lineColor: '#000',
        });
      } catch {
        if (!ref.current) return;
        const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        txt.setAttribute('x', '0'); txt.setAttribute('y', '12');
        txt.setAttribute('fill', '#000'); txt.setAttribute('font-size', '10');
        txt.textContent = value;
        ref.current.appendChild(txt);
      }
    })();
    return () => { cancelled = true; };
  }, [value]);
  return <svg ref={ref} style={{ width: '100%', height: '32px' }} />;
}

function QrSvg({ value, sizePx = 56 }: { value: string; sizePx?: number }) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!ref.current || !value) return;
      try {
        const QR: any = await ensureQRCodeFromStatic();
        if (cancelled || !ref.current) return;
        const toString = QR.toString || QR.default?.toString || QR?.toString;
        if (!toString) throw new Error('QR lib missing toString()');
        const svg = await toString(String(value), { type: 'svg', margin: 0, width: sizePx });
        ref.current.innerHTML = svg;
        const svgEl = ref.current.querySelector('svg') as SVGSVGElement | null;
        if (svgEl) { svgEl.setAttribute('width', `${sizePx}px`); svgEl.setAttribute('height', `${sizePx}px`); }
      } catch {
        if (!ref.current) return;
        ref.current.textContent = value;
      }
    })();
    return () => { cancelled = true; };
  }, [value, sizePx]);
  return <div ref={ref} style={{ width: sizePx, height: sizePx }} />;
}

/* ---------------- Parse helpers ---------------- */
function parseLinesParam(linesParam: string | null): EstimateLineReq[] {
  if (!linesParam) return [];
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
    .filter(Boolean) as EstimateLineReq[];
}

/**
 * Robust loader:
 *  1) try IN(skus) exact match
 *  2) for any missing skus, fetch individually with ILIKE (case-insensitive exact)
 */
async function loadItemsForSkus(skusInput: string[]): Promise<ItemRow[]> {
  const skus = Array.from(new Set(skusInput.map(s => (s ?? '').trim()).filter(Boolean)));
  if (skus.length === 0) return [];

  // 1) fast path: IN
  let got: any[] = [];
  try {
    const { data, error } = await supabase
      .from('items')
      .select('id, sku, name, unit_cost, uom_id, purchase_price, gst_percent, margin_percent, selling_price_per_unit')
      .in('sku', skus);
    if (error) throw error;
    got = data ?? [];
  } catch (e) {
    console.warn('[Estimate] IN fetch failed; will use ILIKE per sku:', e);
  }

  // Index what we have
  const bySku = new Map<string, any>((got || []).map((it: any) => [String(it.sku || '').trim(), it]));

  // 2) fill missing via ILIKE (exact, case-insensitive)
  const missing = skus.filter(sku => !bySku.has(sku));
  if (missing.length > 0) {
    for (const sku of missing) {
      try {
        const { data, error } = await supabase
          .from('items')
          .select('id, sku, name, unit_cost, uom_id, purchase_price, gst_percent, margin_percent, selling_price_per_unit')
          .ilike('sku', sku)  // exact string, case-insensitive
          .limit(1);
        if (error) throw error;
        const it = (data ?? [])[0];
        if (it?.sku) bySku.set(String(it.sku).trim(), it);
      } catch (e) {
        console.warn('[Estimate] ILIKE fetch failed for', sku, e);
      }
    }
  }

  // 3) UOM codes
  const all = Array.from(bySku.values());
  const uomIds = Array.from(new Set(all.map((it: any) => it?.uom_id).filter(Boolean)));
  const uomMap = new Map<any, string>();
  if (uomIds.length > 0) {
    try {
      const { data: uoms } = await supabase.from('units_of_measure').select('id, code').in('id', uomIds);
      (uoms ?? []).forEach((u: any) => uomMap.set(u.id, u.code));
    } catch (e) {
      console.warn('[Estimate] UOM load failed:', e);
    }
  }

  // 4) Normalize + compute selling
  const normalized: ItemRow[] = skus.map(sku => {
    const it = bySku.get(sku);
    if (!it) {
      return {
        sku,
        name: '(Unknown item)',
        uom_code: '',
        purchase_price: null, gst_percent: null, margin_percent: null,
        unit_cost: null, selling_price_per_unit: null, selling_price: 0,
      };
    }
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

  return normalized;
}

/* ---------------- Page ---------------- */
export default function EstimatePage() {
  const sp = useSearchParams();

  // Inputs
  const seedFlag   = sp?.get('seed')  || null;
  const linesParam = sp?.get('lines') || null;
  const singleSku  = sp?.get('sku')   || null;  // legacy single
  const singleQty  = sp?.get('qty')   || null;

  // UI
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [seedUsed, setSeedUsed] = useState<'none'|'lines'|'localStorage'|'single'>('none');

  // Lines + items
  const [lines, setLines] = useState<EstimateLineReq[]>([]);
  const [items, setItems] = useState<ItemRow[]>([]);

  // Manual add
  const [addSku, setAddSku] = useState('');
  const [addQty, setAddQty] = useState(1);

  // Print extras
  const [showBarcode, setShowBarcode] = useState(true);
  const [showQr, setShowQr] = useState(false);

  // Build request
  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setErrorMsg('');

        let req: EstimateLineReq[] = parseLinesParam(linesParam);
        if (req.length > 0) setSeedUsed('lines');

        if (req.length === 0 && seedFlag) {
          try {
            const seed = localStorage.getItem('estimate-seed');
            if (seed) {
              const arr = JSON.parse(seed) as EstimateLineReq[];
              if (Array.isArray(arr) && arr.length > 0) {
                req = arr.map(x => ({
                  sku: String(x?.sku || '').trim(),
                  qty: Math.max(1, Math.min(500, Math.floor(Number(x?.qty) || 1))),
                })).filter(x => x.sku);
                setSeedUsed('localStorage');
              }
            }
          } catch (e) {
            console.warn('[Estimate] seed read failed:', e);
          }
        }

        if (req.length === 0 && (singleSku || singleQty)) {
          const sku = (singleSku || '').trim();
          const qty = Math.max(1, Math.min(500, Math.floor(parseInt(singleQty || '1', 10) || 1)));
          if (sku) { req = [{ sku, qty }]; setSeedUsed('single'); }
        }

        if (req.length === 0) {
          setLines([]); setItems([]); setSeedUsed('none'); setLoading(false); return;
        }

        // Merge dups
        const mm = new Map<string, number>();
        for (const r of req) mm.set(r.sku, (mm.get(r.sku) || 0) + r.qty);
        const merged = Array.from(mm.entries()).map(([sku, qty]) => ({ sku, qty }));

        setLines(merged);

        // Robust item load
        const rows = await loadItemsForSkus(merged.map(r => r.sku));
        setItems(rows);
      } catch (e: any) {
        console.error(e);
        setErrorMsg(e?.message || 'Failed to load estimate.');
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linesParam, seedFlag, singleSku, singleQty]);

  // View join
  const view = useMemo(() => {
    const qtyBySku = new Map(lines.map(l => [l.sku, l.qty]));
    return items.map(it => {
      const qty = Math.max(1, Math.min(500, Math.floor(qtyBySku.get(it.sku) || 1)));
      const lineTotal = rupeeCeil(qty * Number(it.selling_price || 0));
      return { ...it, qty, lineTotal };
    });
  }, [items, lines]);

  const grand = useMemo(() => view.reduce((s, v) => s + v.lineTotal, 0), [view]);

  // Handlers
  const setQty = (sku: string, qty: number) => {
    const q = Math.max(1, Math.min(500, Math.floor(qty || 1)));
    setLines(prev => prev.map(l => l.sku === sku ? { ...l, qty: q } : l));
  };
  const removeLine = (sku: string) => {
    setLines(prev => prev.filter(l => l.sku !== sku));
    setItems(prev => prev.filter(i => i.sku !== sku));
  };
  const addLineBySku = async () => {
    const sku = (addSku || '').trim();
    const qty = Math.max(1, Math.min(500, Math.floor(addQty || 1)));
    if (!sku) return alert('Enter a SKU');
    try {
      setLoading(true);
      const rows = await loadItemsForSkus([sku]);
      const found = rows[0];
      if (!found || !found.sku) return alert(`Item not found: ${sku}`);

      setLines(prev => {
        const idx = prev.findIndex(l => l.sku === sku);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = { sku, qty: Math.max(1, Math.min(500, (next[idx].qty || 0) + qty)) };
          return next;
        }
        return [...prev, { sku, qty }];
      });
      setItems(prev => prev.some(p => p.sku === found.sku) ? prev : [...prev, found]);
      setAddSku(''); setAddQty(1);
    } catch (e: any) {
      console.error(e);
      alert(e?.message || 'Add failed');
    } finally { setLoading(false); }
  };

  // Print only the estimate (branding + lines)
  const handlePrint = () => { try { window.print(); } catch {} };

  return (
    <div className="space-y-4">
      <style>{`
        .num { text-align: right; font-variant-numeric: tabular-nums; }
        @media print {
          @page { margin: 10mm; }
          body * { visibility: hidden !important; }
          .print-area, .print-area * { visibility: visible !important; }
          .print-area { position: absolute; left: 0; top: 0; width: 100%; }
          .no-print { display: none !important; }
        }
      `}</style>

      {/* ---- Screen toolbar (not printed) ---- */}
      <div className="card no-print">
        <div className="flex flex-wrap items-end gap-3 mb-3">
          <div className="text-lg font-semibold mr-auto">Estimate</div>

          <Link href="/inventory" className="rounded border px-3 py-2 hover:bg-neutral-50">Back to Inventory</Link>
          <Button type="button" onClick={() => window.location.reload()}>Refresh</Button>
          <Button type="button" className="bg-gray-700 hover:bg-gray-800"
            onClick={() => { try { localStorage.removeItem('estimate-seed'); alert('Seed cleared'); } catch {} }}>
            Clear Seed
          </Button>
          <Button type="button" onClick={() => { window.location.href = '/estimate/new?seed=1'; }}>
            Re-import Seed
          </Button>
          <Button type="button" className="bg-gray-700 hover:bg-gray-800" onClick={handlePrint}>Print</Button>
        </div>

        {/* Manual add */}
        <div className="grid sm:grid-cols-3 gap-2">
          <div>
            <label className="label">Add by SKU</label>
            <input className="input" placeholder="e.g. VH-001"
              value={addSku}
              onChange={(e) => setAddSku(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addLineBySku(); }} />
          </div>
          <div>
            <label className="label">Qty</label>
            <input className="input" type="number" min={1} max={500}
              value={addQty}
              onChange={(e) => setAddQty(Math.max(1, Math.min(500, Math.floor(parseInt(e.target.value || '1', 10)))))}
              onKeyDown={(e) => { if (e.key === 'Enter') addLineBySku(); }} />
          </div>
          <div className="self-end">
            <Button type="button" onClick={addLineBySku}>Add Line</Button>
          </div>
        </div>

        {/* Print extras toggles */}
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={showBarcode} onChange={(e) => setShowBarcode(e.target.checked)} />
            Print barcode per SKU
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={showQr} onChange={(e) => setShowQr(e.target.checked)} />
            Print QR (SKU)
          </label>
        </div>
      </div>

      {/* ---- PRINT AREA (branding + lines only) ---- */}
      <div className="print-area">
        <div className="mb-3 flex items-start gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {BRAND_LOGO ? <img src={BRAND_LOGO} alt="logo" className="h-14 w-14 rounded bg-white object-contain" /> : null}
          <div>
            <div className="text-2xl font-bold text-orange-600">{BRAND_NAME}</div>
            <div className="text-sm text-gray-700">{BRAND_ADDRESS}</div>
            <div className="text-sm text-gray-700">Phone: {BRAND_PHONE}</div>
          </div>
          <div className="ml-auto text-right">
            <div className="text-xl font-semibold">ESTIMATE</div>
            <div className="text-xs text-gray-600">{new Date().toLocaleString()}</div>
          </div>
        </div>

        {loading ? (
          <div className="py-8 text-center text-gray-600">Loading…</div>
        ) : errorMsg ? (
          <div className="py-8 text-center text-red-600">{errorMsg}</div>
        ) : view.length === 0 ? (
          <div className="py-8 text-center text-gray-700">
            No lines to estimate yet.<br />
            Use <b>Inventory → Estimate</b> or add lines here.
          </div>
        ) : (
          <div className="overflow-auto">
            <table className="table w-full">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th style={{ minWidth: 240 }}>Item</th>
                  <th>UoM</th>
                  <th className="num">Selling</th>
                  <th className="num">Qty</th>
                  <th className="num">Line Total</th>
                </tr>
              </thead>
              <tbody>
                {view.map(v => (
                  <tr key={v.sku}>
                    <td>
                      <div className="flex flex-col gap-1">
                        <div>{v.sku}</div>
                        {showBarcode && <BarcodeSvg value={v.sku} />}
                        {showQr && <QrSvg value={v.sku} />}
                      </div>
                    </td>
                    <td>{v.name}</td>
                    <td>{v.uom_code || '-'}</td>
                    <td className="num">{INR0.format(v.selling_price)}</td>
                    <td className="num">{v.qty}</td>
                    <td className="num">{INR0.format(v.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold">
                  <td colSpan={4}></td>
                  <td className="num">Total</td>
                  <td className="num">{INR0.format(grand)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* ---- Screen editable grid (hidden on print) ---- */}
      {view.length > 0 && (
        <div className="card no-print">
          <div className="overflow-auto">
            <table className="table w-full">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th style={{ minWidth: 220 }}>Item</th>
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
                  <td className="num">{INR0.format(grand)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
