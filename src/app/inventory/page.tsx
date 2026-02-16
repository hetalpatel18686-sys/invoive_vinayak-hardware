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

/* ---------------- Helpers ---------------- */
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

/* ---------------- Page ---------------- */
export default function InventoryPage() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<InvRow[]>([]);
  const [search, setSearch] = useState('');
  const [lowOnly, setLowOnly] = useState(false);

  useEffect(() => { loadInventory(); }, []);

  const loadInventory = async () => {
    try {
      setLoading(true);

      // 1) Items
      const { data: itemsData, error: itemsErr } = await supabase
        .from('items')
        .select('id, sku, name, stock_qty, unit_cost, low_stock_threshold, uom_id')
        .order('sku', { ascending: true });

      if (itemsErr) throw itemsErr;

      // 2) UoM
      const { data: uomData } = await supabase
        .from('units_of_measure')
        .select('id, code');

      const uomMap = new Map<string, string>();
      (uomData ?? []).forEach((u: any) => uomMap.set(u.id, u.code));

      // Build
      const out: InvRow[] = (itemsData ?? []).map((it: any) => ({
        id: it.id,
        sku: it.sku,
        name: it.name,
        stock_qty: Number(it.stock_qty ?? 0),
        unit_cost: Number(it.unit_cost ?? 0),
        low_stock_threshold: it.low_stock_threshold ?? null,
        uom_code: it.uom_id ? (uomMap.get(it.uom_id) ?? '') : '',
      }));

      setRows(out);
    } catch (e) {
      console.error(e);
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  /* ----- Filters + totals ----- */
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter(r => {
      const match =
        !term ||
        r.sku.toLowerCase().includes(term) ||
        (r.name ?? '').toLowerCase().includes(term);
      const isLow =
        r.low_stock_threshold != null &&
        r.low_stock_threshold > 0 &&
        r.stock_qty <= r.low_stock_threshold;
      return match && (!lowOnly || isLow);
    });
  }, [rows, search, lowOnly]);

  const totals = useMemo(() => {
    let qty = 0;
    let value = 0;
    for (const r of filtered) {
      qty += r.stock_qty;
      value += r.stock_qty * r.unit_cost;
    }
    return { qty: round2(qty), value: round2(value) };
  }, [filtered]);

  /* ----- CSV ----- */
  const exportCsv = () => {
    const header = ['SKU','Item','UoM','Qty','Minimum','Avg Unit Cost','Total Value'];
    const lines = filtered.map(r => {
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
    <div className="card">
      {/* Controls */}
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

      {/* Table */}
      {loading ? (
        <p>Loading…</p>
      ) : rows.length === 0 ? (
        <div className="p-3 text-sm text-gray-700">No items found. Add items or refresh.</div>
      ) : (
        <div className="overflow-auto">
          <table className="table w-full" style={{ tableLayout: 'fixed' }}>
            {/* Lock column widths to keep Qty aligned & visible */}
            <colgroup>
              <col style={{ width: '16%' }} /> {/* SKU */}
              <col style={{ width: '28%' }} /> {/* Item */}
