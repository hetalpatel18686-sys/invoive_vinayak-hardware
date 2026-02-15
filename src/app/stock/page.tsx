'use client';

import { useEffect, useMemo, useState } from 'react';
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

export default function Stock() {
  // --- Left panel: fast entry
  const [sku, setSku] = useState('');
  const [found, setFound] = useState<FoundItem | null>(null);

  const [moveType, setMoveType] = useState<MoveType>('receive');
  const [qty, setQty] = useState<number>(0);            // adjust: can be negative
  const [unitCost, setUnitCost] = useState<number>(0);  // purchase cost (receive)
  const [ref, setRef] = useState('');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);

  // Minimum (low-stock threshold) editor for found item
  const [minQty, setMinQty] = useState<number>(0);
  const [savingMin, setSavingMin] = useState(false);

  // --- Right panel: tabs
  const [activeTab, setActiveTab] = useState<'moves' | 'inventory'>('moves');

  // Movements
  const [history, setHistory] = useState<MoveRow[]>([]);
  // Inventory
  const [invRows, setInvRows] = useState<InvRow[]>([]);
  const [invLoading, setInvLoading] = useState(true);
  const [invSearch, setInvSearch] = useState('');
  const [invLowOnly, setInvLowOnly] = useState(false);

  useEffect(() => {
    loadHistory();
    loadInventory();
  }, []);

  /* ---------- Loads ---------- */

  const loadHistory = async () => {
    const h = await supabase
      .from('stock_moves')
      .select(`
        created_at, move_type, qty, ref, uom_code, unit_cost, total_cost,
        item:items ( name, sku )
      `)
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
      .select(`
        id, sku, name, description, stock_qty, unit_cost, low_stock_threshold,
        uom:units_of_measure ( code )
      `)
      .ilike('sku', trimmed)  // ← key change
      .limit(1);

    if (error) return alert(error.message);
    const row = (data ?? [])[0];
    if (!row) return alert('No item found for this SKU');

    const uom_code = Array.isArray(row.uom) ? (row.uom[0]?.code ?? '') : (row.uom?.code ?? '');

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
    if (loading) return;  // extra guard against double submit
    if (!found) return alert('Please find an item by SKU first');

    if (moveType === 'adjust') {
      if (!qty || qty === 0) return alert('For adjust, delta cannot be 0');
    } else {
      if (!qty || qty <= 0) return alert('Quantity must be > 0');
    }

    setLoading(true);
    try {
      if (moveType === 'receive') {
        if (unitCost < 0) return alert('Unit cost must be >= 0');
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
      alert(err.message || String(err));
    } finally {
      setLoading(false);
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
      alert(err.message || String(err));
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
                  UoM: <b>{found.uom_code || '-'}</b> • Current Qty: <b>{found.stock_qty ?? 0}</b> •
                  Avg Cost: <b>₹ {(found.unit_cost ?? 0).toFixed(2)}</b>
                </>
              ) : (
                <>UoM: — • Current Qty: — • Avg Cost: —</>
              )}
            </div>
          </div>

          {/* Minimum qty editor */}
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

          {/* Move type */}
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
                {moveType === 'adjust'
                  ? 'Adjust Qty (use negative for lost, positive for found)'
                  : 'Qty'}
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
            {moveType === 'receive' && preview && typeof preview.newAvg === 'number' && (
              <div>
                New Avg Cost after Receive:&nbsp;
                <b>₹ {preview.newAvg.toFixed(2)}</b>
                <span className="text-xs text-gray-500">
                  {' '}[old: {preview.oldQty} @ ₹{preview.oldCost.toFixed(2)} → new: {preview.newQty}]
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

      {/* RIGHT: Tabs */}
      <div className="md:col-span-2 card">
        <div className="flex items-center gap-4 mb-3">
          <button
            className={`px-3 py-1 rounded ${activeTab === 'moves' ? 'bg-primary text-white' : 'bg-gray-200'}`}
            onClick={() => setActiveTab('moves')}
          >
            Recent Stock Movements
          </button>
          <button
            className={`px-3 py-1 rounded ${activeTab === 'inventory' ? 'bg-primary text-white' : 'bg-gray-200'}`}
            onClick={() => setActiveTab('inventory')}
          >
            Inventory
          </button>
        </div>

        {activeTab === 'moves' ? (
          <div className="overflow-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Item</th>
                  <th>Type</th>
                  <th>Qty</th>
                  <th>UoM</th>
                  <th>Unit Cost</th>
                  <th>Total Cost</th>
                  <th>Ref</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h, idx) => (
                  <tr key={`${h.created_at}-${idx}`}>
                    <td>{new Date(h.created_at).toLocaleString()}</td>
                    <td>{h.item?.sku} — {h.item?.name}</td>
                    <td>{h.move_type}</td>
                    <td>{h.qty}</td>
                    <td>{h.uom_code || '-'}</td>
                    <td>{h.unit_cost != null ? `₹ ${Number(h.unit_cost).toFixed(2)}` : '-'}</td>
                    <td>{h.total_cost != null ? `₹ ${Number(h.total_cost).toFixed(2)}` : '-'}</td>
                    <td>{h.ref}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <>
            <div className="mb-3 grid md:grid-cols-3 gap-2">
              <input
                className="input"
                placeholder="Search SKU or Name…"
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
              <div className="flex gap-2">
                <Button type="button" onClick={exportInvCsv}>Export CSV</Button>
                <Button type="button" onClick={loadInventory}>Refresh</Button>
              </div>
            </div>

            {invLoading ? (
              <p>Loading…</p>
            ) : invRows.length === 0 ? (
              <div className="p-3 text-sm text-gray-700">No items found. Add items or refresh.</div>
            ) : (
              <div className="overflow-auto">
                <table className="table">
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
          </>
        )}
      </div>
    </div>
  );
}
