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

type SortKey = 'sku' | 'name' | 'uom_code' | 'stock_qty' | 'low_stock_threshold' | 'unit_cost' | 'total_value';

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

export default function InventoryPage() {
  const [loading, setLoading] = useState<boolean>(true);
  const [rows, setRows] = useState<InvRow[]>([]);
  const [search, setSearch] = useState<string>('');
  const [lowOnly, setLowOnly] = useState<boolean>(false);

  const [sortKey, setSortKey] = useState<SortKey>('sku');
  const [sortDir, setSortDir] = useState<'asc'|'desc'>('asc');

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

      const { data: itemsData, error: itemsErr } = await supabase
        .from('items')
        .select('id, sku, name, stock_qty, unit_cost, low_stock_threshold, uom_id')
        .order('sku', { ascending: true });

      if (itemsErr) throw itemsErr;

      const { data: uoms } = await supabase
        .from('units_of_measure')
        .select('id, code');

      const uomMap = new Map<string, string>();
      (uoms ?? []).forEach((u: any) => uomMap.set(u.id, u.code));

      const mapped: InvRow[] = (itemsData ?? []).map((it: any) => ({
        id: it.id,
        sku: it.sku,
        name: it.name,
        stock_qty: Number(it.stock_qty ?? 0),
        unit_cost: Number(it.unit_cost ?? 0),
        low_stock_threshold: it.low_stock_threshold ?? null,
        uom_code: it.uom_id ? (uomMap.get(it.uom_id) ?? '') : '',
      }));

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

  const filtered = useMemo(() => {
    const t = search.trim().toLowerCase();
    return rows.filter((r) => {
      const match =
        !t ||
        r.sku.toLowerCase().includes(t) ||
        (r.name ?? '').toLowerCase().includes(t);
      const isLow =
        r.low_stock_threshold != null &&
        r.low_stock_threshold > 0 &&
        r.stock_qty <= r.low_stock_threshold;
      return match && (!lowOnly || isLow);
    });
  }, [rows, search, lowOnly]);

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
    const header = ['SKU','Item','UoM','Qty','Minimum','Avg Unit Cost','Total Value'];
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

          <input
            className="input"
            placeholder="Search by SKU or Name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={lowOnly}
              onChange={(e) => setLowOnly(e.target.checked)}
            />
            Low stock only
          </label>

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
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
