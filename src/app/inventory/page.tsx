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
  // original (unfiltered) per-location aggregates (for toggle behavior)
  locations_all: { name: string; qty: number }[];
  // flattened text for UI/CSV/search (for the currently applied zero-qty toggle)
  locations_text: string;
}

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

type SortKey =
  | 'sku'
  | 'name'
  | 'uom_code'
  | 'stock_qty'
  | 'low_stock_threshold'
  | 'unit_cost'
  | 'total_value'
  | 'locations_text';

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

type LocationScope = 'all_items' | 'has_stock' | 'appears_any'; 
// all_items: ignore location selection on filtering
// has_stock: only items with qty>0 at selected location
// appears_any: items that have any movement at selected location (qty can be 0 after net)

/* -------------------------------------------------------
   ⭐ Small barcode component (uses JsBarcode dynamically)
   ------------------------------------------------------- */
function BarcodeSvg({
  value,
  options,
  labelTop,
  labelBottom,
}: {
  value: string;
  options?: Partial<{
    format: string; width: number; height: number; displayValue: boolean;
    fontSize: number; textMargin: number; margin: number; lineColor: string;
  }>;
  labelTop?: string | null;
  labelBottom?: string | null;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!value || !svgRef.current) return;
      try {
        const mod: any = await import('jsbarcode');
        const JsBarcode = (mod && mod.default) ? mod.default : mod;
        if (!JsBarcode || cancelled) return;
        // Clear before render
        while (svgRef.current.firstChild) svgRef.current.removeChild(svgRef.current.firstChild);

        JsBarcode(svgRef.current, value, {
          format: 'CODE128',
          width: 2,
          height: 60,
          displayValue: true,
          fontSize: 12,
          textMargin: 2,
          margin: 6,
          lineColor: '#000',
          ...(options || {}),
        });
      } catch (e) {
        console.warn('JsBarcode not available. Run: npm i jsbarcode', e);
        if (!svgRef.current) return;
        // fallback simple text
        const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        txt.setAttribute('x', '0');
        txt.setAttribute('y', '14');
        txt.setAttribute('fill', '#000');
        txt.textContent = value;
        svgRef.current.appendChild(txt);
      }
    })();
    return () => { cancelled = true; };
  }, [value, options]);

  return (
    <div className="inline-flex flex-col items-center border rounded p-2 bg-white">
      {labelTop ? <div className="text-xs font-medium mb-1 text-gray-700">{labelTop}</div> : null}
      <svg ref={svgRef} className="max-w-full h-auto" />
      {labelBottom ? <div className="text-[10px] mt-1 text-gray-600">{labelBottom}</div> : null}
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

  // NEW: UI state for location filtering and display options
  const [allLocations, setAllLocations] = useState<string[]>([]);
  const [selectedLocation, setSelectedLocation] = useState<string>(''); // '' = no selection
  const [locationScope, setLocationScope] = useState<LocationScope>('all_items');
  const [showZeroQtyLocations, setShowZeroQtyLocations] = useState<boolean>(false);

  /* -------------------------
     ⭐ Barcode UI State
     ------------------------- */
  const [bcItemId, setBcItemId] = useState<string>('');           // selected item id
  const [bcQty, setBcQty] = useState<number>(1);                  // no. of labels
  const [bcOpts, setBcOpts] = useState({ width: 2, height: 60 }); // size controls
  const previewRef = useRef<HTMLDivElement | null>(null);

  const selectedItem = useMemo(() => rows.find(r => r.id === bcItemId) || null, [rows, bcItemId]);
  const previewCount = useMemo(() => Math.max(0, Math.min(500, Math.floor(bcQty || 0))), [bcQty]); // cap to 500 for safety

  function toggleSort(k: SortKey) {
    setSortKey(prev => {
      if (prev !== k) {
        setSortDir('asc');
        return k;
      }
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
      return k;
    });
  }

  const loadInventory = async () => {
    try {
      setLoading(true);

      // 1) Load base items
      const { data: itemsData, error: itemsErr } = await supabase
        .from('items')
        .select('id, sku, name, stock_qty, unit_cost, low_stock_threshold, uom_id')
        .order('sku', { ascending: true });

      if (itemsErr) throw itemsErr;

      // 2) Load UoMs for mapping
      const { data: uoms } = await supabase
        .from('units_of_measure')
        .select('id, code');

      const uomMap = new Map<string, string>();
      (uoms ?? []).forEach((u: any) => uomMap.set(u.id, u.code));

      // 3) Load stock_moves for per-location aggregation
      const { data: moves, error: movesErr } = await supabase
        .from('stock_moves')
        .select('item_id, move_type, qty, location');

      if (movesErr) throw movesErr;

      // Build: itemId -> (location -> qty)
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
        // adjust uses provided sign as-is

        if (!perItemLocMap.has(itemId)) perItemLocMap.set(itemId, new Map());
        const locMap = perItemLocMap.get(itemId)!;
        locMap.set(loc, (locMap.get(loc) ?? 0) + delta);

        // Collect the location names for the filter dropdown
        allLocSet.add(loc);
      });

      const allLocArr = Array.from(allLocSet.values()).sort((a, b) => a.localeCompare(b));
      setAllLocations(allLocArr);

      // 4) Map into rows
      const mapped: InvRow[] = (itemsData ?? []).map((it: any) => {
        const itemId = String(it.id);
        const locMap = perItemLocMap.get(itemId) ?? new Map<string, number>();

        // all locations (including zero qty)
        const locations_all = Array.from(locMap.entries())
          .map(([name, qty]) => ({ name, qty }))
          .sort((a, b) => a.name.localeCompare(b.name));

        // default visible locations (filtered by showZeroQtyLocations; we’ll re-apply later)
        const filteredLocs = locations_all.filter(l => l.qty !== 0);

        return {
          id: it.id,
          sku: it.sku,
          name: it.name,
          stock_qty: Number(it.stock_qty ?? 0),
          unit_cost: Number(it.unit_cost ?? 0),
          low_stock_threshold: it.low_stock_threshold ?? null,
          uom_code: it.uom_id ? (uomMap.get(it.uom_id) ?? '') : '',
          locations: filteredLocs,          // initial (will be replaced by memo below to reflect toggle)
          locations_all,                    // keep the full list
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

  useEffect(() => {
    loadInventory();
  }, []);

  // NEW: Apply "showZeroQtyLocations" toggle at display-time
  const rowsWithDisplayLocations = useMemo(() => {
    return rows.map(row => {
      const displayLocs = showZeroQtyLocations
        ? row.locations_all
        : row.locations_all.filter(l => l.qty !== 0);

      return {
        ...row,
        locations: displayLocs,
        locations_text: displayLocs.length
          ? displayLocs.map(l => `${l.name}: ${l.qty}`).join(' | ')
          : '',
      };
    });
  }, [rows, showZeroQtyLocations]);

  // Filter by search + lowOnly first
  const prefiltered = useMemo(() => {
    const t = search.trim().toLowerCase();
    return rowsWithDisplayLocations.filter((r) => {
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

  // NEW: Apply Location filter with scope
  const filtered = useMemo(() => {
    if (!selectedLocation || locationScope === 'all_items') return prefiltered;

    if (locationScope === 'has_stock') {
      // Keep items that have qty > 0 at the selected location
      return prefiltered.filter(r => {
        const loc = r.locations_all.find(l => l.name === selectedLocation);
        return !!loc && Number(loc.qty) > 0;
      });
    }

    // appears_any: Keep items that have this location in their map at all
    return prefiltered.filter(r => {
      const loc = r.locations_all.find(l => l.name === selectedLocation);
      return !!loc; // qty may be 0
    });
  }, [prefiltered, selectedLocation, locationScope]);

  const sorted = useMemo(() => {
    const cp = filtered.map(r => ({
      ...r,
      total_value: r.stock_qty * r.unit_cost,
    }));
    cp.sort((a: any, b: any) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      let va: any; let vb: any;

      switch (sortKey) {
        case 'sku':                 va = a.sku?.toLowerCase() ?? ''; vb = b.sku?.toLowerCase() ?? ''; break;
        case 'name':                va = a.name?.toLowerCase() ?? ''; vb = b.name?.toLowerCase() ?? ''; break;
        case 'uom_code':            va = a.uom_code?.toLowerCase() ?? ''; vb = b.uom_code?.toLowerCase() ?? ''; break;
        case 'stock_qty':           va = Number(a.stock_qty); vb = Number(b.stock_qty); break;
        case 'low_stock_threshold': va = Number(a.low_stock_threshold ?? -Infinity); vb = Number(b.low_stock_threshold ?? -Infinity); break;
        case 'unit_cost':           va = Number(a.unit_cost); vb = Number(b.unit_cost); break;
        case 'total_value':         va = Number(a.total_value); vb = Number(b.total_value); break;
        case 'locations_text':      va = (a.locations_text ?? '').toLowerCase(); vb = (b.locations_text ?? '').toLowerCase(); break;
        default:                    va = 0; vb = 0;
      }

      if (typeof va === 'number' && typeof vb === 'number') {
        return (va - vb) * dir;
      }
      if (va < vb) return -1 * dir;
      if (va > vb) return  1 * dir;
      return 0;
    });
    return cp as (InvRow & { total_value: number })[];
  }, [filtered, sortKey, sortDir]);

  const totals = useMemo(() => {
    let qty = 0;
    let value = 0;
    for (const r of sorted) {
      qty += r.stock_qty;
      value += r.stock_qty * r.unit_cost;
    }
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

  /* -------------------------
     ⭐ Print only barcodes
     ------------------------- */
  const handlePrintBarcodes = () => {
    if (!selectedItem) return alert('Please select an item for barcode labels.');
    const html = previewRef.current?.innerHTML || '';
    if (!html) return alert('Nothing to print. Please generate a preview first.');

    const w = window.open('', '_blank', 'noopener,noreferrer,width=800,height=600');
    if (!w) return alert('Please allow pop-ups to print barcodes.');
    const styles = `
      <style>
        @page { margin: 5mm; }
        body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 8px; }
        .label { display: inline-flex; flex-direction: column; align-items: center; border: 1px solid #ddd; border-radius: 6px; padding: 6px; }
        .label svg { width: 100%; height: auto; }
        .top { font-size: 11px; font-weight: 600; margin-bottom: 2px; }
        .bottom { font-size: 10px; color: #555; margin-top: 2px; }
        @media print { .noprint { display: none !important; } }
      </style>
    `;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Barcodes</title>${styles}</head><body>`);
    w.document.write(`<div class="grid">${html}</div>`);
    w.document.write(`<div class="noprint" style="margin-top:12px"><button onclick="window.print()">Print</button></div>`);
    w.document.write(`</body></html>`);
    w.document.close();
    w.focus();
  };

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="flex flex-wrap items-end gap-3 mb-3">
          <div className="text-lg font-semibold mr-auto">Inventory</div>

          {/* Search */}
          <input
            className="input"
            placeholder="Search by SKU, Name, or Location…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          {/* Low only */}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={lowOnly}
              onChange={(e) => setLowOnly(e.target.checked)}
            />
            Low stock only
          </label>

          {/* NEW: Location Filter controls */}
          <div className="flex items-center gap-2">
            <select
              className="input"
              value={selectedLocation}
              onChange={(e) => setSelectedLocation(e.target.value)}
              title="Filter by location"
            >
              <option value="">All locations</option>
              {allLocations.map((loc) => (
                <option key={loc} value={loc}>{loc}</option>
              ))}
            </select>

            <select
              className="input"
              value={locationScope}
              onChange={(e) => setLocationScope(e.target.value as LocationScope)}
              title="Location filter scope"
            >
              <option value="all_items">Scope: All items</option>
              <option value="has_stock">Scope: Items with stock at location</option>
              <option value="appears_any">Scope: Items that appear at location</option>
            </select>

            <label className="flex items-center gap-2 text-sm" title="Show zero-qty locations in the Locations column">
              <input
                type="checkbox"
                checked={showZeroQtyLocations}
                onChange={(e) => setShowZeroQtyLocations(e.target.checked)}
              />
              Show zero-qty
            </label>
          </div>

          <Button type="button" onClick={exportCsv}>Export CSV</Button>
          <Button type="button" onClick={loadInventory}>Refresh</Button>
        </div>

        {/* ------------------------------------------
            ⭐ BARCODE GENERATOR (header preview area)
           ------------------------------------------ */}
        <div className="mb-4 border rounded p-3 bg-white">
          <div className="flex flex-wrap items-end gap-3">
            <div className="font-semibold mr-2">Barcode Generator</div>

            {/* Item picker */}
            <div className="flex flex-col">
              <label className="label text-xs">Item</label>
              <select
                className="input min-w-[260px]"
                value={bcItemId}
                onChange={(e) => setBcItemId(e.target.value)}
                title="Select item to generate barcode"
              >
                <option value="">-- Choose Item --</option>
                {rows.map(r => (
                  <option key={r.id} value={r.id}>{r.sku} — {r.name}</option>
                ))}
              </select>
            </div>

            {/* Qty */}
            <div className="flex flex-col">
              <label className="label text-xs">Qty (labels)</label>
              <input
                className="input w-28"
                type="number"
                min={1}
                max={500}
                value={bcQty}
                onChange={(e) => setBcQty(parseInt(e.target.value || '1', 10))}
              />
            </div>

            {/* Size */}
            <div className="flex items-center gap-2">
              <div className="flex flex-col">
                <label className="label text-xs">Bar width</label>
                <input
                  className="input w-24"
                  type="number"
                  min={1}
                  max={4}
                  step={0.5}
                  value={bcOpts.width}
                  onChange={(e) => setBcOpts(o => ({ ...o, width: parseFloat(e.target.value || '2') }))}
                />
              </div>
              <div className="flex flex-col">
                <label className="label text-xs">Height</label>
                <input
                  className="input w-24"
                  type="number"
                  min={30}
                  max={120}
                  value={bcOpts.height}
                  onChange={(e) => setBcOpts(o => ({ ...o, height: parseInt(e.target.value || '60', 10) }))}
                />
              </div>
            </div>

            <div className="ml-auto flex gap-2">
              <Button
                type="button"
                onClick={() => {
                  if (!bcItemId) return alert('Select an item first.');
                  // preview is reactive; this button just ensures state is applied.
                }}
              >
                Generate Preview
              </Button>
              <Button type="button" className="bg-gray-700 hover:bg-gray-800" onClick={handlePrintBarcodes}>
                Print Barcodes
              </Button>
            </div>
          </div>

          {/* Preview grid */}
          <div className="mt-3">
            {!selectedItem ? (
              <div className="text-sm text-gray-600">Choose an item and quantity to preview barcodes.</div>
            ) : (
              <div ref={previewRef} className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                {Array.from({ length: previewCount }).map((_, idx) => (
                  <div key={idx} className="label inline-block">
                    <BarcodeSvg
                      value={selectedItem.sku}
                      options={{ format: 'CODE128', width: bcOpts.width, height: bcOpts.height, displayValue: true }}
                      labelTop={selectedItem.name}
                      labelBottom={selectedItem.uom_code ? `UoM: ${selectedItem.uom_code}` : ''}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {loading ? (
          <p>Loading…</p>
        ) : rows.length === 0 ? (
          <div className="p-3 text-sm text-gray-700">No items found. Add items or refresh.</div>
        ) : (
          <div className="overflow-auto">
            <table className="table w-full">
              <thead>
                <tr>
                  <th>
                    <SortHeader label="SKU" active={sortKey==='sku'} dir={sortDir} onClick={() => toggleSort('sku')} minWidth={120} />
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

                  return (
                    <tr key={r.id} className={isLow ? 'bg-red-50' : ''}>
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
                  <td colSpan={3} className="text-right">Totals:</td>
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
