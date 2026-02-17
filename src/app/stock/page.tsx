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
  location?: string | null;
  item: { sku: string; name: string } | null;
}

/* ---------- New: Per-location balance type ---------- */
type LocBalance = { name: string; qty: number };

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
  | 'ref'
  | 'location';

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
  const [location, setLocation] = useState<string>(''); // Selected or typed location
  const [loading, setLoading] = useState<boolean>(false);

  // New: location balances + UI mode
  const [locBalances, setLocBalances] = useState<LocBalance[]>([]);
  const [useCustomLocation, setUseCustomLocation] = useState<boolean>(false); // only allowed for receive

  // Min qty editor
  const [minQty, setMinQty] = useState<number>(0);
  const [savingMin, setSavingMin] = useState<boolean>(false);

  // Movements data + UX
  const [history, setHistory] = useState<MoveRow[]>([]);
  const [movesLoading, setMovesLoading] = useState<boolean>(false);
  const [movesSearch, setMovesSearch] = useState<string>(''); // quick search (SKU/Item/Type/Ref/Location)
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

  // Barcode-friendly UX: focus
  const [scanMode, setScanMode] = useState<boolean>(true);
  const skuRef = useRef<HTMLInputElement | null>(null);
  const qtyRef = useRef<HTMLInputElement | null>(null);
  const unitCostRef = useRef<HTMLInputElement | null>(null);

  // Extra double-submit guard
  const submittingRef = useRef(false);

  useEffect(() => {
    loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movesLimit]); // reload when limit changes

  useEffect(() => {
    // Auto-focus SKU on mount
    tryFocusSku(true);
  }, []);

  const tryFocusSku = (selectAll = false) => {
    requestAnimationFrame(() => {
      const el = skuRef.current;
      if (el) {
        el.focus();
        if (selectAll) {
          try { el.select(); } catch {}
        }
      }
    });
  };

  // ---------- Loads ----------
  const loadHistory = async () => {
    try {
      setMovesLoading(true);
      const h = await supabase
        .from('stock_moves')
        .select(
          'created_at, move_type, qty, ref, uom_code, unit_cost, total_cost, location, item:items ( name, sku )'
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
          location: r.location ?? null,
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

  // ---------- New: Load per-location balances for a found item ----------
  const loadItemLocations = async (itemId: string) => {
    try {
      const { data, error } = await supabase
        .from('stock_moves')
        .select('move_type, qty, location, item_id')
        .eq('item_id', itemId);

      if (error) throw error;

      const map = new Map<string, number>();

      (data ?? []).forEach((r: any) => {
        const mt = String(r.move_type || '').toLowerCase() as MoveType;
        const loc = (String(r.location ?? '').trim()) || '(unassigned)';
        const qRaw = Number(r.qty ?? 0);

        // Calculate delta:
        // - receive: +qty
        // - return:  +qty
        // - issue:   -qty
        // - adjust:  qty is already delta (+/-)
        let delta = qRaw;
        if (mt === 'issue') delta = -Math.abs(qRaw);
        else if (mt === 'receive' || mt === 'return') delta = Math.abs(qRaw);
        // adjust uses the value as-is (could be negative or positive)

        map.set(loc, (map.get(loc) ?? 0) + delta);
      });

      const balances = Array.from(map.entries())
        .map(([name, qty]) => ({ name, qty }))
        .sort((a, b) => a.name.localeCompare(b.name));

      setLocBalances(balances);
    } catch (e) {
      console.warn('loadItemLocations failed:', e);
      setLocBalances([]);
    }
  };

  // ---------- Find by SKU (case-insensitive exact) ----------
  const findBySku = async () => {
    setFound(null);
    setLocBalances([]);
    setUseCustomLocation(false);
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

    const foundItem: FoundItem = {
      id: row.id,
      sku: row.sku,
      name: row.name,
      description: row.description,
      stock_qty: Number(row.stock_qty ?? 0),
      unit_cost: Number(row.unit_cost ?? 0),
      uom_code,
      low_stock_threshold: row.low_stock_threshold ?? null,
    };

    setFound(foundItem);
    setMinQty(Number(row.low_stock_threshold ?? 0));
    setQty(0);
    setUnitCost(0);
    setRef('');
    setReason('');
    setLocation(''); // reset location for fresh operation
    setUseCustomLocation(false);

    // Load per-location balances for this item
    await loadItemLocations(foundItem.id);

    // After we find an item, go straight to Qty for speed
    requestAnimationFrame(() => qtyRef.current?.focus());
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

  // New: computed available qty for the currently selected location
  const selectedLocQty = useMemo(() => {
    if (!location) return 0;
    const foundLoc = locBalances.find(l => l.name === location);
    return foundLoc?.qty ?? 0;
  }, [locBalances, location]);

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

    // Validate qty semantics by move type
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

    // Validate location rules
    if (moveType === 'issue' || moveType === 'return' || moveType === 'adjust') {
      // For these types, location must be selected from existing options
      if (!location) {
        submittingRef.current = false;
        return alert(`Please select a location for ${moveType}.`);
      }
      const exists = locBalances.some(l => l.name === location);
      if (!exists) {
        submittingRef.current = false;
        return alert(`Please choose an existing location for ${moveType}.`);
      }

      // Prevent issuing more than available at location
      if (moveType === 'issue' && selectedLocQty < qty) {
        submittingRef.current = false;
        return alert(`Insufficient quantity at "${location}". Available: ${selectedLocQty}`);
      }

      // For adjust (negative), don't allow location to go below zero
      if (moveType === 'adjust' && qty < 0 && (selectedLocQty + qty) < 0) {
        submittingRef.current = false;
        return alert(
          `Adjustment would make "${location}" negative. Available: ${selectedLocQty}, delta: ${qty}`
        );
      }
    } else if (moveType === 'receive') {
      // For receive, allow custom location or existing selection (optional)
      if (useCustomLocation && !location.trim()) {
        submittingRef.current = false;
        return alert('Please enter a new location name.');
      }
      // If not using custom and not selected, we allow empty (unassigned) if you prefer.
      // To force selection, uncomment the next lines:
      // if (!useCustomLocation && !location) {
      //   submittingRef.current = false;
      //   return alert('Please select an existing location or choose "Other / New".');
      // }
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

      // --- Attach location to the new stock_moves row (by client_tx_id) ---
      if ((location && location.trim()) || (useCustomLocation && location.trim())) {
        try {
          await supabase
            .from('stock_moves')
            .update({ location: location.trim() })
            .eq('client_tx_id', clientTxId);
        } catch (e) {
          // If the column doesn't exist or RLS prevents update, ignore silently.
          console.warn('location update skipped:', e);
        }
      }

      await findBySku();        // refresh item + per-location
      await loadHistory();      // refresh history

      setQty(0);
      if (moveType === 'receive') setUnitCost(0);
      setRef('');
      setReason('');
      setLocation('');
      setUseCustomLocation(false);

      if (scanMode) {
        tryFocusSku(true); // back to SKU for next scan
      }
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
      const lc  = m.location?.toLowerCase() ?? '';
      return sku.includes(t) || nm.includes(t) || ty.includes(t) || rf.includes(t) || lc.includes(t);
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
          case 'location':   return (row.location ?? '').toLowerCase();
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
    const header = ['Date','SKU','Item','Type','Qty','UoM','Unit Cost','Total Cost','Ref','Location'];
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
      (m.location ?? '').replaceAll('"','""'),
    ].map(v => `"${v}"`).join(','));
    const date = new Date().toISOString().slice(0,10);
    downloadCsv(`stock_movements_${date}.csv`, [header.join(','), ...rows]);
  };

  // Helper to render location selector
  const renderLocationSelector = () => {
    const hasLocations = locBalances.length > 0;

    if (moveType === 'issue' || moveType === 'return' || moveType === 'adjust') {
      // Must select existing location
      return (
        <div>
          <label className="label">Location</label>
          <select
            className="input"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            disabled={!found}
          >
            <option value="">Select location…</option>
            {locBalances.map((l) => (
              <option key={l.name} value={l.name}>
                {l.name} — {l.qty} {found?.uom_code || ''}
              </option>
            ))}
          </select>
          {location && (
            <div className="text-xs text-gray-600 mt-1">
              Available at <b>{location}</b>: <b>{selectedLocQty}</b> {found?.uom_code || ''}
            </div>
          )}
          {!hasLocations && (
            <div className="text-xs text-amber-600 mt-1">
              No existing locations found for this item.
            </div>
          )}
        </div>
      );
    }

    // Receive: can select existing or type new
    return (
      <div>
        <label className="label">Location (optional)</label>
        <div className="grid grid-cols-2 gap-2">
          <select
            className="input"
            value={useCustomLocation ? '__NEW__' : (location || '')}
            onChange={(e) => {
              const v = e.target.value;
              if (v === '__NEW__') {
                setUseCustomLocation(true);
                setLocation('');
              } else {
                setUseCustomLocation(false);
                setLocation(v);
              }
            }}
            disabled={!found}
          >
            <option value="">{hasLocations ? 'Select existing…' : 'No locations yet'}</option>
            {locBalances.map((l) => (
              <option key={l.name} value={l.name}>
                {l.name} — {l.qty} {found?.uom_code || ''}
              </option>
            ))}
            <option value="__NEW__">Other / New…</option>
          </select>

          <input
            className="input"
            placeholder="Type new location (e.g., Rack A3 / Shelf 2)"
            value={useCustomLocation ? location : ''}
            onChange={(e) => setLocation(e.target.value)}
            disabled={!found || !useCustomLocation}
          />
        </div>
        {(!useCustomLocation && location) && (
          <div className="text-xs text-gray-600 mt-1">
            Selected: <b>{location}</b> — Available: <b>{selectedLocQty}</b> {found?.uom_code || ''}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="grid md:grid-cols-3 gap-4">
      {/* LEFT: Entry form */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">Receive / Adjust / Issue / Return</h2>
          {/* Scan mode toggle */}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={scanMode}
              onChange={(e) => setScanMode(e.target.checked)}
            />
            <span>Scan Mode (auto focus SKU)</span>
          </label>
        </div>

        <form onSubmit={submit} className="space-y-3">
          {/* SKU + Find */}
          <div className="flex gap-2">
            <input
              ref={skuRef}
              className="input"
              placeholder="SKU (scan barcode here)"
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

          {/* New: Per-location stock snapshot */}
          {found && (
            <div className="rounded border p-2 bg-gray-50">
              <div className="text-sm font-medium mb-1">Per-location Stock</div>
              {locBalances.length === 0 ? (
                <div className="text-xs text-gray-600">No location splits yet.</div>
              ) : (
                <ul className="text-xs text-gray-800 space-y-0.5">
                  {locBalances.map(l => (
                    <li key={l.name} className="flex justify-between">
                      <span>{l.name}</span>
                      <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {l.qty} {found?.uom_code || ''}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

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
              onChange={(e) => {
                const mt = e.target.value as MoveType;
                setMoveType(mt);

                // When switching to issue/return/adjust, enforce existing selection
                if (mt === 'issue' || mt === 'return' || mt === 'adjust') {
                  setUseCustomLocation(false);
                  // keep previously selected existing location if it still exists; otherwise clear
                  if (location && !locBalances.some(l => l.name === location)) {
                    setLocation('');
                  }
                }
              }}
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
                ref={qtyRef}
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
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  if (moveType === 'receive') {
                    unitCostRef.current?.focus();
                    unitCostRef.current?.select?.();
                  } else {
                    // For issue/return/adjust, Enter on Qty submits directly
                    (e.currentTarget.form as HTMLFormElement)?.requestSubmit?.();
                  }
                }}
              />
              {(moveType === 'issue' || moveType === 'adjust') && location && (
                <div className="text-xs text-gray-600 mt-1">
                  Available at <b>{location}</b>: <b>{selectedLocQty}</b> {found?.uom_code || ''}
                </div>
              )}
            </div>

            {moveType === 'receive' ? (
              <div>
                <label className="label">Unit Cost (per {found?.uom_code || 'UoM'})</label>
                <input
                  ref={unitCostRef}
                  className="input"
                  type="number"
                  step="0.01"
                  min={0}
                  value={unitCost}
                  onChange={(e) => setUnitCost(parseFloat(e.target.value || '0'))}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return;
                    e.preventDefault();
                    (e.currentTarget.form as HTMLFormElement)?.requestSubmit?.();
                  }}
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

          {/* Ref / Reason */}
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

          {/* NEW: Location selector (smart) */}
          {renderLocationSelector()}

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
            placeholder="Search (SKU / Item / Type / Ref / Location)…"
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
                <th>
                  <SortHeader
                    label="Location"
                    active={sortKey==='location'}
                    dir={sortDir}
                    onClick={() => toggleSort('location')}
                    minWidth={120}
                  />
                </th>
              </tr>
            </thead>
            <tbody>
              {movesLoading ? (
                <tr><td colSpan={9} className="p-3 text-sm text-gray-600">Loading stock movements…</td></tr>
              ) : movesSorted.length === 0 ? (
                <tr><td colSpan={9} className="p-3 text-sm text-gray-600">No movements found.</td></tr>
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
                    <td>{h.location || '—'}</td>
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
