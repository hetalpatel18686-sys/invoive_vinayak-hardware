'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import Button from '@/components/Button';

type MoveType = 'receive' | 'adjust' | 'issue' | 'return';

interface FoundItem {
  id: string;
  sku: string;
  name: string | null;
  description?: string | null;
  stock_qty?: number;
  unit_cost?: number;
  uom_code?: string;
  low_stock_threshold?: number | null;
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

interface InvRow {
  id: string;
  sku: string;
  name: string;
  stock_qty: number;
  unit_cost: number;
  uom_code: string;
  low_stock_threshold: number | null;
}

interface UomRow {
  id: string;
  code: string;
  name: string;
}

/** ---------- Types to safely read `uom.code` ---------- */
type Uom = { code?: string; name?: string };
type UomField = Uom | Uom[] | null | undefined;

function getUomCode(u: UomField): string {
  if (Array.isArray(u)) return u[0]?.code ?? '';
  return u?.code ?? '';
}

export default function Stock() {
  // --- Left panel: fast entry
  const [sku, setSku] = useState<string>('');
  const [found, setFound] = useState<FoundItem | null>(null);

  const [moveType, setMoveType] = useState<MoveType>('receive');
  const [qty, setQty] = useState<number>(0);            // adjust: can be negative
  const [unitCost, setUnitCost] = useState<number>(0);  // purchase cost (receive)
  const [ref, setRef] = useState<string>('');
  const [reason, setReason] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);

  // Minimum (low-stock threshold) editor for found item
  const [minQty, setMinQty] = useState<number>(0);
  const [savingMin, setSavingMin] = useState<boolean>(false);

  // --- Right panel: tabs
  const [activeTab, setActiveTab] = useState<'moves' | 'inventory'>('moves');

  // Movements
  const [history, setHistory] = useState<MoveRow[]>([]);
  // Inventory
  const [invRows, setInvRows] = useState<InvRow[]>([]);
  const [invLoading, setInvLoading] = useState<boolean>(true);
  const [invSearch, setInvSearch] = useState<string>('');
  const [invLowOnly, setInvLowOnly] = useState<boolean>(false);

  // Extra guard to prevent double-submit (in addition to `loading`)
  const submittingRef = useRef(false);

  useEffect(() => {
    loadHistory();
    loadInventory();
  }, []);

  /* ---------- Loads ---------- */

  const loadHistory = async () => {
    const h = await supabase
      .from('stock_moves')
      .select('created_at, move_type, qty, ref, uom_code, unit_cost, total_cost, item:items ( name, sku )')
      .order('created_at', { ascending: false })
      .limit(50);

    const rows: MoveRow[] =
      (h.data ?? []).map((r: any) => ({
        created_at: r.created_at,
        move_type: r.move_type,
        qty: Number(r.qty ?? 0),
        ref: r.ref ?? null,
        uom_code: r.uom_code ?? null,
        unit_cost: r.unit_cost ?? null,
        total_cost: r.total_cost ?? null,
        item: Array.isArray(r.item) ? (r.item[0] ?? null) : r.item ?? null,
      })) ?? [];

    setHistory(rows);
  };

  const loadInventory = async () => {
    setInvLoading(true);

    // Items (no join)
    const { data: itemsData, error: itemsErr } = await supabase
      .from('items')
      .select('id, sku, name, stock_qty, unit_cost, low_stock_threshold, uom_id')
      .order('sku', { ascending: true });

    if (itemsErr) {
      setInvRows([]);
      setInvLoading(false);
      return;
    }

    // UoMs → map
    const { data: uomData } = await supabase
      .from('units_of_measure')
      .select('id, code, name');

    const uomMap: Record<string, UomRow> = {};
    (uomData ?? []).forEach((u: any) => {
      uomMap[u.id] = { id: u.id, code: u.code, name: u.name };
    });

    const rows: InvRow[] = (itemsData ?? []).map((it: any) => {
      const u = it.uom_id ? uomMap[it.uom_id] ?? null : null;
      return {
        id: it.id,
        sku: it.sku,
        name: it.name,
        stock_qty: Number(it.stock_qty ?? 0),
        unit_cost: Number(it.unit_cost ?? 0),
        low_stock_threshold: it.low_stock_threshold ?? null,
        uom_code: u?.code ?? '',
      };
    });

    setInvRows(rows);
    setInvLoading(false);
  };

  /* ---------- Find by SKU (case insensitive) ---------- */
  const findBySku = async () => {
    setFound(null);
    const trimmed = sku.trim();
    if (!trimmed) return alert('Please enter SKU');

    // Case-insensitive EXACT match (no wildcards)
    const { data, error } = await supabase
      .from('items')
      .select('id, sku, name, description, stock_qty, unit_cost, low_stock_threshold, uom:units_of_measure ( code )')
      .ilike('sku', trimmed) // case-insensitive equality when no %
      .limit(1);

    if (error) return alert(error.message);
    const row: any = (data ?? [])[0];
    if (!row) return alert('No item found for this SKU');

    const uom_code = getUomCode(row.uom as UomField);

    setFound({
      id: row.id,
      sku: row.sku,
      name: row.name,
      description: row.description,
      stock_qty: Number(row.stock_qty ?? 0),
      unit_cost: Number(row.unit_cost ?? 0),
      uom_code,
      low_stock_threshold: row.low_stock_threshold ?? null,
    });

    setMinQty(Number(row.low_stock_threshold ?? 0));
    setQty(0);
    setUnitCost(0);
    setRef('');
    setReason('');
  };

  /* ---------- Preview helpers ---------- */

