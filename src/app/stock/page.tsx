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

/* ---------- Safe type helpers for UoM ---------- */
type Uom = { code?: string; name?: string };
type UomField = Uom | Uom[] | null | undefined;

function getUomCode(u: UomField): string {
  if (Array.isArray(u)) return u[0]?.code ?? '';
  return u?.code ?? '';
}

// Simple UUID fallback if crypto.randomUUID is unavailable
function makeClientTxId(): string {
  try {
    // @ts-ignore
    if (typeof crypto !== 'undefined' && crypto?.randomUUID) return crypto.randomUUID();
  } catch {}
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/* ---------- Small helpers ---------- */
function downloadCsv(filename: string, rows: string[]) {
  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

type MoveSortKey =
  | 'created_at'
  | 'sku'
  | 'name'
  | 'move_type'
  | 'qty'
  | 'uom_code'
  | 'unit_cost'
  | 'total_cost'
  | 'ref';

function SortHeader({
  label, active, dir, onClick, alignRight = false, minWidth,
}: {
  label: string;
  active: boolean;
  dir: 'asc' | 'desc';
  onClick: () => void;
  alignRight?: boolean;
  minWidth?: number;
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

export default function Stock() {
  // Left panel state
  const [sku, setSku] = useState<string>('');
  const [found, setFound] = useState<FoundItem | null>(null);
  const [moveType, setMoveType] = useState<MoveType>('receive');
  const [qty, setQty] = useState<number>(0);
  const [unitCost, setUnitCost] = useState<number>(0);
  const [ref, setRef] = useState<string>('');
  const [reason, setReason] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);

  // Min qty editor
  const [minQty, setMinQty] = useState<number>(0);
  const [savingMin, setSavingMin] = useState<boolean>(false);

  // Movements data + UX
  const [history, setHistory] = useState<MoveRow[]>([]);
  const [movesLoading, setMovesLoading] = useState<boolean>(false);
  const [movesSearch, setMovesSearch] = useState<string>(''); // quick search (SKU/Item/Type/Ref)
  const [movesLimit, setMovesLimit] = useState<number>(100);  // how many rows to load

  const [sortKey, setSortKey] = useState<MoveSortKey>('created_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  function toggleSort(k: MoveSortKey) {
    setSortKey(prev => {
      if (prev !== k) {
        setSortDir('asc');
        return k;
      }
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
      return k;
    });
  }

  // Extra double-submit guard
  const submittingRef = useRef(false);

  useEffect(() => {
    loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movesLimit]); // reload when limit changes

  // ---------- Loads ----------
  const loadHistory = async () => {
    try {
      setMovesLoading(true);
      const h = await supabase
        .from('stock_moves')
        .select(
          'created_at, move_type, qty, ref, uom_code, unit_cost, total_cost, item:items ( name, sku )'
        )
        .order('created_at', { ascending: false })
        .limit(movesLimit);

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
    } catch (e) {
      console.error(e);
      setHistory([]);
    } finally {
      setMovesLoading(false);
    }
  };

  // ---------- Find by SKU (case-insensitive exact) ----------
  const findBySku = async () => {
    setFound(null);
    const trimmed = sku.trim();
    if (!trimmed) return alert('Please enter SKU');

    const { data, error } = await supabase
      .from('items')
      .select(
        'id, sku, name, description, stock_qty, unit_cost, low_stock_threshold, uom:units_of_measure ( code )'
      )
      .ilike('sku', trimmed)
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

  // ---------- Preview helpers ----------
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

  // ---------- Submit ----------
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
      const clientTxId = makeClientTxId();

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
          p_client_tx_id: clientTxId,
        });
        if (error) throw error;

      } else if (moveType === 'issue') {
        const { error } = await supabase.rpc('issue_stock', {
          p_item_id: found.id,
          p_qty: qty,
          p_ref: ref || null,
          p_reason: reason || null,
          p_client_tx_id: clientTxId,
        });
        if (error) throw error;

      } else if (moveType === 'return') {
        const { error } = await supabase.rpc('return_stock', {
          p_item_id: found.id,
          p_qty: qty,
          p_ref: ref || null,
          p_reason: reason || null,
          p_client_tx_id: clientTxId,
        });
        if (error) throw error;

      } else if (moveType === 'adjust') {
        const { error } = await supabase.rpc('adjust_stock_delta', {
          p_item_id: found.id,
          p_delta: qty,
          p_ref: ref || null,
          p_reason: reason || null,
          p_client_tx_id: clientTxId,
        });
        if (error) throw error;
      }

      await findBySku();
      await loadHistory();

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

  // ---------- Save Minimum ----------
  const saveMinimum = async () => {
    if (!found) return;
    setSavingMin(true);
    try {
      const { error } = await supabase
        .from('items')
        .update({ low_stock_threshold: Number.isFinite(minQty) ? minQty : 0 })
        .eq('id', found.id);
      if (error) throw error;

      await findBySku();
      alert('Minimum qty saved.');
    } catch (err: any) {
      alert(err?.message || String(err));
    } finally {
      setSavingMin(false);
    }
  };

  /* ===== Movements: search → sort → render ===== */

  // 1) Filter by quick search
  const movesFiltered = useMemo(() => {
    const t = movesSearch.trim().toLowerCase();
    if (!t) return history;
    return history.filter((m) => {
      const sku = m.item?.sku?.toLowerCase() ?? '';
      const nm  = m.item?.name?.toLowerCase() ?? '';
      const ty  = m.move_type?.toLowerCase() ?? '';
      const rf  = m.ref?.toLowerCase() ?? '';
      return sku.includes(t) || nm.includes(t) || ty.includes(t) || rf.includes(t);
    });
  }, [history, movesSearch]);

  // 2) Sort by selected column and direction
  const movesSorted = useMemo(() => {
    const cp = [...movesFiltered];
    cp.sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;

      const get = (row: MoveRow): any => {
        switch (sortKey) {
          case 'created_at': return new Date(row.created_at).valueOf();
          case 'sku':        return (row.item?.sku ?? '').toLowerCase();
          case 'name':       return (row.item?.name ?? '').toLowerCase();
          case 'move_type':  return (row.move_type ?? '').toLowerCase();
          case 'qty':        return Number(row.qty);
          case 'uom_code':   return (row.uom_code ?? '').toLowerCase();
          case 'unit_cost':  return row.unit_cost == null ? Number.NEGATIVE_INFINITY : Number(row.unit_cost);
          case 'total_cost': return row.total_cost == null ? Number.NEGATIVE_INFINITY : Number(row.total_cost);
          case 'ref':        return (row.ref ?? '').toLowerCase();
          default:           return 0;
        }
      };

      const va = get(a);
      const vb = get(b);

      if (typeof va === 'number' && typeof vb === 'number') {
        return (va - vb) * dir;
      }
      if (va < vb) return -1 * dir;
      if (va > vb) return  1 * dir;
      return 0;
    });
    return cp;
  }, [movesFiltered, sortKey, sortDir]);

  // 3) Export CSV (current filtered + sorted)
  const exportMovesCsv = () => {
    const header = ['Date','SKU','Item','Type','Qty','UoM','Unit Cost','Total Cost','Ref'];
    const rows = movesSorted.map(m => [
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
    <div className="grid md:grid-cols-3 gap-4">
      {/* LEFT: Entry form */}
      <div className="card">
        <h2 className="font-semibold mb-3">Receive / Adjust / Issue / Return</h2>

        <form onSubmit={submit} className="space-y-3">
          {/* SKU + Find */}
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
                <>UoM: — • Current Qty: — • Avg Cost: —</>
              )}
            </div>
          </div>

          {/* Minimum qty */}
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2">
              <label className="label">Minimum Qty (low-stock threshold)</label>
              <input
                className="input"
                type="number"
                min={0}
                value={minQty}
                onChange={(e) => setMinQty(parseInt(e.target.value || '0', 10))}
                disabled={!found}
              />
            </div>
            <div className="flex items-end">
              <Button type="button" onClick={saveMinimum} disabled={!found || savingMin}>
                {savingMin ? 'Saving…' : 'Save Min'}
              </Button>
            </div>
          </div>

          {/* Type */}
          <div>
            <label className="label">Type</label>
            <select
              className="input"
              value={moveType}
              onChange={(e) => setMoveType(e.target.value as MoveType)}
            >
              <option value="receive">Receive</option>
              <option value="adjust">Adjust</option>
              <option value="issue">Issue</option>
              <option value="return">Return</option>
            </select>
          </div>

          {/* Qty + Unit Cost */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">
                {qtyLabel}
              </label>
              <input
                className="input"
                type="number"
                step="1"
                min={moveType === 'adjust' ? undefined : 1}
                value={qty}
                onChange={(e) => {
                  const v = e.target.value;
                  const n = v === '' ? 0 : Number(v);
                  setQty(Number.isFinite(n) ? n : 0);
                }}
                placeholder={moveType === 'adjust' ? 'e.g., -2 (lost) or 3 (found)' : 'e.g., 5'}
              />
            </div>

            {moveType === 'receive' ? (
              <div>
                <label className="label">Unit Cost (per {found?.uom_code || 'UoM'})</label>
                <input
                  className="input"
                  type="number"
                  step="0.01"
                  min={0}
                  value={unitCost}
                  onChange={(e) => setUnitCost(parseFloat(e.target.value || '0'))}
                />
              </div>
            ) : (
              <div>
                <label className="label">Unit Cost (auto)</label>
                <input className="input" value={(found?.unit_cost ?? 0).toFixed(2)} readOnly />
              </div>
            )}
          </div>

          {/* Preview */}
          <div className="text-sm text-gray-700">
            <div>
              Total Cost:&nbsp;
              <b>₹ {Number(preview?.total ?? 0).toFixed(2)}</b>
              {moveType !== 'receive' && ' (auto: Qty × current Avg Cost)'}
            </div>
            {moveType === 'receive' && preview && typeof (preview as any).newAvg === 'number' && (
              <div>
                New Avg Cost after Receive:&nbsp;
                <b>₹ {(preview as any).newAvg.toFixed(2)}</b>
                <span className="text-xs text-gray-500">
                  {' '}
                  [old: {(preview as any).oldQty} @ ₹{(preview as any).oldCost.toFixed(2)} → new: {(preview as any).newQty}]
                </span>
              </div>
            )}
          </div>

          {/* Ref & Reason */}
          <input
            className="input"
            placeholder="Reference (PO# etc.)"
            value={ref}
            onChange={(e) => setRef(e.target.value)}
          />
          <input
            className="input"
            placeholder="Reason / Note"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />

          <Button type="submit" disabled={loading || !found}>
            {loading ? 'Saving...' : 'Save'}
          </Button>
        </form>
      </div>

      {/* RIGHT: Recent Stock Movements with Search + Sort + CSV */}
      <div className="md:col-span-2 card">
        <div className="flex flex-wrap items-end gap-3 mb-3">
          <div className="text-lg font-semibold mr-auto">Recent Stock Movements</div>

          {/* Quick search */}
          <input
            className="input"
            placeholder="Search (SKU / Item / Type / Ref)…"
            value={movesSearch}
            onChange={(e) => setMovesSearch(e.target.value)}
          />

          {/* Limit */}
          <select
            className="input"
            value={movesLimit}
            onChange={(e) => setMovesLimit(parseInt(e.target.value || '100', 10))}
            title="Rows to load"
          >
            <option value={50}>Last 50</option>
            <option value={100}>Last 100</option>
            <option value={200}>Last 200</option>
            <option value={500}>Last 500</option>
          </select>

          <Button type="button" onClick={exportMovesCsv}>Download CSV</Button>
          <Button type="button" onClick={loadHistory}>Refresh</Button>
        </div>

        <div className="overflow-auto">
          <table className="table w-full">
            <thead>
              <tr>
                <th>
                  <SortHeader
                    label="Date"
                    active={sortKey==='created_at'}
                    dir={sortDir}
                    onClick={() => toggleSort('created_at')}
                    minWidth={160}
                  />
                </th>
                <th>
                  <SortHeader
                    label="Item"
                    active={sortKey==='sku' || sortKey==='name'}
                    dir={sortDir}
                    onClick={() => toggleSort('sku')}
                    minWidth={220}
                  />
                </th>
                <th>
                  <SortHeader
                    label="Type"
                    active={sortKey==='move_type'}
                    dir={sortDir}
                    onClick={() => toggleSort('move_type')}
                    minWidth={80}
                  />
                </th>
                <th className="text-right">
                  <SortHeader
                    label="Qty"
                    active={sortKey==='qty'}
                    dir={sortDir}
                    onClick={() => toggleSort('qty')}
                    alignRight
                    minWidth={80}
                  />
                </th>
                <th>
                  <SortHeader
                    label="UoM"
                    active={sortKey==='uom_code'}
                    dir={sortDir}
                    onClick={() => toggleSort('uom_code')}
                    minWidth={60}
                  />
                </th>
                <th className="text-right">
                  <SortHeader
                    label="Unit Cost"
                    active={sortKey==='unit_cost'}
                    dir={sortDir}
                    onClick={() => toggleSort('unit_cost')}
                    alignRight
                    minWidth={110}
                  />
                </th>
                <th className="text-right">
                  <SortHeader
                    label="Total Cost"
                    active={sortKey==='total_cost'}
                    dir={sortDir}
                    onClick={() => toggleSort('total_cost')}
                    alignRight
                    minWidth={120}
                  />
                </th>
                <th>
                  <SortHeader
                    label="Ref"
                    active={sortKey==='ref'}
                    dir={sortDir}
                    onClick={() => toggleSort('ref')}
                    minWidth={120}
                  />
                </th>
              </tr>
            </thead>
            <tbody>
              {movesLoading ? (
                <tr><td colSpan={8} className="p-3 text-sm text-gray-600">Loading stock movements…</td></tr>
              ) : movesSorted.length === 0 ? (
                <tr><td colSpan={8} className="p-3 text-sm text-gray-600">No movements found.</td></tr>
              ) : (
                movesSorted.map((h, idx) => (
                  <tr key={`${h.created_at}-${idx}`}>
                    <td>{new Date(h.created_at).toLocaleString()}</td>
                    <td>{h.item?.sku} — {h.item?.name}</td>
                    <td className="capitalize">{h.move_type}</td>
                    <td className="text-right" style={{ fontVariantNumeric: 'tabular-nums' }}>{h.qty}</td>
                    <td>{h.uom_code || '-'}</td>
                    <td className="text-right" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {h.unit_cost != null ? `₹ ${Number(h.unit_cost).toFixed(2)}` : '-'}
                    </td>
                    <td className="text-right" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {h.total_cost != null ? `₹ ${Number(h.total_cost).toFixed(2)}` : '-'}
                    </td>
                    <td>{h.ref || '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
