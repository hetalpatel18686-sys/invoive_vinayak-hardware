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
  uom_code?: string; // <-- auto from units_of_measure
}

export default function Stock() {
  // --- State for SKU-based flow ---
  const [sku, setSku] = useState('');
  const [found, setFound] = useState<FoundItem | null>(null);

  const [moveType, setMoveType] = useState<MoveType>('receive');
  const [qty, setQty] = useState<number>(0);
  const [unitCost, setUnitCost] = useState<number>(0); // cost per UoM for Receive
  const [ref, setRef] = useState('');
  const [reason, setReason] = useState('');
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadHistory();
  }, []);

  // Load last 50 moves for the right-hand table
  const loadHistory = async () => {
    const h = await supabase
      .from('stock_moves')
      .select(`
        created_at, move_type, qty, ref, uom_code, unit_cost,
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
        // Supabase can return array or object depending on rel config; normalize:
        item: Array.isArray(r.item) ? (r.item[0] ?? null) : r.item ?? null,
      })) ?? [];

    setHistory(rows);
  };

  // Find item by SKU (also fetch UoM code, stock & cost)
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
  };

  // Preview new average cost before saving (only for Receive)
  const previewAvg = useMemo(() => {
    if (!found || moveType !== 'receive' || qty <= 0) return null;
    const oldQty = Number(found.stock_qty || 0);
    const oldCost = Number(found.unit_cost || 0);
    const newQty = oldQty + qty;
    const avg =
      newQty === 0 ? unitCost : ((oldQty * oldCost) + (qty * unitCost)) / newQty;
    return {
      oldQty,
      oldCost,
      newQty,
      newAvg: Number.isFinite(avg) ? avg : 0,
    };
  }, [found, moveType, qty, unitCost]);

  // Save stock move using found item id
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!found) {
      alert('Please find an item by SKU first');
      return;
    }
    if (!qty || qty <= 0) {
      alert('Quantity must be > 0');
      return;
    }

    setLoading(true);
    try {
      if (moveType === 'receive') {
        // Moving-average receive via RPC
        if (unitCost < 0) {
          alert('Unit cost must be >= 0');
          setLoading(false);
          return;
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
      } else {
        // For now, keep Adjust / Issue / Return as a simple move log.
        // (If you want stock_qty updates here too, tell me and I’ll add them.)
        const payload = {
          item_id: found.id,
          move_type: moveType,          // casted by PostgREST if enum
          qty: Number(qty),
          ref: ref || null,
          reason: reason || null,
          uom_code: found.uom_code || null,
          unit_cost: null,
          total_cost: null,
        };
        const { error } = await supabase.from('stock_moves').insert([payload]);
        if (error) throw error;
      }

      // Clear quick-entry fields and refresh UI
      setQty(0);
      setUnitCost(0);
      setRef('');
      setReason('');
      await findBySku();   // refresh current item (qty / cost)
      await loadHistory(); // refresh right table
      alert('Saved successfully.');
    } catch (err: any) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid md:grid-cols-3 gap-4">
      {/* LEFT: Entry form */}
      <div className="card">
        <h2 className="font-semibold mb-3">Receive / Adjust</h2>

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

          {/* Read-only item preview + UoM + current avg cost */}
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
                  UoM: <b>{found.uom_code || '-'}</b> • Stock: <b>{found.stock_qty ?? 0}</b> •
                  Avg Cost: <b>₹ {(found.unit_cost ?? 0).toFixed(2)}</b>
                </>
              ) : (
                <>UoM: — • Stock: — • Avg Cost: —</>
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
              <option value="return">Return</option>
              <option value="issue">Issue</option>
            </select>
          </div>

          {/* Qty + Unit Cost (for Receive) */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">Qty</label>
              <input
                className="input"
                type="number"
                min={1}
                value={qty}
                onChange={(e) =>
                  setQty(Number.isNaN(parseInt(e.target.value)) ? 0 : parseInt(e.target.value))
                }
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
                <label className="label">&nbsp;</label>
                <input className="input" placeholder="(N/A)" readOnly />
              </div>
            )}
          </div>

          {/* Avg preview */}
          {moveType === 'receive' && previewAvg && (
            <div className="text-sm text-gray-700">
              Current Qty: <b>{previewAvg.oldQty}</b>, Avg Cost: <b>₹ {previewAvg.oldCost.toFixed(2)}</b> →&nbsp;
              New Qty: <b>{previewAvg.newQty}</b>, New Avg: <b>₹ {previewAvg.newAvg.toFixed(2)}</b>
            </div>
          )}

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

      {/* RIGHT: History */}
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
                <td>{h.ref}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
