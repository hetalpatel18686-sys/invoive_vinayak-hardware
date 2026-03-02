'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import Button from '@/components/Button';

/* =========================
   Whole-rupee helpers
   ========================= */
const rupeeCeil = (n: number) => Math.ceil((n ?? 0) + Number.EPSILON);
const INR0 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

const withGst = (base: number, gstPct: number) =>
  rupeeCeil((base ?? 0) * (1 + (gstPct ?? 0) / 100));

const withGstAndMargin = (base: number, gstPct: number, marginPct: number) =>
  rupeeCeil(withGst(base ?? 0, gstPct ?? 0) * (1 + (marginPct ?? 0) / 100));

/* =========================
   Branding (env or defaults)
   ========================= */
const BRAND_NAME    = process.env.NEXT_PUBLIC_BRAND_NAME     || 'Vinayak Hardware';
const BRAND_LOGO    = process.env.NEXT_PUBLIC_BRAND_LOGO_URL || '/logo.png';
const BRAND_ADDRESS = process.env.NEXT_PUBLIC_BRAND_ADDRESS  || 'Bilimora, Gandevi, Navsari, Gujarat, 396321';
const BRAND_PHONE   = process.env.NEXT_PUBLIC_BRAND_PHONE    || '+91 7046826808';

/* =========================
   Types
   ========================= */
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
  selling_price: number; // computed (whole rupees)
}

/* =========================
   SKU normalization helpers
   ========================= */
function normalizeHyphens(s: string) { return String(s || '').replace(/[\u2010\u2011\u2012\u2013\u2014\u2212]/g, '-'); }
function canonicalSku(s: string) { return normalizeHyphens(String(s || '').trim()).replace(/\s+/g, ' '); }
function skuCore(s: string) { return canonicalSku(s).toLowerCase().replace(/[^a-z0-9]/g, ''); }
function variantsFor(s: string): string[] {
  const c = canonicalSku(s);
  const v = new Set<string>([
    c, c.toUpperCase(), c.toLowerCase(),
    c.replace(/\s+/g, ''),
    c.toUpperCase().replace(/\s+/g, ''),
    c.toLowerCase().replace(/\s+/g, ''),
  ]);
  return Array.from(v);
}

/* =========================
   Barcode + QR (print only)
   ========================= */
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
          format: 'CODE128', width: 1.2, height: 30,
          displayValue: true, fontSize: 10, textMargin: 0, margin: 0, lineColor: '#000',
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

/* =========================
   Parse helpers
   ========================= */
function parseLinesParam(linesParam: string | null): EstimateLineReq[] {
  if (!linesParam) return [];
  return linesParam
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(pair => {
      const [skuRaw, qtyRaw] = pair.split(':');
      const sku = canonicalSku(skuRaw || '');
      const qty = Math.max(1, Math.min(500, Math.floor(parseInt((qtyRaw || '1').trim(), 10) || 1)));
      return sku ? { sku, qty } : null;
    })
    .filter(Boolean) as EstimateLineReq[];
}

/* =========================
   Robust DB loader (fallback only)
   ========================= */
