'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import Button from '@/components/Button';

/* ======================================================
   Round-up helpers (ALWAYS whole rupees)
   ====================================================== */
const rupeeCeil = (n: number) => Math.ceil((n ?? 0) + Number.EPSILON);
const INR0 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

const withGst = (base: number, gstPct: number) =>
  rupeeCeil((base ?? 0) * (1 + (gstPct ?? 0) / 100));

const withGstAndMargin = (base: number, gstPct: number, marginPct: number) =>
  rupeeCeil(withGst(base ?? 0, gstPct ?? 0) * (1 + (marginPct ?? 0) / 100));

/* ======================================================
   Types
   ====================================================== */
interface InvRow {
  id: string;
  sku: string;
  name: string;
  stock_qty: number;
  unit_cost: number; // fallback average cost
  uom_code: string;
  low_stock_threshold: number | null;
  locations: { name: string; qty: number }[];
  locations_all: { name: string; qty: number }[];
  locations_text: string;

  // pricing fields from DB
  purchase_price: number | null;
  gst_percent: number | null;
  margin_percent: number | null;
}

type SortKey =
  | 'sku'
  | 'name'
  | 'uom_code'
  | 'stock_qty'
  | 'low_stock_threshold'
  | 'unit_cost'
  | 'total_value'
  | 'locations_text';

type LocationScope = 'all_items' | 'has_stock' | 'appears_any';
type Sel = Record<string, { checked: boolean; qty: number }>;

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/* ======================================================
   CSV helper
   ====================================================== */
function downloadCsv(filename: string, rows: string[]) {
  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* ======================================================
   Sort header
   ====================================================== */
function SortHeader({
  label, active, dir, onClick, alignRight = false,
}: {
  label: string; active: boolean; dir: 'asc'|'desc';
  onClick: () => void; alignRight?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`th-label font-semibold ${alignRight ? 'justify-end' : 'justify-start'}`}
      style={{ whiteSpace: 'nowrap' }}
      title={`Sort by ${label}`}
    >
      <span>{label}</span>
      <span className="text-xs opacity-70">{active ? (dir === 'asc' ? '▲' : '▼') : '↕'}</span>
    </button>
  );
}

/* ======================================================
   Barcode + QR loaders
   ====================================================== */
const JSBARCODE_STATIC_URL =
  process.env.NEXT_PUBLIC_JSBARCODE_URL
  || '/vendor/jsbarcode.min.js'
  || 'https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js';

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
  process.env.NEXT_PUBLIC_QRCODE_URL
  || '/vendor/qrcode.min.js'
  || 'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js';

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

function BarcodeSvg({
  value,
  options,
}: {
  value: string;
  options?: Partial<{
    format: string; width: number; height: number; displayValue: boolean;
    fontSize: number; textMargin: number; margin: number; lineColor: string;
  }>;
}) {
  const svgRef = React.useRef<SVGSVGElement | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!svgRef.current || !value) return;
      try {
        const JsBarcode = await ensureJsBarcode();
        if (cancelled || !svgRef.current) return;
        while (svgRef.current.firstChild) svgRef.current.removeChild(svgRef.current.firstChild);
        JsBarcode(svgRef.current, value, {
          format: 'CODE128',
          width: 1.4,
          height: 12,
          displayValue: true,
          fontSize: 8,
          textMargin: 0,
          margin: 0,
          lineColor: '#000',
          ...(options || {}),
        });
      } catch {
        if (!svgRef.current) return;
        const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        txt.setAttribute('x', '0'); txt.setAttribute('y', '10');
        txt.setAttribute('fill', '#000'); txt.setAttribute('font-size', '8');
        txt.textContent = value;
        svgRef.current.appendChild(txt);
      }
    })();
    return () => { cancelled = true; };
  }, [value, options]);

  return <svg ref={svgRef} className="w-full h-auto" />;
}

