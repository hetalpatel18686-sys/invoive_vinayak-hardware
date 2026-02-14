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
  uom_code?: string; // auto from units_of_measure
}

export default function Stock() {
  // --- State for SKU-based flow ---
  const [sku, setSku] = useState('');
  const [found, setFound] = useState<FoundItem | null>(null);

  const [moveType, setMoveType] = useState<MoveType>('receive');
  const [qty, setQty] = useState<number>(0);       // for adjust: can be negative or positive
  const [unitCost, setUnitCost] = useState<number>(0); // used only for receive (manual)
  const [ref, setRef] = useState('');
  const [reason, setReason] = useState('');
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadHistory();
  }, []);

  // Load last 50 moves for the right-hand table (with UoM, Unit Cost, Total Cost)
  const loadHistory = async () => {
    const h = await supabase
      .from('stock_moves')
      .select(`
        created_at, move_type, qty, ref, uom_code, unit_cost, total_cost,
        item:items ( name, sku )
      `)
      .order('created_at', { ascending: false })
      .limit(50);

    const rows =
      (h.data ?? []).map((r: any) => ({
        created_at: r.created_at,
        move_type: r.move_type,
        qty: r.qty,
        ref: r.ref,
        uom_code: r.uom_code,
        unit_cost: r.unit_cost,
        total_cost: r.total_cost,
        item: Array.isArray(r.item) ? (r.item[0] ?? null) : r.item ?? null,
      })) ?? [];

    setHistory(rows);
  };

  // Find item by SKU (also fetch UoM code, stock & current avg unit_cost)
  const findBySku = async () => {
    setFound(null);
    const trimmed = sku.trim();
    if (!trimmed) {
      alert('Please enter SKU');
      return;
    }

    const { data, error } = await supabase
      .from('items')
      .select(`
        id, sku, name, description, stock_qty, unit_cost,
        uom:units_of_measure ( code )
      `)
      .eq('sku', trimmed)
      .limit(1);

    if (error) {
      alert(error.message);
      return;
    }
    if (!data || data.length === 0) {
      alert('No item found for this SKU');
      return;
    }

    const row = data[0] as any;
    const uom_code = Array.isArray(row.uom) ? (row.uom[0]?.code ?? '') : (row.uom?.code ?? '');

    setFound({
      id: row.id,
      sku: row.sku,
      name: row.name,
      description: row.description,
      stock_qty: Number(row.stock_qty ?? 0),
      unit_cost: Number(row.unit_cost ?? 0),
      uom_code,
    });

    // Reset entry fields when a new item is found
    setQty(0);
    setUnitCost(0);
    setRef('');
    setReason('');
  };

  // For Issue/Return/Adjust, unit cost is auto = current avg
  const autoUnitCost = found?.unit_cost ?? 0;

  // For total-cost preview, pick correct cost source
  const costToUse = moveType === 'receive' ? unitCost : autoUnitCost;

  // For Adjust: allow negative (lost) or positive (found).
  const qtyLabel =
    moveType === 'adjust'
      ? 'Adjust Qty (use negative for lost, positive for found)'
      : 'Qty';

  // Preview: total cost and, for Receive, new average cost
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

  // Save stock move
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!found) {
      alert('Please find an item by SKU first');
      return;
    }

    // Validate qty by move type
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
          p_delta: qty,              // can be negative (lost) or positive (found)
          p_ref: ref || null,
          p_reason: reason || null,
        });
        if (error) throw error;
      }

      // Clear / reload UI
      await findBySku();
      await loadHistory();
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

  return (
    <div className="grid md:grid-cols-3 gap-4">
      {/* LEFT: Entry form */}
      <div className="card">
        <h2 className="font-semibold mb-3">Receive / Adjust / Issue / Return</h2>

        <form onSubmit={submit} className="space-y-3">
          {/* SKU input + Find button */}
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
            <Button type="button" onClick={findBySku}>
              Find
            </Button>
          </div>

          {/* Read-only item preview + UoM + current stock & avg cost */}
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

          {/* Qty + Unit Cost (auto except Receive) */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">{qtyLabel}</label>
              <input
                className="input"
                type="number"
                step="1"
                // For adjust we allow negatives; for others keep >=1
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

            {/* Unit Cost field */}
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
                <input
                  className="input"
                  value={autoUnitCost.toFixed(2)}
                  readOnly
                />
              </div>
            )}
          </div>

          {/* Preview: Total Cost and (for Receive) New Avg */}
          <div className="text-sm text-gray-700">
            <div>
              Total Cost:&nbsp;
              <b>
                ₹ {Number(preview?.total ?? 0).toFixed(2)}
              </b>
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

      {/* RIGHT: History (now with UoM, Unit Cost, Total Cost) */}
      <div className="md:col-span-2 card">
        <h2 className="font-semibold mb-2">Recent Stock Movements</h2>
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
              <tr key={idx}>
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
    </div>
  );
}
