'use client';

import React, { useEffect, useMemo, useState } from 'react';
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