function QrSvg({ value, sizeMm = 11 }: { value: string; sizeMm?: number }) {
  const wrapRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!wrapRef.current || !value) return;
      try {
        const QR: any = await ensureQRCodeFromStatic();
        if (cancelled || !wrapRef.current) return;

        const px = Math.max(40, Math.round((sizeMm / 25.4) * 96));
        const toString = QR.toString || QR.default?.toString || QR?.toString;
        if (!toString) throw new Error('QR lib missing toString()');

        const svg = await toString(String(value), { type: 'svg', margin: 0, width: px });
        wrapRef.current.innerHTML = svg;
        const svgEl = wrapRef.current.querySelector('svg') as SVGSVGElement | null;
        if (svgEl) {
          svgEl.setAttribute('width', '100%');
          svgEl.setAttribute('height', '100%');
        }
      } catch {
        if (!wrapRef.current) return;
        wrapRef.current.textContent = value;
      }
    })();
    return () => { cancelled = true; };
  }, [value, sizeMm]);

  return (
    <div ref={wrapRef} style={{ width: `${sizeMm}mm`, height: `${sizeMm}mm`, display: 'block' }} />
  );
}

/* ----------------------------------------------
   Thermal 2×1 label with QR + Barcode (layout-safe)
   ---------------------------------------------- */