async function loadItemsForSkus(skusInput: string[]): Promise<ItemRow[]> {
  const wantedCanon = Array.from(new Set(skusInput.map(canonicalSku).filter(Boolean)));
  if (wantedCanon.length === 0) return [];

  // 1) IN() with variants
  const varSet = new Set<string>();
  wantedCanon.forEach(w => variantsFor(w).forEach(v => varSet.add(v)));
  const variants = Array.from(varSet);

  let fetched: any[] = [];
  try {
    const { data } = await supabase
      .from('items')
      .select('id, sku, name, unit_cost, uom_id, purchase_price, gst_percent, margin_percent, selling_price_per_unit')
      .in('sku', variants);
    fetched = data ?? [];
  } catch (e) {}

  const byCanon = new Map<string, any>();
  const byCore  = new Map<string, any>();
  for (const it of fetched) {
    const c = canonicalSku(it?.sku || '');
    const k = skuCore(it?.sku || '');
    if (c) byCanon.set(c, it);
    if (k) byCore.set(k, it);
  }

  // 2) ILIKE fallback per missing
  const missingCanon = wantedCanon.filter(c => !byCanon.has(c) && !byCore.has(skuCore(c)));
  for (const c of missingCanon) {
    const tries = variantsFor(c);
    let hit: any = null;

    for (const t of tries) {
      try {
        const { data } = await supabase
          .from('items')
          .select('id, sku, name, unit_cost, uom_id, purchase_price, gst_percent, margin_percent, selling_price_per_unit')
          .ilike('sku', t)
          .limit(1);
        if (data && data[0]) { hit = data[0]; break; }
      } catch {}
    }

    if (!hit) {
      for (const t of tries) {
        try {
          const tNoHyphen = t.replace(/-/g, '');
          const { data } = await supabase
            .from('items')
            .select('id, sku, name, unit_cost, uom_id, purchase_price, gst_percent, margin_percent, selling_price_per_unit')
            .or(`sku.ilike.%${t}%,sku.ilike.%${tNoHyphen}%`)
            .limit(3);
          const candidates = (data ?? []);
          const cCore = skuCore(c);
          const pick = candidates.find(x => skuCore(x.sku) === cCore) || candidates[0] || null;
          if (pick) { hit = pick; break; }
        } catch {}
      }
    }

    if (hit?.sku) {
      const hc = canonicalSku(hit.sku);
      const hk = skuCore(hit.sku);
      if (hc) byCanon.set(hc, hit);
      if (hk) byCore.set(hk, hit);
    }
  }

  // 3) UOM lookup
  const allRows = Array.from(new Set([...byCanon.values(), ...byCore.values()]));
  const uomIds = Array.from(new Set(allRows.map((it: any) => it?.uom_id).filter(Boolean)));
  const uomMap = new Map<any, string>();
  if (uomIds.length > 0) {
    try {
      const { data: uoms } = await supabase.from('units_of_measure').select('id, code').in('id', uomIds);
      (uoms ?? []).forEach((u: any) => uomMap.set(u.id, u.code));
    } catch {}
  }

  return wantedCanon.map((c) => {
    const it = byCore.get(skuCore(c)) || byCanon.get(c) || null;
    if (!it) {
      return {
        sku: c, name: '(Unknown item)', uom_code: '-',
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
      uom_code: it.uom_id ? (uomMap.get(it.uom_id) ?? '-') : '-',
      purchase_price: it.purchase_price ?? null,
      gst_percent: it.gst_percent ?? null,
      margin_percent: it.margin_percent ?? null,
      unit_cost: it.unit_cost ?? null,
      selling_price_per_unit: it.selling_price_per_unit ?? null,
      selling_price: selling,
    };
  });
}

/* =========================
   Page
   ========================= */
export default function EstimateClient() {
  const sp = useSearchParams();

  const seedFlag   = sp?.get('seed')  || null;
  const linesParam = sp?.get('lines') || null;
  const singleSku  = sp?.get('sku')   || null;
  const singleQty  = sp?.get('qty')   || null;

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  const [lines, setLines] = useState<EstimateLineReq[]>([]);
  const [items, setItems] = useState<ItemRow[]>([]);

  // Manual add (supports custom lines without DB)
  const [addSku, setAddSku] = useState('');
  const [addQty, setAddQty] = useState(1);
  const [addName, setAddName] = useState('');       // optional
  const [addUom, setAddUom] = useState('');         // optional
  const [addSelling, setAddSelling] = useState(''); // optional

  const [showBarcode, setShowBarcode] = useState(true);
  const [showQr, setShowQr] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true); setErrorMsg('');

        // 1) Prefer SEED path (works even if seed has only sku/qty, and flexible keys)
        let seedArr: any[] = [];
        if (seedFlag) {
          try {
            const seed = localStorage.getItem('estimate-seed');
            if (seed) seedArr = JSON.parse(seed) as any[];
          } catch {}
        }
        if (Array.isArray(seedArr) && seedArr.length > 0) {
          // Accumulator type with deterministic fields (no optionals)
          type SeedAccum = { sku: string; qty: number; name: string; uom_code: string; selling: number };
          const mm = new Map<string, SeedAccum>();

          for (const it of seedArr) {
            const rawSku = it?.sku ?? '';
            const sku = canonicalSku(String(rawSku));
            if (!sku) continue;

            const qty = Math.max(1, Math.min(500, Math.floor(Number(it?.qty) || 1)));

            // Accept many possible field names from seed
            const name: string =
              it?.name ?? it?.item ?? it?.description ?? sku;

            const uom_code: string =
              it?.uom_code ?? it?.uom ?? '';

            const sellingCandidate =
              it?.selling ?? it?.sellingPrice ?? it?.selling_price ?? it?.price ?? it?.unit_price ?? it?.unitPrice;

            const selling: number = Number.isFinite(Number(sellingCandidate))
              ? rupeeCeil(Number(sellingCandidate))
              : 0;

            const prev = mm.get(sku);
            mm.set(sku, {
              sku,
              qty: (prev?.qty ?? 0) + qty,
              name: String(name),
              uom_code: String(uom_code || '-'),
              selling: Number(selling) || 0,
            } as SeedAccum);
          }

          const merged: SeedAccum[] = Array.from(mm.values());

          setLines(merged.map(x => ({ sku: x.sku, qty: x.qty })));

          // Build strongly-typed ItemRow objects (no undefineds)
          const seedItems: ItemRow[] = merged.map(x => ({
            sku: x.sku,
            name: String(x.name || x.sku),
            uom_code: String(x.uom_code || '-'),
            purchase_price: null,
            gst_percent: null,
            margin_percent: null,
            unit_cost: null,
            selling_price_per_unit: Number(x.selling) || 0,
            selling_price: Number(x.selling) || 0,
          }));
          setItems(seedItems);

          setLoading(false);
          return;
        }

        // 2) Otherwise parse ?lines= (small/mid)
        let req: EstimateLineReq[] = parseLinesParam(linesParam);

        // 3) Legacy single
        if (req.length === 0 && (singleSku || singleQty)) {
          const sku = canonicalSku(singleSku || '');
          const qty = Math.max(1, Math.min(500, Math.floor(parseInt(singleQty || '1', 10) || 1)));
          if (sku) req = [{ sku, qty }];
        }

        if (req.length === 0) {
          setLines([]); setItems([]); setLoading(false); return;
        }

        // Merge dups
        const mm2 = new Map<string, number>();
        for (const r of req) mm2.set(canonicalSku(r.sku), (mm2.get(canonicalSku(r.sku)) || 0) + r.qty);
        const merged2 = Array.from(mm2.entries()).map(([sku, qty]) => ({ sku, qty }));
        setLines(merged2);

        // DB fallback
        const rows = await loadItemsForSkus(merged2.map(r => r.sku));
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

  const view = useMemo(() => {
    const qtyByCore = new Map(lines.map(l => [skuCore(l.sku), l.qty]));
    return items.map(it => {
      const qty = Math.max(1, Math.min(500, Math.floor(qtyByCore.get(skuCore(it.sku)) || 1)));
      const lineTotal = rupeeCeil(qty * Number(it.selling_price || 0));
      return { ...it, qty, lineTotal };
    });
  }, [items, lines]);

  const grand = useMemo(() => view.reduce((s, v) => s + v.lineTotal, 0), [view]);

  const setQtyLine = (sku: string, qty: number) => {
    const key = skuCore(sku);
    const q = Math.max(1, Math.min(500, Math.floor(qty || 1)));
    setLines(prev => prev.map(l => skuCore(l.sku) === key ? { ...l, qty: q } : l));
  };
  const removeLine = (sku: string) => {
    const key = skuCore(sku);
    setLines(prev => prev.filter(l => skuCore(l.sku) !== key));
    setItems(prev => prev.filter(i => skuCore(i.sku) !== key));
  };

  /** Manual Add:
   *  - If Name/UoM/Selling provided -> add custom line (no DB).
   *  - Else try DB; if not found -> add placeholder (never blank).
   */
  const addLineBySku = async () => {
    const sku = canonicalSku(addSku);
    const qty = Math.max(1, Math.min(500, Math.floor(addQty || 1)));
    const hasCustom = Boolean(addName || addUom || addSelling);
    if (!sku) return alert('Enter a SKU');

    if (hasCustom) {
      const selling = Math.max(0, Math.floor(Number(addSelling || 0)));
      const customRow: ItemRow = {
        sku,
        name: addName || sku,
        uom_code: addUom || '-',
        purchase_price: null, gst_percent: null, margin_percent: null, unit_cost: null,
        selling_price_per_unit: selling,
        selling_price: selling,
      };
      setLines(prev => {
        const exists = prev.find(l => skuCore(l.sku) === skuCore(sku));
        if (exists) {
          return prev.map(l => skuCore(l.sku) === skuCore(sku)
            ? { sku: l.sku, qty: Math.max(1, Math.min(500, (l.qty || 0) + qty)) }
            : l
          );
        }
        return [...prev, { sku, qty }];
      });
      setItems(prev => prev.some(p => skuCore(p.sku) === skuCore(sku)) ? prev : [...prev, customRow]);

      setAddSku(''); setAddQty(1); setAddName(''); setAddUom(''); setAddSelling('');
      return;
    }

    try {
      const rows = await loadItemsForSkus([sku]);
      const found = rows[0];
      const rowToUse: ItemRow = found && found.sku ? found : {
        sku, name: sku, uom_code: '-', purchase_price: null, gst_percent: null, margin_percent: null,
        unit_cost: null, selling_price_per_unit: 0, selling_price: 0,
      };
      setLines(prev => {
        const exists = prev.find(l => skuCore(l.sku) === skuCore(sku));
        if (exists) {
          return prev.map(l => skuCore(l.sku) === skuCore(sku)
            ? { sku: l.sku, qty: Math.max(1, Math.min(500, (l.qty || 0) + qty)) }
            : l
          );
        }
        return [...prev, { sku: rowToUse.sku, qty }];
      });
      setItems(prev => prev.some(p => skuCore(p.sku) === skuCore(rowToUse.sku)) ? prev : [...prev, rowToUse]);

      setAddSku(''); setAddQty(1);
    } catch (e: any) {
      console.error(e);
      alert(e?.message || 'Add failed');
    }
  };

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

      {/* ---- Toolbar (screen only) ---- */}
      <div className="card no-print">
        <div className="flex flex-wrap items-end gap-3 mb-3">
          <div className="text-lg font-semibold mr-auto">Estimate</div>

          /inventoryBack to Inventory</Link>
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

        {/* Manual add (supports custom lines without DB) */}
        <div className="grid lg:grid-cols-5 md:grid-cols-4 sm:grid-cols-2 gap-2">
          <div>
            <label className="label">SKU</label>
            <input
              className="input"
              placeholder="e.g. VH-001"
              value={addSku}
              onChange={(e) => setAddSku(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addLineBySku(); }}
            />
          </div>
          <div>
            <label className="label">Qty</label>
            <input
              className="input"
              type="number"
              min={1}
              max={500}
              value={addQty}
              onChange={(e) => setAddQty(Math.max(1, Math.min(500, Math.floor(parseInt(e.target.value || '1', 10)))))}
              onKeyDown={(e) => { if (e.key === 'Enter') addLineBySku(); }}
            />
          </div>
          <div>
            <label className="label">Name (optional)</label>
            <input
              className="input"
              placeholder="Item name"
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addLineBySku(); }}
            />
          </div>
          <div>
            <label className="label">UoM (optional)</label>
            <input
              className="input"
              placeholder="PCS / BOX / MTR"
              value={addUom}
              onChange={(e) => setAddUom(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addLineBySku(); }}
            />
          </div>
          <div>
            <label className="label">Selling ₹ (optional)</label>
            <input
              className="input"
              type="number"
              min={0}
              step={1}
              placeholder="e.g. 125"
              value={addSelling}
              onChange={(e) => setAddSelling(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addLineBySku(); }}
            />
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

      {/* ---- PRINT AREA: branding + table only ---- */}
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

        <EstimateTable view={view} showBarcode={showBarcode} showQr={showQr} grand={grand} />
      </div>

      {/* ---- Editable grid (screen), hidden on print ---- */}
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
                  <tr key={skuCore(v.sku)}>
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
                        onChange={(e) => setQtyLine(v.sku, parseInt(e.target.value || '1', 10))}
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

      {/* Error (if any) */}
      {errorMsg ? (
        <div className="text-red-700 text-sm no-print">
          {errorMsg}
        </div>
      ) : null}
    </div>
  );
}

/* -----------------------
   Small presentational table for print area
   ----------------------- */
function EstimateTable({
  view, showBarcode, showQr, grand,
}: {
  view: Array<{
    sku: string; name: string; uom_code: string;
    selling_price: number; qty: number; lineTotal: number;
  }>;
  showBarcode: boolean;
  showQr: boolean;
  grand: number;
}) {
  return (
    <>
      {view.length === 0 ? (
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
                <tr key={skuCore(v.sku)}>
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
    </>
  );
}