  const autoUnitCost = found?.unit_cost ?? 0;
  const costToUse = moveType === 'receive' ? unitCost : autoUnitCost;

  const qtyLabel =
    moveType === 'adjust'
      ? 'Adjust Qty (use negative for lost, positive for found)'
      : 'Qty';

  const preview = useMemo(() => {
    if (!found) return null;
    const q = Number(qty || 0);
    const unit = Number(costToUse || 0);
    const total = q * unit;

    if (moveType === 'receive' && q > 0) {
      const oldQty = Number(found.stock_qty || 0);
      const oldCost = Number(found.unit_cost || 0);
      const newQty = oldQty + q;
      const newAvg =
        newQty === 0 ? unit : ((oldQty * oldCost) + (q * unit)) / newQty;
      return { total, newAvg, oldQty, oldCost, newQty };
    }
    return { total };
  }, [found, qty, costToUse, moveType]);

  /* ---------- Submit ---------- */
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Double-submit guards
    if (loading) return;
    if (submittingRef.current) return;
    submittingRef.current = true;

    if (!found) {
      submittingRef.current = false;
      return alert('Please find an item by SKU first');
    }

    if (moveType === 'adjust') {
      if (!qty || qty === 0) {
        submittingRef.current = false;
        return alert('For adjust, delta cannot be 0');
      }
    } else {
      if (!qty || qty <= 0) {
        submittingRef.current = false;
        return alert('Quantity must be > 0');
      }
    }

    setLoading(true);
    try {
      if (moveType === 'receive') {
        if (unitCost < 0) {
          submittingRef.current = false;
          setLoading(false);
          return alert('Unit cost must be >= 0');
        }
        const { error } = await supabase.rpc('receive_stock_avg', {
          p_item_id: found.id,
          p_qty: qty,
          p_unit_cost: unitCost,
          p_uom_code: found.uom_code || null,
          p_ref: ref || null,
          p_reason: reason || null,
        });
        if (error) throw error;

      } else if (moveType === 'issue') {
        const { error } = await supabase.rpc('issue_stock', {
          p_item_id: found.id,
          p_qty: qty,
          p_ref: ref || null,
          p_reason: reason || null,
        });
        if (error) throw error;

      } else if (moveType === 'return') {
        const { error } = await supabase.rpc('return_stock', {
          p_item_id: found.id,
          p_qty: qty,
          p_ref: ref || null,
          p_reason: reason || null,
        });
        if (error) throw error;

      } else if (moveType === 'adjust') {
        const { error } = await supabase.rpc('adjust_stock_delta', {
          p_item_id: found.id,
          p_delta: qty,
          p_ref: ref || null,
          p_reason: reason || null,
        });
        if (error) throw error;
      }

      await findBySku();
      await loadHistory();
      await loadInventory();

      setQty(0);
      if (moveType === 'receive') setUnitCost(0);
      setRef('');
      setReason('');
      alert('Saved successfully.');
    } catch (err: any) {
      alert(err?.message || String(err));
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  };

  /* ---------- Save Minimum (Low-stock threshold) ---------- */
  const saveMinimum = async () => {
    if (!found) return;
    setSavingMin(true);
    try {
      const { error } = await supabase
        .from('items')
        .update({ low_stock_threshold: Number.isFinite(minQty) ? minQty : 0 })
        .eq('id', found.id);
      if (error) throw error;

      // keep UI in sync
      await findBySku();
      await loadInventory();
      alert('Minimum qty saved.');
    } catch (err: any) {
      alert(err?.message || String(err));
    } finally {
      setSavingMin(false);
    }
  };

  /* ---------- Inventory helpers ---------- */
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
    const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
    return { qty: round2(qty), value: round2(value) };
  }, [invFiltered]);

  const exportInvCsv = () => {
    const header = ['SKU','Item','UoM','Qty','Avg Unit Cost','Total Value','Minimum'];
    const lines = invFiltered.map((r) => {
      const total = r.stock_qty * r.unit_cost;
      return [
        r.sku,
        (r.name ?? '').replaceAll('"','""'),
        r.uom_code,
        String(r.stock_qty),
        r.unit_cost.toFixed(2),
        total.toFixed(2),
        r.low_stock_threshold != null ? String(r.low_stock_threshold) : ''
      ].map(v => `"${v}"`).join(',');
    });
    const csv = [header.join(','), ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const date = new Date().toISOString().slice(0,10);
    a.download = `inventory_${date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /* ---------- Render ---------- */
  return (
    <div className="grid md:grid-cols-3 gap-4">
      {/* LEFT: Entry form */}
      <div className="card">
        <h2 className="font-semibold mb-3">Receive / Adjust / Issue / Return</h2>

        <form onSubmit={submit} className="space-y-3">
          {/* SKU input + Find */}
          <div className="flex gap-2">
            <input
              className="input"
              placeholder="SKU (e.g., TEST-1)"
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  findBySku();
                }
              }}
            />
            <Button type="button" onClick={findBySku}>Find</Button>
          </div>

          {/* Item preview */}
          <div>
            <label className="label">Item</label>
            <input
              className="input"
              value={
                found
                  ? `${found.name ?? ''}${found.description ? ' — ' + found.description : ''}`
                  : ''
              }
              placeholder="(description will appear after Find)"
              readOnly
            />
            <div className="text-xs text-gray-600 mt-1">
              {found ? (
                <>
                  UoM: <b>{found.uom_code || '-'}</b> • Current Qty: <b>{found.stock_qty ?? 0}</b> •{' '}
                  Avg Cost: <b>₹ {(found.unit_cost ?? 0).toFixed(2)}</b>
                </>
              ) : (