function ThermalLabel2x1({
  brand,
  name,
  sku,
  uom,
}: {
  brand?: string;
  name: string;
  sku: string;
  uom?: string;
}) {
  return (
    <div
      className="thermal-label-2x1"
      style={{
        width: '50.8mm',
        height: '25.4mm',
        padding: '1.5mm',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.6mm',
        justifyContent: 'space-between',
        border: '1px solid #e5e7eb', // preview only
        borderRadius: '1mm',
        background: '#fff',
      }}
    >
      {/* Top line */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '1mm' }}>
        <div style={{ fontSize: '8px', fontWeight: 700, lineHeight: '10px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '70%' }}>
          {brand || ''}
        </div>
        {uom ? <div style={{ fontSize: '8px', lineHeight: '10px' }}>UoM: {uom}</div> : null}
      </div>

      {/* Name */}
      <div style={{ fontSize: '9px', lineHeight: '10px', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {name}
      </div>

      {/* Barcode + QR row (layout-safe) */}
      <div
        className="label-row"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '1mm',
          width: '100%',
          flex: 1,
          minHeight: 0,
        }}
      >
        {/* Barcode stretches to remaining width */}
        <div className="barcode-wrap" style={{ flex: 1, minWidth: 0 }}>
          <BarcodeSvg
            value={sku}
            options={{
              height: 12,
              width: 1.4,
              displayValue: true,
              fontSize: 8,
              textMargin: 0,
              margin: 0,
            }}
          />
        </div>

        {/* QR has fixed physical size */}
        <div className="qr-wrap" style={{ width: '11mm', height: '11mm', flex: '0 0 11mm' }}>
          <QrSvg value={sku} sizeMm={11} />
        </div>
      </div>
    </div>
  );
}

/* ======================================================
   Page
   ====================================================== */
export default function InventoryPage() {
  const [loading, setLoading] = useState<boolean>(true);
  const [rows, setRows] = useState<InvRow[]>([]);
  const [search, setSearch] = useState<string>('');
  const [lowOnly, setLowOnly] = useState<boolean>(false);
  const [sortKey, setSortKey] = useState<SortKey>('sku');
  const [sortDir, setSortDir] = useState<'asc'|'desc'>('asc');

  // location filter
  const [allLocations, setAllLocations] = useState<string[]>([]);
  const [selectedLocation, setSelectedLocation] = useState<string>('');
  const [locationScope, setLocationScope] = useState<LocationScope>('all_items');
  const [showZeroQtyLocations, setShowZeroQtyLocations] = useState<boolean>(false);

  // selection for labels
  const [sel, setSel] = useState<Sel>({});
  const [bulkQtyState, setBulkQtyState] = useState<number>(1);
  const setBulkQtyInput = (n: number) => setBulkQtyState(Math.max(1, Math.min(500, Math.floor(n || 1))));

  const brandName = process.env.NEXT_PUBLIC_BRAND_NAME || 'Vinayak Hardware';
  const previewRef = useRef<HTMLDivElement | null>(null);

  const toggleSort = (k: SortKey) => {
    setSortKey(prev => {
      if (prev !== k) { setSortDir('asc'); return k; }
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
      return k;
    });
  };

  const loadInventory = async () => {
    try {
      setLoading(true);
      // Pull pricing fields too
      const { data: itemsData, error: itemsErr } = await supabase
        .from('items')
        .select('id, sku, name, stock_qty, unit_cost, low_stock_threshold, uom_id, purchase_price, gst_percent, margin_percent')
        .order('sku', { ascending: true });
      if (itemsErr) throw itemsErr;

      const { data: uoms } = await supabase.from('units_of_measure').select('id, code');
      const uomMap = new Map<string, string>();
      (uoms ?? []).forEach((u: any) => uomMap.set(u.id, u.code));

      const { data: moves, error: movesErr } = await supabase
        .from('stock_moves')
        .select('item_id, move_type, qty, location');
      if (movesErr) throw movesErr;

      const perItemLocMap = new Map<string, Map<string, number>>();
      const allLocSet = new Set<string>();
      (moves ?? []).forEach((m: any) => {
        const itemId = String(m.item_id);
        const mt = String(m.move_type || '').toLowerCase();
        const loc = (String(m.location ?? '').trim()) || '(unassigned)';
        const qRaw = Number(m.qty ?? 0);
        let delta = qRaw;
        if (mt === 'issue') delta = -Math.abs(qRaw);
        else if (mt === 'receive' || mt === 'return') delta = Math.abs(qRaw);
        if (!perItemLocMap.has(itemId)) perItemLocMap.set(itemId, new Map());
        const map = perItemLocMap.get(itemId)!;
        map.set(loc, (map.get(loc) ?? 0) + delta);
        allLocSet.add(loc);
      });

      const allLocArr = Array.from(allLocSet.values()).sort((a, b) => a.localeCompare(b));
      setAllLocations(allLocArr);

      const mapped: InvRow[] = (itemsData ?? []).map((it: any) => {
        const itemId = String(it.id);
        const locMap = perItemLocMap.get(itemId) ?? new Map<string, number>();
        const locations_all = Array.from(locMap.entries()).map(([name, qty]) => ({ name, qty })).sort((a, b) => a.name.localeCompare(b.name));
        const filteredLocs = locations_all.filter(l => l.qty !== 0);

        return {
          id: it.id,
          sku: it.sku,
          name: it.name,
          stock_qty: Number(it.stock_qty ?? 0),
          unit_cost: Number(it.unit_cost ?? 0),
          low_stock_threshold: it.low_stock_threshold ?? null,
          uom_code: it.uom_id ? (uomMap.get(it.uom_id) ?? '') : '',
          locations: filteredLocs,
          locations_all,
          locations_text: filteredLocs.length ? filteredLocs.map(l => `${l.name}: ${l.qty}`).join(' | ') : '',
          purchase_price: it.purchase_price ?? null,
          gst_percent: it.gst_percent ?? null,
          margin_percent: it.margin_percent ?? null,
        };
      });

      setRows(mapped);
    } catch (e) {
      console.error(e);
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadInventory(); }, []);

  const rowsWithDisplayLocations = useMemo(() => {
    return rows.map(row => {
      const displayLocs = showZeroQtyLocations ? row.locations_all : row.locations_all.filter(l => l.qty !== 0);
      return {
        ...row,
        locations: displayLocs,
        locations_text: displayLocs.length ? displayLocs.map(l => `${l.name}: ${l.qty}`).join(' | ') : '',
      };
    });
  }, [rows, showZeroQtyLocations]);

  const prefiltered = useMemo(() => {
    const t = search.trim().toLowerCase();
    return rowsWithDisplayLocations.filter(r => {
      const match =
        !t ||
        r.sku.toLowerCase().includes(t) ||
        (r.name ?? '').toLowerCase().includes(t) ||
        (r.locations_text ?? '').toLowerCase().includes(t);
      const isLow =
        r.low_stock_threshold != null &&
        r.low_stock_threshold > 0 &&
        r.stock_qty <= r.low_stock_threshold;
      return match && (!lowOnly || isLow);
    });
  }, [rowsWithDisplayLocations, search, lowOnly]);

  // Compute rounded prices for display and totals
  const sorted = useMemo(() => {
    const cp = prefiltered.map(r => {
      const base = Number(r.purchase_price ?? r.unit_cost ?? 0);
      const gst = Number(r.gst_percent ?? 0);
      const margin = Number(r.margin_percent ?? 0);

      const unitCostGst = withGst(base, gst);                 // rounded ₹
      const sellingPrice = withGstAndMargin(base, gst, margin); // rounded ₹
      const total_value = r.stock_qty * sellingPrice;           // integer ₹

      return { ...r, unitCostGst, sellingPrice, total_value };
    });

    cp.sort((a: any, b: any) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      let va: any; let vb: any;
      switch (sortKey) {
        case 'sku': va = a.sku?.toLowerCase() ?? ''; vb = b.sku?.toLowerCase() ?? ''; break;
        case 'name': va = a.name?.toLowerCase() ?? ''; vb = b.name?.toLowerCase() ?? ''; break;
        case 'uom_code': va = a.uom_code?.toLowerCase() ?? ''; vb = b.uom_code?.toLowerCase() ?? ''; break;
        case 'stock_qty': va = Number(a.stock_qty); vb = Number(b.stock_qty); break;
        case 'low_stock_threshold': va = Number(a.low_stock_threshold ?? -Infinity); vb = Number(b.low_stock_threshold ?? -Infinity); break;
        case 'unit_cost': va = Number(a.unit_cost); vb = Number(b.unit_cost); break;
        case 'total_value': va = Number(a.total_value); vb = Number(b.total_value); break;
        case 'locations_text': va = (a.locations_text ?? '').toLowerCase(); vb = (b.locations_text ?? '').toLowerCase(); break;
        default: va = 0; vb = 0;
      }
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      if (va < vb) return -1 * dir;
      if (va > vb) return  1 * dir;
      return 0;
    });

    return cp as (InvRow & { unitCostGst: number; sellingPrice: number; total_value: number })[];
  }, [prefiltered, sortKey, sortDir]);

  const totals = useMemo(() => {
    let qty = 0, value = 0;
    for (const r of sorted) {
      qty += r.stock_qty;
      value += r.total_value; // already integer rupees
    }
    return { qty: round2(qty), value: rupeeCeil(value) };
  }, [sorted]);

  /* =========================
     DELETE row (safe)
     ========================= */
  const deleteRow = async (row: InvRow) => {
    // Safety: block if stock exists
    if ((row.stock_qty ?? 0) > 0) {
      alert('Cannot delete an item that has stock. Please move/issue stock to 0 first.');
      return;
    }
    const ok = window.confirm(`Delete item:\n${row.sku} — ${row.name}\n\nThis cannot be undone.`);
    if (!ok) return;

    const { error } = await supabase.from('items').delete().eq('id', row.id);
    if (error) {
      alert('Delete failed: ' + error.message);
      return;
    }
    setRows(prev => prev.filter(r => r.id !== row.id));
  };

  /* --------------------------------
     PRINT thermal labels
     -------------------------------- */
  const handlePrintThermal = () => {
    // Build selected items from current selection map
    const selectedItems = (() => {
      const arr: { row: InvRow; qty: number }[] = [];
      for (const r of sorted) {
        const s = sel[r.id];
        if (s?.checked && r.sku) arr.push({ row: r, qty: Math.max(1, Math.min(500, Math.floor(s.qty || 1))) });
      }
      return arr;
    })();

    const totalLabels = selectedItems.reduce((sum, it) => sum + it.qty, 0);
    if (totalLabels === 0) {
      alert('Please select items and set label quantities.');
      return;
    }
    const html = previewRef.current?.innerHTML || '';
    if (!html) {
      alert('Please select items (checkbox) and set quantities first.');
      return;
    }

    const docHtml = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Thermal 2x1 Labels</title>
  <style>
    @page { size: 50.8mm 25.4mm; margin: 0; }
    html, body { margin: 0; padding: 0; background: #fff; }
    .sheet { width: 50.8mm; height: 25.4mm; page-break-after: always; }

    .thermal-label-2x1 {
      width: 50.8mm; height: 25.4mm; padding: 1.5mm;
      box-sizing: border-box; border: none !important; background: #fff;
      display: flex; flex-direction: column; gap: 0.6mm; justify-content: space-between;
    }

    /* ---- Layout-safe row ---- */
    .thermal-label-2x1 .label-row { display: flex; align-items: center; gap: 1mm; width: 100%; flex: 1; min-height: 0; }
    .thermal-label-2x1 .label-row .barcode-wrap { flex: 1 1 auto; min-width: 0; }
    .thermal-label-2x1 .label-row .qr-wrap { flex: 0 0 11mm; width: 11mm; height: 11mm; }

    .thermal-label-2x1 .label-row .barcode-wrap svg {
      display: block; width: 100% !important; height: auto !important;
    }
    .thermal-label-2x1 .label-row .qr-wrap svg {
      display: block; width: 100% !important; height: 100% !important;
    }

    svg text { font-size: 8px; }
  </style>
</head>
<body>
  ${(() => {
    const container = document.createElement('div');
    container.innerHTML = html;
    const items = Array.from(container.children);
    return items.map(el => `<div class="sheet">${(el as HTMLElement).outerHTML}</div>`).join('');
  })()}
</body>
</html>`;

    const iframe = document.createElement('iframe');
    iframe.setAttribute('style', 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;');
    document.body.appendChild(iframe);

    const onFrameLoad = () => {
      try {
        const w = iframe.contentWindow!;
        const d = w.document;
        d.open(); d.write(docHtml); d.close();
        setTimeout(() => {
          w.focus(); w.print();
          const cleanup = () => { try { document.body.removeChild(iframe); } catch {} };
          w.addEventListener('afterprint', cleanup, { once: true });
          setTimeout(cleanup, 1500);
        }, 300);
      } catch (err) {
        console.error('Print failed:', err);
        try { document.body.removeChild(iframe); } catch {}
        alert('Printing failed. Please try again.');
      }
    };
    if (iframe.contentWindow?.document?.readyState === 'complete') onFrameLoad();
    else iframe.onload = onFrameLoad;
  };

  /* --------------------------------
     CSV export uses rounded values
     -------------------------------- */
  const exportCsv = () => {
    const header = ['SKU','Item','UoM','Qty','Minimum','Purchase Price','GST %','Margin %','Unit Cost (GST)','Total Value (₹)','Locations'];
    const lines = sorted.map((r) => {
      return [
        r.sku,
        (r.name ?? '').replaceAll('"','""'),
        r.uom_code || '',
        String(r.stock_qty),
        r.low_stock_threshold != null ? String(r.low_stock_threshold) : '',
        String(r.purchase_price ?? r.unit_cost ?? 0),
        String(r.gst_percent ?? 0),
        String(r.margin_percent ?? 0),
        String(r.unitCostGst),
        String(r.total_value),
        (r.locations_text ?? '').replaceAll('"','""'),
      ].map(v => `"${v}"`).join(',');
    });
    const date = new Date().toISOString().slice(0,10);
    downloadCsv(`inventory_${date}.csv`, [header.join(','), ...lines]);
  };

  /* ========= RENDER ========= */
  return (
    <div className="space-y-4">
      <div className="card">
        {/* Filters / actions */}
        <div className="flex flex-wrap items-end gap-3 mb-3">
          <div className="text-lg font-semibold mr-auto">Inventory</div>

          <input className="input" placeholder="Search by SKU, Name, or Location…" value={search} onChange={(e) => setSearch(e.target.value)} />

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} />
            Low stock only
          </label>

          <div className="flex items-center gap-2">
            <select className="input" value={selectedLocation} onChange={(e) => setSelectedLocation(e.target.value)}>
              <option value="">All locations</option>
              {allLocations.map(loc => <option key={loc} value={loc}>{loc}</option>)}
            </select>

            <select className="input" value={locationScope} onChange={(e) => setLocationScope(e.target.value as LocationScope)}>
              <option value="all_items">Scope: All items</option>
              <option value="has_stock">Scope: Items with stock at location</option>
              <option value="appears_any">Scope: Items that appear at location</option>
            </select>

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={showZeroQtyLocations} onChange={(e) => setShowZeroQtyLocations(e.target.checked)} />
              Show zero-qty
            </label>
          </div>

          <Button type="button" onClick={exportCsv}>Export CSV</Button>
          <Button type="button" onClick={loadInventory}>Refresh</Button>
          <Link href="/estimate/new" className="rounded border px-3 py-2 hover:bg-neutral-50">Estimate</Link>
        </div>

        {/* Thermal labels controls */}
        <div className="mb-4 border rounded p-3 bg-white">
          <div className="flex flex-wrap items-end gap-2">
            <div className="font-semibold">Thermal 2×1 Labels (50.8 mm × 25.4 mm)</div>
            <Button type="button" onClick={() => {
              setSel(prev => {
                const next: Sel = { ...prev };
                for (const r of sorted) if ((r.stock_qty ?? 0) > 0 && r.sku) next[r.id] = { checked: true, qty: next[r.id]?.qty ?? 1 };
                return next;
              });
            }}>Select all (stock &gt; 0)</Button>
            <Button type="button" className="bg-gray-700 hover:bg-gray-800" onClick={() => setSel({})}>Clear selection</Button>

            <div className="ml-auto flex items-end gap-2">
              <div className="flex flex-col">
                <label className="label text-xs">Labels per selected</label>
                <input
                  className="input w-24"
                  type="number"
                  min={1}
                  max={500}
                  value={bulkQtyState}
                  onChange={(e) => setBulkQtyInput(parseInt(e.target.value || '1', 10))}
                />
              </div>
              <Button type="button" onClick={() => {
                setSel(prev => {
                  const next: Sel = { ...prev };
                  for (const r of sorted) if (next[r.id]?.checked) next[r.id] = { checked: true, qty: bulkQtyState };
                  return next;
                });
              }}>Apply to selected</Button>
              <Button type="button" className="bg-gray-700 hover:bg-gray-800" onClick={handlePrintThermal}>Print Thermal 2×1</Button>
            </div>
          </div>

          {/* Preview grid (renders selected labels) */}
          <div className="mt-3">
            <div
              ref={previewRef}
              className="grid gap-2"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}
            >
              {Object.entries(sel).flatMap(([id, s]) => {
                if (!s?.checked) return [];
                const row = sorted.find(r => r.id === id);
                if (!row) return [];
                return Array.from({ length: Math.max(1, Math.min(500, Math.floor(s.qty || 1))) }).map((_, i) => (
                  <ThermalLabel2x1
                    key={`${row.id}-${i}`}
                    brand={brandName}
                    name={row.name || row.sku}
                    sku={row.sku}
                    uom={row.uom_code}
                  />
                ));
              })}
            </div>
          </div>
        </div>

        {/* Inventory table with alignment + delete + estimate */}
        <div className="table-scroll">
          <table className="inventory-table">
            {/* Exact widths per column */}
            <colgroup>
              <col style={{ width: 90  }} />   {/* Select */}
              <col style={{ width: 120 }} />   {/* SKU */}
              <col style={{ width: 220 }} />   {/* Item */}
              <col style={{ width: 80  }} />   {/* UoM */}
              <col style={{ width: 90  }} />   {/* Qty */}
              <col style={{ width: 110 }} />   {/* Minimum */}
              <col style={{ width: 120 }} />   {/* Purchase */}
              <col style={{ width: 90  }} />   {/* GST % */}
              <col style={{ width: 90  }} />   {/* Margin % */}
              <col style={{ width: 140 }} />   {/* Unit Cost (GST) */}
              <col style={{ width: 160 }} />   {/* Total Value (₹) */}
              <col style={{ width: 140 }} />   {/* Actions */}
              <col style={{ width: 360 }} />   {/* Locations */}
            </colgroup>

            <thead className="sticky-head">
              <tr>
                <th>Select</th>
                <th><SortHeader label="SKU" active={sortKey==='sku'} dir={sortDir} onClick={() => toggleSort('sku')} /></th>
                <th><SortHeader label="Item" active={sortKey==='name'} dir={sortDir} onClick={() => toggleSort('name')} /></th>
                <th><SortHeader label="UoM" active={sortKey==='uom_code'} dir={sortDir} onClick={() => toggleSort('uom_code')} /></th>
                <th className="num"><SortHeader label="Qty" active={sortKey==='stock_qty'} dir={sortDir} onClick={() => toggleSort('stock_qty')} alignRight /></th>
                <th className="num"><SortHeader label="Minimum" active={sortKey==='low_stock_threshold'} dir={sortDir} onClick={() => toggleSort('low_stock_threshold')} alignRight /></th>

                <th className="num">Purchase</th>
                <th className="num">GST %</th>
                <th className="num">Margin %</th>
                <th className="num">Unit Cost (GST)</th>
                <th className="num"><SortHeader label="Total Value (₹)" active={sortKey==='total_value'} dir={sortDir} onClick={() => toggleSort('total_value')} alignRight /></th>
                <th>Actions</th>
                <th><SortHeader label="Locations" active={sortKey==='locations_text'} dir={sortDir} onClick={() => toggleSort('locations_text')} /></th>
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr><td colSpan={13} className="py-6 text-center">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={13} className="py-6 text-center">No items found.</td></tr>
              ) : (
                sorted.map((r) => {
                  const s = sel[r.id] || { checked: false, qty: 1 };
                  const isLow =
                    r.low_stock_threshold != null &&
                    r.low_stock_threshold > 0 &&
                    r.stock_qty <= r.low_stock_threshold;

                  return (
                    <tr key={r.id} className={isLow ? 'bg-red-50' : ''}>
                      <td>
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={s.checked}
                            onChange={(e) => setSel(prev => ({ ...prev, [r.id]: { checked: e.target.checked, qty: prev[r.id]?.qty ?? 1 } }))}
                            title="Select"
                          />
                          <input
                            className="input w-16"
                            type="number"
                            min={1}
                            max={500}
                            value={s.qty}
                            onChange={(e) => setSel(prev => ({ ...prev, [r.id]: { checked: prev[r.id]?.checked ?? false, qty: Math.max(1, Math.floor(parseInt(e.target.value || '1', 10))) } }))}
                            title="Labels for this item"
                          />
                        </div>
                      </td>
                      <td>{r.sku}</td>
                      <td className="truncate-cell">{r.name}</td>
                      <td>{r.uom_code || '-'}</td>
                      <td className="num">{r.stock_qty}</td>
                      <td className="num">{r.low_stock_threshold != null ? r.low_stock_threshold : '—'}</td>

                      {/* Pricing cells */}
                      <td className="num">{INR0.format(Number(r.purchase_price ?? r.unit_cost ?? 0))}</td>
                      <td className="num">{Number(r.gst_percent ?? 0).toFixed(2)}%</td>
                      <td className="num">{Number(r.margin_percent ?? 0).toFixed(2)}%</td>
                      <td className="num">{INR0.format(r.unitCostGst)}</td>
                      <td className="num">{INR0.format(r.total_value)}</td>

                      <td>
                        <div className="flex gap-2">
                          <Link
                            href={`/estimate/new?sku=${encodeURIComponent(r.sku)}&qty=1`}
                            className="rounded bg-emerald-600 text-white px-2 py-1 text-sm hover:bg-emerald-700"
                          >
                            Estimate
                          </Link>
                          <button
                            className="rounded bg-red-600 text-white px-2 py-1 text-sm hover:bg-red-700"
                            onClick={() => deleteRow(r)}
                            title="Delete item"
                          >
                            Delete
                          </button>
                        </div>
                      </td>

                      <td>
                        {r.locations.length === 0 ? '—' : (
                          <div className="flex flex-wrap gap-1">
                            {r.locations.map(l => (
                              <span key={l.name} className="inline-flex items-center px-2 py-0.5 rounded bg-gray-100 text-xs text-gray-800">
                                {l.name}: {l.qty}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>

            <tfoot>
              <tr className="font-semibold">
                <td colSpan={4} className="text-right">Totals:</td>
                <td className="num">{totals.qty}</td>
                <td className="num">—</td>
                <td className="num">—</td>
                <td className="num">—</td>
                <td className="num">—</td>
                <td className="num">—</td>
                <td className="num">{INR0.format(totals.value)}</td>
                <td>—</td>
                <td>—</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
