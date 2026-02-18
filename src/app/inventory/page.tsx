'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import Button from '@/components/Button';

interface InvRow {
  id: string;
  sku: string;
  name: string;
  stock_qty: number;
  unit_cost: number;
  uom_code: string;
  low_stock_threshold: number | null;

  // per-location aggregates
  locations: { name: string; qty: number }[];
  locations_all: { name: string; qty: number }[];
  locations_text: string;
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

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function downloadCsv(filename: string, rows: string[]) {
  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function SortHeader({
  label, active, dir, onClick, alignRight = false, minWidth,
}: {
  label: string; active: boolean; dir: 'asc'|'desc';
  onClick: () => void; alignRight?: boolean; minWidth?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-1 ${alignRight ? 'justify-end' : 'justify-start'} font-semibold`}
      style={{ minWidth }}
      title={`Sort by ${label}`}
    >
      <span>{label}</span>
      <span className="text-xs opacity-70">{active ? (dir === 'asc' ? '▲' : '▼') : '↕'}</span>
    </button>
  );
}

/* ======================================================
   ⭐ JsBarcode loader with your Option C (static URL)
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
      f.onerror = () => reject(new Error('Failed to load JsBarcode from both static URL and CDN'));
      document.head.appendChild(f);
    };
    document.head.appendChild(s);
  });
  return (window as any).JsBarcode;
}

/* ----------------------------------------------
   ⭐ Small Barcode SVG renderer (no npm needed)
   ---------------------------------------------- */
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
          width: 1.4,            // set narrower bars to fit 2x1 labels
          height: 12,            // ~12mm barcode area inside 25.4mm height
          displayValue: true,
          fontSize: 8,
          textMargin: 0,
          margin: 0,
          lineColor: '#000',
          ...(options || {}),
        });
      } catch (e) {
        console.warn(e);
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

/* ----------------------------------------------
   ⭐ Thermal label (2×1 inch exact) template
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
  // Keep content tight for 50.8mm x 25.4mm
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
        border: '1px solid #ddd', // visible on-screen preview; printing ignores if needed
        borderRadius: '1mm',
        background: '#fff',
      }}
    >
      {/* top line */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        gap: '1mm',
      }}>
        <div style={{ fontSize: '8px', fontWeight: 700, lineHeight: '10px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '70%' }}>
          {brand || ''}
        </div>
        {uom ? <div style={{ fontSize: '8px', lineHeight: '10px' }}>UoM: {uom}</div> : null}
      </div>

      {/* item name */}
      <div style={{
        fontSize: '9px',
        lineHeight: '10px',
        fontWeight: 600,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}>
        {name}
      </div>

      {/* barcode */}
      <div style={{ width: '100%', flex: 1, display: 'flex', alignItems: 'center' }}>
        <BarcodeSvg value={sku} options={{ height: 12, width: 1.4, displayValue: true, fontSize: 8 }} />
      </div>
    </div>
  );
}

export default function InventoryPage() {
  const [loading, setLoading] = useState<boolean>(true);
  const [rows, setRows] = useState<InvRow[]>([]);
  const [search, setSearch] = useState<string>('');
  const [lowOnly, setLowOnly] = useState<boolean>(false);
  const [sortKey, setSortKey] = useState<SortKey>('sku');
  const [sortDir, setSortDir] = useState<'asc'|'desc'>('asc');

  // Location filter
  const [allLocations, setAllLocations] = useState<string[]>([]);
  const [selectedLocation, setSelectedLocation] = useState<string>('');
  const [locationScope, setLocationScope] = useState<LocationScope>('all_items');
  const [showZeroQtyLocations, setShowZeroQtyLocations] = useState<boolean>(false);

  // ⭐ Selections for multi-item labels
  type Sel = Record<string, { checked: boolean; qty: number }>;
  const [sel, setSel] = useState<Sel>({});
  const [bulkQty, setBulkQty] = useState<number>(1);

  // Brand for label top (optional env)
  const brandName = process.env.NEXT_PUBLIC_BRAND_NAME || 'Vinayak Hardware';

  // Preview mount
  const previewRef = useRef<HTMLDivElement | null>(null);

  const toggleSort = (k: SortKey) => {
    setSortKey(prev => {
      if (prev !== k) { setSortDir('asc'); return k; }
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
      return k;
    });
  };

  // Load inventory + locations
  const loadInventory = async () => {
    try {
      setLoading(true);
      const { data: itemsData, error: itemsErr } = await supabase
        .from('items')
        .select('id, sku, name, stock_qty, unit_cost, low_stock_threshold, uom_id')
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
        const locations_all = Array.from(locMap.entries())
          .map(([name, qty]) => ({ name, qty }))
          .sort((a, b) => a.name.localeCompare(b.name));
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
          locations_text: filteredLocs.length
            ? filteredLocs.map(l => `${l.name}: ${l.qty}`).join(' | ')
            : '',
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
        locations_text: displayLocs.length
          ? displayLocs.map(l => `${l.name}: ${l.qty}`).join(' | ')
          : '',
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

  const filtered = useMemo(() => {
    if (!selectedLocation || locationScope === 'all_items') return prefiltered;
    if (locationScope === 'has_stock') {
      return prefiltered.filter(r => {
        const loc = r.locations_all.find(l => l.name === selectedLocation);
        return !!loc && Number(loc.qty) > 0;
      });
    }
    return prefiltered.filter(r => r.locations_all.some(l => l.name === selectedLocation));
  }, [prefiltered, selectedLocation, locationScope]);

  const sorted = useMemo(() => {
    const cp = filtered.map(r => ({ ...r, total_value: r.stock_qty * r.unit_cost }));
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
      if (va > vb) return 1 * dir;
      return 0;
    });
    return cp as (InvRow & { total_value: number })[];
  }, [filtered, sortKey, sortDir]);

  const totals = useMemo(() => {
    let qty = 0; let value = 0;
    for (const r of sorted) { qty += r.stock_qty; value += r.stock_qty * r.unit_cost; }
    return { qty: round2(qty), value: round2(value) };
  }, [sorted]);

  const exportCsv = () => {
    const header = ['SKU','Item','UoM','Qty','Minimum','Avg Unit Cost','Total Value','Locations'];
    const lines = sorted.map((r) => {
      const total = r.stock_qty * r.unit_cost;
      return [
        r.sku,
        (r.name ?? '').replaceAll('"','""'),
        r.uom_code || '',
        String(r.stock_qty),
        r.low_stock_threshold != null ? String(r.low_stock_threshold) : '',
        r.unit_cost.toFixed(2),
        total.toFixed(2),
        (r.locations_text ?? '').replaceAll('"','""'),
      ].map(v => `"${v}"`).join(',');
    });
    const date = new Date().toISOString().slice(0,10);
    downloadCsv(`inventory_${date}.csv`, [header.join(','), ...lines]);
  };

  /* ------------------------------------------------
     ⭐ Selection helpers
     ------------------------------------------------ */
  const setRowChecked = (id: string, checked: boolean) => {
    setSel(prev => ({ ...prev, [id]: { checked, qty: prev[id]?.qty ?? 1 } }));
  };
  const setRowQty = (id: string, qty: number) => {
    setSel(prev => ({ ...prev, [id]: { checked: prev[id]?.checked ?? false, qty: Math.max(1, Math.floor(qty || 1)) } }));
  };
  const selectAllVisibleWithStock = () => {
    setSel(prev => {
      const next: Sel = { ...prev };
      for (const r of sorted) {
        if ((r.stock_qty ?? 0) > 0 && r.sku) {
          next[r.id] = { checked: true, qty: next[r.id]?.qty ?? 1 };
        }
      }
      return next;
    });
  };
  const clearSelection = () => setSel({});

  const applyBulkQty = () => {
    setSel(prev => {
      const next: Sel = { ...prev };
      for (const r of sorted) {
        if (next[r.id]?.checked) next[r.id] = { checked: true, qty: Math.max(1, Math.floor(bulkQty || 1)) };
      }
      return next;
    });
  };

  /* ------------------------------------------------
     ⭐ Build preview: labels for all selected items
     ------------------------------------------------ */
  const selectedItems = useMemo(() => {
    const arr: { row: InvRow; qty: number }[] = [];
    for (const r of sorted) {
      const s = sel[r.id];
      if (s?.checked && r.sku) {
        arr.push({ row: r, qty: Math.max(1, Math.min(500, Math.floor(s.qty || 1))) });
      }
    }
    return arr;
  }, [sorted, sel]);

  /* ------------------------------------------------
     ⭐ Print Thermal 2×1 (each label = one page)
     ------------------------------------------------ */
  const handlePrintThermal = () => {
    const count = selectedItems.reduce((sum, it) => sum + it.qty, 0);
    if (count === 0) return alert('Please select items and set label quantities.');

    // Ensure labels are rendered in preview (JsBarcode applied)
    const html = previewRef.current?.innerHTML || '';
    if (!html) return alert('Please click "Preview Labels" first.');

    const w = window.open('', '_blank', 'noopener,noreferrer,width=900,height=700');
    if (!w) return alert('Please allow pop-ups to print labels.');

    const styles = `
      <style>
        @page {
          size: 50.8mm 25.4mm;  /* exact 2×1 inches */
          margin: 0;            /* no margin for thermal */
        }
        html, body { margin: 0; padding: 0; }
        /* Every .sheet will be one label (page) */
        .sheet {
          width: 50.8mm;
          height: 25.4mm;
          page-break-after: always;
        }
        /* Copy of sizing from preview to keep consistency */
        .thermal-label-2x1 { width: 50.8mm; height: 25.4mm; padding: 1.5mm; box-sizing: border-box; }
        /* Remove preview borders in print if you prefer clean edges */
        .thermal-label-2x1 { border: none !important; }
      </style>
    `;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Thermal 2x1 Labels</title>${styles}</head><body>`);
    // Wrap each label in a .sheet so it becomes one printed page on roll
    const wrapper = document.createElement('div');
    wrapper.innerHTML = html;
    const labels = Array.from(wrapper.children);
    labels.forEach(el => {
      w.document.write(`<div class="sheet">${(el as HTMLElement).outerHTML}</div>`);
    });
    w.document.write(`</body></html>`);
    w.document.close();
    w.focus();
    // Give the browser a tick to paint SVGs before printing
    setTimeout(() => w.print(), 200);
  };

  return (
    <div className="space-y-4">
      <div className="card">
        {/* Top controls */}
        <div className="flex flex-wrap items-end gap-3 mb-3">
          <div className="text-lg font-semibold mr-auto">Inventory</div>

          <input
            className="input"
            placeholder="Search by SKU, Name, or Location…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} />
            Low stock only
          </label>

          <div className="flex items-center gap-2">
            <select className="input" value={selectedLocation} onChange={(e) => setSelectedLocation(e.target.value)} title="Filter by location">
              <option value="">All locations</option>
              {allLocations.map(loc => <option key={loc} value={loc}>{loc}</option>)}
            </select>

            <select className="input" value={locationScope} onChange={(e) => setLocationScope(e.target.value as LocationScope)} title="Location scope">
              <option value="all_items">Scope: All items</option>
              <option value="has_stock">Scope: Items with stock at location</option>
              <option value="appears_any">Scope: Items that appear at location</option>
            </select>

            <label className="flex items-center gap-2 text-sm" title="Show zero-qty locations in the Locations column">
              <input type="checkbox" checked={showZeroQtyLocations} onChange={(e) => setShowZeroQtyLocations(e.target.checked)} />
              Show zero-qty
            </label>
          </div>

          <Button type="button" onClick={exportCsv}>Export CSV</Button>
          <Button type="button" onClick={loadInventory}>Refresh</Button>
        </div>

        {/* ⭐ Thermal 2×1 Multi-Item Label Controls */}
        <div className="mb-4 border rounded p-3 bg-white">
          <div className="flex flex-wrap items-end gap-2">
            <div className="font-semibold">Thermal 2×1 Labels (50.8 mm × 25.4 mm)</div>

            <Button type="button" onClick={selectAllVisibleWithStock}>Select all (stock &gt; 0)</Button>
            <Button type="button" className="bg-gray-700 hover:bg-gray-800" onClick={clearSelection}>Clear selection</Button>

            <div className="ml-auto flex items-end gap-2">
              <div className="flex flex-col">
                <label className="label text-xs">Labels per selected</label>
                <input
                  className="input w-24"
                  type="number"
                  min={1}
                  max={500}
                  value={bulkQty}
                  onChange={(e) => setBulkQty(Math.max(1, Math.min(500, parseInt(e.target.value || '1', 10))))}
                />
              </div>
              <Button type="button" onClick={applyBulkQty}>Apply to selected</Button>
              <Button
                type="button"
                onClick={() => {
                  // Preview is just rendering below; clicking ensures user explicitly triggers it.
                  if (selectedItems.length === 0) alert('Select items and set quantities first.');
                }}
              >
                Preview Labels
              </Button>
              <Button type="button" className="bg-gray-700 hover:bg-gray-800" onClick={handlePrintThermal}>
                Print Thermal 2×1
              </Button>
            </div>
          </div>

          {/* Preview grid: we render each label the number of times requested */}
          <div className="mt-3">
            {selectedItems.length === 0 ? (
              <div className="text-sm text-gray-600">Select items (or use “Select all (stock &gt; 0)”), set “Labels per selected”, then click “Preview Labels”.</div>
            ) : (
              <div
                ref={previewRef}
                className="grid gap-2"
                style={{
                  gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                }}
              >
                {selectedItems.flatMap(({ row, qty }) =>
                  Array.from({ length: qty }).map((_, i) => (
                    <ThermalLabel2x1
                      key={`${row.id}-${i}`}
                      brand={brandName}
                      name={row.name || row.sku}
                      sku={row.sku}
                      uom={row.uom_code}
                    />
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        {/* Inventory table with selection column */}
        {loading ? (
          <p>Loading…</p>
        ) : rows.length === 0 ? (
          <div className="p-3 text-sm text-gray-700">No items found. Add items or refresh.</div>
        ) : (
          <div className="overflow-auto">
            <table className="table w-full">
              <thead>
                <tr>
                  {/* ⭐ selection & qty columns */}
                  <th style={{ minWidth: 60 }}>Select</th>
                  <th style={{ minWidth: 110 }}>
                    <SortHeader label="SKU" active={sortKey==='sku'} dir={sortDir} onClick={() => toggleSort('sku')} minWidth={110} />
                  </th>
                  <th>
                    <SortHeader label="Item" active={sortKey==='name'} dir={sortDir} onClick={() => toggleSort('name')} minWidth={200} />
                  </th>
                  <th>
                    <SortHeader label="UoM" active={sortKey==='uom_code'} dir={sortDir} onClick={() => toggleSort('uom_code')} minWidth={60} />
                  </th>
                  <th className="text-right">
                    <SortHeader label="Qty" active={sortKey==='stock_qty'} dir={sortDir} onClick={() => toggleSort('stock_qty')} alignRight minWidth={80} />
                  </th>
                  <th className="text-right">
                    <SortHeader label="Minimum" active={sortKey==='low_stock_threshold'} dir={sortDir} onClick={() => toggleSort('low_stock_threshold')} alignRight minWidth={90} />
                  </th>
                  <th className="text-right">
                    <SortHeader label="Avg Unit Cost" active={sortKey==='unit_cost'} dir={sortDir} onClick={() => toggleSort('unit_cost')} alignRight minWidth={120} />
                  </th>
                  <th className="text-right">
                    <SortHeader label="Total Value (₹)" active={sortKey==='total_value'} dir={sortDir} onClick={() => toggleSort('total_value')} alignRight minWidth={140} />
                  </th>
                  <th>
                    <SortHeader label="Locations" active={sortKey==='locations_text'} dir={sortDir} onClick={() => toggleSort('locations_text')} minWidth={260} />
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => {
                  const total = r.stock_qty * r.unit_cost;
                  const isLow =
                    r.low_stock_threshold != null &&
                    r.low_stock_threshold > 0 &&
                    r.stock_qty <= r.low_stock_threshold;

                  const s = sel[r.id] || { checked: false, qty: 1 };

                  return (
                    <tr key={r.id} className={isLow ? 'bg-red-50' : ''}>
                      {/* selection & per-row label qty */}
                      <td>
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={s.checked}
                            onChange={(e) => setRowChecked(r.id, e.target.checked)}
                            title="Select for barcode printing"
                          />
                          <input
                            className="input w-16"
                            type="number"
                            min={1}
                            max={500}
                            value={s.qty}
                            onChange={(e) => setRowQty(r.id, parseInt(e.target.value || '1', 10))}
                            title="Labels for this item"
                          />
                        </div>
                      </td>

                      <td>{r.sku}</td>
                      <td>{r.name}</td>
                      <td>{r.uom_code || '-'}</td>
                      <td className="text-right" style={{ minWidth: 80, fontVariantNumeric: 'tabular-nums' }}>{r.stock_qty}</td>
                      <td className="text-right" style={{ minWidth: 90, fontVariantNumeric: 'tabular-nums' }}>
                        {r.low_stock_threshold != null ? r.low_stock_threshold : '—'}
                      </td>
                      <td className="text-right" style={{ minWidth: 120, fontVariantNumeric: 'tabular-nums' }}>
                        ₹ {r.unit_cost.toFixed(2)}
                      </td>
                      <td className="text-right" style={{ minWidth: 140, fontVariantNumeric: 'tabular-nums' }}>
                        ₹ {total.toFixed(2)}
                      </td>
                      <td style={{ minWidth: 260 }}>
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
                })}
              </tbody>
              <tfoot>
                <tr className="font-semibold">
                  <td colSpan={4} className="text-right">Totals:</td>
                  <td className="text-right" style={{ minWidth: 80, fontVariantNumeric: 'tabular-nums' }}>{totals.qty}</td>
                  <td className="text-right" style={{ minWidth: 90 }}>—</td>
                  <td className="text-right" style={{ minWidth: 120 }}>—</td>
                  <td className="text-right" style={{ minWidth: 140, fontVariantNumeric: 'tabular-nums' }}>₹ {totals.value.toFixed(2)}</td>
                  <td>—</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
