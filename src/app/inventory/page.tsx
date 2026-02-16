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

interface MoveRow {
  created_at: string;
  move_type: string;
  qty: number;
  ref: string | null;
  uom_code: string | null;
  unit_cost: number | null;
  total_cost: number | null;
  item: { sku: string; name: string } | null;
}

// ---------- Helpers ----------
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// Simple CSV download
function downloadCsv(filename: string, rows: string[]) {
  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function InventoryPage() {
  // ===============================
  // INVENTORY (main section)
  // ===============================
  const [invLoading, setInvLoading] = useState<boolean>(true);
  const [invRows, setInvRows] = useState<InvRow[]>([]);
  const [invSearch, setInvSearch] = useState<string>('');
  const [invLowOnly, setInvLowOnly] = useState<boolean>(false);

  // Load inventory
  const loadInventory = async () => {
    try {
      setInvLoading(true);

      // 1) Items with UoM id
      const { data: itemsData, error: itemsErr } = await supabase
        .from('items')
        .select('id, sku, name, stock_qty, unit_cost, low_stock_threshold, uom_id')
        .order('sku', { ascending: true });

      if (itemsErr) throw itemsErr;

      // 2) UoM map
      const { data: uomData } = await supabase
        .from('units_of_measure')
        .select('id, code');

      const uomMap = new Map<string, string>();
      (uomData ?? []).forEach((u: any) => uomMap.set(u.id, u.code));

      // 3) Build rows
      const rows: InvRow[] = (itemsData ?? []).map((it: any) => ({
        id: it.id,
        sku: it.sku,
        name: it.name,
        stock_qty: Number(it.stock_qty ?? 0),
        unit_cost: Number(it.unit_cost ?? 0),
        low_stock_threshold: it.low_stock_threshold ?? null,
        uom_code: it.uom_id ? (uomMap.get(it.uom_id) ?? '') : '',
      }));

      setInvRows(rows);
    } catch (e) {
      console.error(e);
      setInvRows([]);
    } finally {
      setInvLoading(false);
    }
  };

  useEffect(() => {
    loadInventory();
    loadMoves();
  }, []);

  // Inventory filters & totals
  const invFiltered = useMemo(() => {
    const term = invSearch.trim().toLowerCase();
    return invRows.filter((r) => {
      const match =
        !term ||
        r.sku.toLowerCase().includes(term) ||
        (r.name ?? '').toLowerCase().includes(term);
      const isLow =
        r.low_stock_threshold != null &&
        r.low_stock_threshold > 0 &&
        r.stock_qty <= r.low_stock_threshold;
      return match && (!invLowOnly || isLow);
    });
  }, [invRows, invSearch, invLowOnly]);

  const invTotals = useMemo(() => {
    let qty = 0;
    let value = 0;
    for (const r of invFiltered) {
      qty += r.stock_qty;
      value += r.stock_qty * r.unit_cost;
    }
    return { qty: round2(qty), value: round2(value) };
  }, [invFiltered]);

  const exportInventoryCsv = () => {
    const header = ['SKU','Item','UoM','Qty','Minimum','Avg Unit Cost','Total Value'];
    const lines = invFiltered.map((r) => {
      const total = r.stock_qty * r.unit_cost;
      return [
        r.sku,
        (r.name ?? '').replaceAll('"','""'),
        r.uom_code || '',
        String(r.stock_qty),
        r.low_stock_threshold != null ? String(r.low_stock_threshold) : '',
        r.unit_cost.toFixed(2),
        total.toFixed(2)
      ].map(v => `"${v}"`).join(',');
    });
    const date = new Date().toISOString().slice(0,10);
    downloadCsv(`inventory_${date}.csv`, [header.join(','), ...lines]);
  };

  // ===============================
  // RECENT STOCK MOVEMENTS (below)
  // ===============================
  const [moves, setMoves] = useState<MoveRow[]>([]);
  const [movesLoading, setMovesLoading] = useState<boolean>(false);
  const [movesSearch, setMovesSearch] = useState<string>(''); // quick search (SKU/Item/Ref/Type)
  const [movesLimit, setMovesLimit] = useState<number>(100);

  const loadMoves = async () => {
    try {
      setMovesLoading(true);
      const { data, error } = await supabase
        .from('stock_moves')
        .select('created_at, move_type, qty, ref, uom_code, unit_cost, total_cost, item:items ( sku, name )')
        .order('created_at', { ascending: false })
        .limit(movesLimit);

      if (error) throw error;

      const rows: MoveRow[] = (data ?? []).map((r: any) => ({
        created_at: r.created_at,
        move_type: r.move_type,
        qty: Number(r.qty ?? 0),
        ref: r.ref ?? null,
        uom_code: r.uom_code ?? null,
        unit_cost: r.unit_cost ?? null,
        total_cost: r.total_cost ?? null,
        item: Array.isArray(r.item) ? (r.item[0] ?? null) : r.item ?? null,
      }));

      setMoves(rows);
    } catch (e) {
      console.error(e);
      setMoves([]);
    } finally {
      setMovesLoading(false);
    }
  };

  // Quick filter for movements list
  const movesFiltered = useMemo(() => {
    const t = movesSearch.trim().toLowerCase();
    if (!t) return moves;
    return moves.filter((m) => {
      const sku = m.item?.sku?.toLowerCase() ?? '';
      const nm  = m.item?.name?.toLowerCase() ?? '';
      const ty  = m.move_type?.toLowerCase() ?? '';
      const rf  = m.ref?.toLowerCase() ?? '';
      return sku.includes(t) || nm.includes(t) || ty.includes(t) || rf.includes(t);
    });
  }, [moves, movesSearch]);

  const exportMovesCsv = () => {
    const header = ['Date','SKU','Item','Type','Qty','UoM','Unit Cost','Total Cost','Ref'];
    const rows = movesFiltered.map(m => [
      new Date(m.created_at).toLocaleString().replaceAll('"','""'),
      (m.item?.sku ?? '').replaceAll('"','""'),
      (m.item?.name ?? '').replaceAll('"','""'),
      (m.move_type ?? '').replaceAll('"','""'),
      String(m.qty),
      m.uom_code || '',
      m.unit_cost != null ? m.unit_cost.toFixed(2) : '',
      m.total_cost != null ? m.total_cost.toFixed(2) : '',
      (m.ref ?? '').replaceAll('"','""'),
    ].map(v => `"${v}"`).join(','));
    const date = new Date().toISOString().slice(0,10);
    downloadCsv(`stock_movements_${date}.csv`, [header.join(','), ...rows]);
  };

  return (
    <div className="space-y-6">
      {/* ==================== INVENTORY ==================== */}
      <div className="card">
        <div className="flex flex-wrap items-end gap-3 mb-3">
          <div className="text-lg font-semibold mr-auto">Inventory</div>
          <input
            className="input"
            placeholder="Search inventory by SKU or Name…"
            value={invSearch}
            onChange={(e) => setInvSearch(e.target.value)}
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={invLowOnly}
              onChange={(e) => setInvLowOnly(e.target.checked)}
            />
            Low stock only
          </label>
          <Button type="button" onClick={exportInventoryCsv}>Export CSV</Button>
          <Button type="button" onClick={loadInventory}>Refresh</Button>
        </div>

        {invLoading ? (
          <p>Loading inventory…</p>
        ) : invRows.length === 0 ? (
          <div className="p-3 text-sm text-gray-700">No items found. Add items or refresh.</div>
        ) : (
          <div className="overflow-auto">
            <table className="table w-full">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Item</th>
                  <th>UoM</th>
                  <th className="text-right">Qty</th>
                  <th className="text-right">Minimum</th>
                  <th className="text-right">Avg Unit Cost</th>
                  <th className="text-right">Total Value (₹)</th>
                </tr>
              </thead>
              <tbody>
                {invFiltered.map((r) => {
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
                      <td className="text-right">{r.stock_qty}</td>
                      <td className="text-right">
                        {r.low_stock_threshold != null ? r.low_stock_threshold : '—'}
                      </td>
                      <td className="text-right">₹ {r.unit_cost.toFixed(2)}</td>
                      <td className="text-right">₹ {total.toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="font-semibold">
                  <td colSpan={3} className="text-right">Totals:</td>
                  <td className="text-right">{invTotals.qty}</td>
                  <td className="text-right">—</td>
                  <td className="text-right">—</td>
                  <td className="text-right">₹ {invTotals.value.toFixed(2)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* ==================== RECENT STOCK MOVEMENTS ==================== */}
      <div className="card">
        <div className="flex flex-wrap items-end gap-3 mb-3">
          <div className="text-lg font-semibold mr-auto">Recent Stock Movements</div>

          {/* Quick search/filter for movements (SKU / Item / Type / Ref) */}
          <input
            className="input"
            placeholder="Search movements (SKU / Item / Type / Ref)…"
            value={movesSearch}
            onChange={(e) => setMovesSearch(e.target.value)}
          />

          {/* Limit selector */}
          <select
            className="input"
            value={movesLimit}
            onChange={(e) => setMovesLimit(parseInt(e.target.value || '100', 10))}
          >
            <option value={50}>Last 50</option>
            <option value={100}>Last 100</option>
            <option value={200}>Last 200</option>
            <option value={500}>Last 500</option>
          </select>

          <Button type="button" onClick={exportMovesCsv}>Download CSV</Button>
          <Button type="button" onClick={loadMoves}>Refresh</Button>
        </div>

        {movesLoading ? (
          <p>Loading stock movements…</p>
        ) : moves.length === 0 ? (
          <div className="p-3 text-sm text-gray-700">No movements yet.</div>
        ) : (
          <div className="overflow-auto">
            <table className="table w-full">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Item</th>
                  <th>Type</th>
                  <th className="text-right">Qty</th>
                  <th>UoM</th>
                  <th className="text-right">Unit Cost</th>
                  <th className="text-right">Total Cost</th>
                  <th>Ref</th>
                </tr>
              </thead>
              <tbody>
                {movesFiltered.map((h, idx) => (
                  <tr key={`${h.created_at}-${idx}`}>
                    <td>{new Date(h.created_at).toLocaleString()}</td>
                    <td>{h.item?.sku} — {h.item?.name}</td>
                    <td className="capitalize">{h.move_type}</td>
                    <td className="text-right">{h.qty}</td>
                    <td>{h.uom_code || '-'}</td>
                    <td className="text-right">{h.unit_cost != null ? `₹ ${Number(h.unit_cost).toFixed(2)}` : '-'}</td>
                    <td className="text-right">{h.total_cost != null ? `₹ ${Number(h.total_cost).toFixed(2)}` : '-'}</td>
                    <td>{h.ref || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
