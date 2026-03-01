'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import Button from '@/components/Button';

/* -------------------------------- Modal -------------------------------- */

function Modal({
  title,
  open,
  onClose,
  children,
  maxWidth = 520,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: number;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      aria-modal="true"
      role="dialog"
    >
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className="relative bg-white rounded shadow-lg w-[95vw] p-4"
        style={{ maxWidth }}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="px-2 py-1 rounded bg-gray-100 hover:bg-gray-200"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ------------------------------- Types ---------------------------------- */

type MoveType = 'receive' | 'adjust' | 'issue' | 'return';

interface FoundItem {
  id: string;
  sku: string;
  name: string | null;
  description?: string | null;
  stock_qty?: number;
  unit_cost?: number;       // moving average
  uom_code?: string;
  low_stock_threshold?: number | null;

  // pricing fields (used to keep Inventory page in sync)
  purchase_price?: number | null;
  gst_percent?: number | null;
  margin_percent?: number | null;
  tax_rate?: number | null;    // kept in sync with gst_percent
  unit_price?: number | null;  // selling price
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

type LocBalance = { name: string; qty: number };
type Uom = { code: string; name: string };

/* ---------------------------- Small helpers ----------------------------- */

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

function downloadCsv(filename: string, rows: string[]) {
  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* ------------------------------ Component ------------------------------- */

export default function Stock() {
  /* -------- Global state -------- */
  const [sku, setSku] = useState<string>('');
  const [found, setFound] = useState<FoundItem | null>(null);
  const [locBalances, setLocBalances] = useState<LocBalance[]>([]);
  const [allUoms, setAllUoms] = useState<Uom[]>([]);
  const [loading, setLoading] = useState<boolean>(false);

  // scanner focus
  const [scanMode, setScanMode] = useState<boolean>(true);
  const skuRef = useRef<HTMLInputElement | null>(null);

  // history
  const [history, setHistory] = useState<MoveRow[]>([]);
  const [movesLoading, setMovesLoading] = useState<boolean>(false);
  const [movesSearch, setMovesSearch] = useState<string>('');
  const [movesLimit, setMovesLimit] = useState<number>(100);
  const [sortKey, setSortKey] = useState<
    'created_at' | 'sku' | 'name' | 'move_type' | 'qty' | 'uom_code' | 'unit_cost' | 'total_cost' | 'ref' | 'location'
  >('created_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // Minimum qty
  const [minQty, setMinQty] = useState<number>(0);
  const [savingMin, setSavingMin] = useState<boolean>(false);

  // Guard
  const submittingRef = useRef(false);

  /* -------- Modal visibility -------- */
  const [showReceive, setShowReceive] = useState(false);
  const [showAdjust, setShowAdjust] = useState(false);
  const [showIssue, setShowIssue] = useState(false);
  const [showReturn, setShowReturn] = useState(false);

  /* -------- Receive form (modal) -------- */
  const [rcvQty, setRcvQty] = useState<number>(0);
  const [rcvUom, setRcvUom] = useState<string>(''); // code
  const [purchasePrice, setPurchasePrice] = useState<number>(0);
  const [gstPct, setGstPct] = useState<number>(0);
  const [marginPct, setMarginPct] = useState<number>(0);
  const [salePrice, setSalePrice] = useState<number>(0);
  const [rcvRef, setRcvRef] = useState<string>('');
  const [rcvReason, setRcvReason] = useState<string>('');
  const [rcvLocation, setRcvLocation] = useState<string>('');
  const [useCustomLocation, setUseCustomLocation] = useState<boolean>(false);

  /* -------- Issue / Return / Adjust forms (modals) -------- */
  const [mQty, setMQty] = useState<number>(0);
  const [mRef, setMRef] = useState<string>('');
  const [mReason, setMReason] = useState<string>('');
  const [mLocation, setMLocation] = useState<string>('');

  /* ---------------- Effects ---------------- */
  useEffect(() => {
    loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movesLimit]);

  useEffect(() => {
    tryFocusSku(true);
    loadUoms();
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

  const loadUoms = async () => {
    try {
      const { data, error } = await supabase
        .from('units_of_measure')
        .select('code, name')
        .order('code', { ascending: true });
      if (error) throw error;
      setAllUoms((data as Uom[]) ?? []);
    } catch (e) {
      console.warn('loadUoms failed:', e);
      setAllUoms([]);
    }
  };

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

        let delta = qRaw;
        if (mt === 'issue') delta = -Math.abs(qRaw);
        else if (mt === 'receive' || mt === 'return') delta = Math.abs(qRaw);
        // adjust uses the value as-is

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

  const findBySku = async () => {
    setFound(null);
    setLocBalances([]);
    setUseCustomLocation(false);
    const trimmed = sku.trim();
    if (!trimmed) return alert('Please enter SKU');

    const { data, error } = await supabase
      .from('items')
      .select(
        // pull pricing fields too
        'id, sku, name, description, stock_qty, unit_cost, low_stock_threshold, purchase_price, gst_percent, margin_percent, tax_rate, unit_price, uom:units_of_measure ( code )'
      )
      .ilike('sku', trimmed)
      .limit(1);

    if (error) return alert(error.message);
    const row: any = (data ?? [])[0];
    if (!row) return alert('No item found for this SKU');

    const uom_code = Array.isArray(row.uom) ? (row.uom?.[0]?.code ?? '') : (row.uom?.code ?? '');

    const foundItem: FoundItem = {
      id: row.id,
      sku: row.sku,
      name: row.name,
      description: row.description,
      stock_qty: Number(row.stock_qty ?? 0),
      unit_cost: Number(row.unit_cost ?? 0),
      uom_code,
      low_stock_threshold: row.low_stock_threshold ?? null,

      purchase_price: row.purchase_price ?? null,
      gst_percent: row.gst_percent ?? (row.tax_rate ?? null),
      margin_percent: row.margin_percent ?? null,
      tax_rate: row.tax_rate ?? null,
      unit_price: row.unit_price ?? null,
    };

    setFound(foundItem);
    setMinQty(Number(row.low_stock_threshold ?? 0));

    // Prime Receive modal defaults from DB values
    setRcvQty(0);
    setRcvUom(uom_code || '');
    setPurchasePrice(Number(row.purchase_price ?? row.unit_cost ?? 0));
    setGstPct(Number(row.gst_percent ?? row.tax_rate ?? 0));
    setMarginPct(Number(row.margin_percent ?? 0));
    setSalePrice(Number(row.unit_price ?? 0));
    setRcvRef('');
    setRcvReason('');
    setRcvLocation('');
    setUseCustomLocation(false);

    // Other modals
    setMQty(0);
    setMRef('');
    setMReason('');
    setMLocation('');

    await loadItemLocations(foundItem.id);

    requestAnimationFrame(() => skuRef.current?.focus());
  };

  /* ----------------- History view helpers (search/sort/export) ----------- */

  const movesFiltered = useMemo(() => {
    const t = movesSearch.trim().toLowerCase();
    if (!t) return history;
    return history.filter((m) => {
      const sku = m.item?.sku?.toLowerCase() ?? '';
      const nm = m.item?.name?.toLowerCase() ?? '';
      const ty = m.move_type?.toLowerCase() ?? '';
      const rf = m.ref?.toLowerCase() ?? '';
      const lc = m.location?.toLowerCase() ?? '';
      return sku.includes(t) || nm.includes(t) || ty.includes(t) || rf.includes(t) || lc.includes(t);
    });
  }, [history, movesSearch]);

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

  const toggleSort = (k: typeof sortKey) => {
    setSortKey(prev => {
      if (prev !== k) {
        setSortDir('asc');
        return k;
      }
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
      return k;
    });
  };

  /* ------------------------- Common pricing sync ------------------------- */

  /**
   * Sync pricing on the `items` row so Inventory page reflects the latest
   * Purchase/GST/Margin and a recomputed Selling Price.
   * - On Receive: pass the modal values (purchasePrice, gstPct, marginPct, salePrice)
   * - On Issue/Return/Adjust: if nothing changed, we keep the last saved values from DB.
   */
  const syncItemPricing = async (opts?: {
    purchase?: number | null;
    gst?: number | null;
    margin?: number | null;
    sale?: number | null;
  }) => {
    if (!found) return;
    const purchase =
      (Number.isFinite(opts?.purchase ?? NaN) ? opts!.purchase! : (found.purchase_price ?? found.unit_cost ?? 0)) as number;
    const gst =
      (Number.isFinite(opts?.gst ?? NaN) ? opts!.gst! : (found.gst_percent ?? found.tax_rate ?? 0)) as number;
    const margin =
      (Number.isFinite(opts?.margin ?? NaN) ? opts!.margin! : (found.margin_percent ?? 0)) as number;

    const sale =
      Number.isFinite(opts?.sale ?? NaN) && (opts!.sale as number) > 0
        ? (opts!.sale as number)
        : (purchase * (1 + (gst || 0) / 100) * (1 + (margin || 0) / 100));

    // Persist (and keep tax_rate mirror for any legacy screens)
    const { error } = await supabase
      .from('items')
      .update({
        purchase_price: Number.isFinite(purchase) ? purchase : 0,
        gst_percent: Number.isFinite(gst) ? gst : 0,
        margin_percent: Number.isFinite(margin) ? margin : 0,
        tax_rate: Number.isFinite(gst) ? gst : 0,
        unit_price: Number.isFinite(sale) ? sale : 0,
      })
      .eq('id', found.id);

    if (error) throw error;
  };

  /* ----------------------------- Handlers -------------------------------- */

  // Save minimum
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

  // Receive submit
  const submitReceive = async () => {
    if (!found) return alert('Find an item first.');
    if (!rcvQty || rcvQty <= 0) return alert('Quantity must be > 0.');
    const uomCode = rcvUom || found.uom_code || null;

    setLoading(true);
    if (submittingRef.current) return;
    submittingRef.current = true;

    try {
      const clientTxId = makeClientTxId();

      // 1) Record the stock receive with avg costing
      {
        const { error } = await supabase.rpc('receive_stock_avg', {
          p_item_id: found.id,
          p_qty: rcvQty,
          p_unit_cost: purchasePrice, // purchase price per UoM
          p_uom_code: uomCode,
          p_ref: rcvRef || null,
          p_reason: rcvReason || null,
          p_client_tx_id: clientTxId,
        });
        if (error) throw error;
      }

      // 2) Attach location to that move via client_tx_id (if provided)
      if (rcvLocation && rcvLocation.trim()) {
        try {
          await supabase
            .from('stock_moves')
            .update({ location: rcvLocation.trim() })
            .eq('client_tx_id', clientTxId);
        } catch (e) {
          console.warn('location update skipped:', e);
        }
      }

      // 3) Sync pricing to items — Inventory page reads these exact columns
      await syncItemPricing({
        purchase: purchasePrice,
        gst: gstPct,
        margin: marginPct,
        sale: salePrice && salePrice > 0 ? salePrice : null,
      });

      // Refresh
      await findBySku();
      await loadHistory();
      alert('Receive saved.');

      // Close modal & reset
      setShowReceive(false);
      setRcvQty(0);
      setPurchasePrice(0);
      setSalePrice(0);
      setRcvRef('');
      setRcvReason('');
      setRcvLocation('');
      setUseCustomLocation(false);
      if (scanMode) tryFocusSku(true);
    } catch (err: any) {
      alert(err?.message || String(err));
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  };

  // Issue submit
  const submitIssue = async () => {
    if (!found) return alert('Find an item first.');
    if (!mLocation) return alert('Please select a location to issue from.');
    if (!mQty || mQty <= 0) return alert('Quantity must be > 0.');
    const loc = locBalances.find(l => l.name === mLocation);
    if (!loc) return alert('Invalid location.');
    if (loc.qty < mQty) return alert(`Insufficient qty at ${mLocation}. Available: ${loc.qty}`);

    setLoading(true);
    if (submittingRef.current) return;
    submittingRef.current = true;

    try {
      const clientTxId = makeClientTxId();
      const { error } = await supabase.rpc('issue_stock', {
        p_item_id: found.id,
        p_qty: mQty,
        p_ref: mRef || null,
        p_reason: mReason || null,
        p_client_tx_id: clientTxId,
      });
      if (error) throw error;

      // attach location
      await supabase
        .from('stock_moves')
        .update({ location: mLocation })
        .eq('client_tx_id', clientTxId);

      // Auto-sync pricing (keeps last known Purchase/GST/Margin & recomputes sale)
      await syncItemPricing();

      await findBySku();
      await loadHistory();
      alert('Issue saved.');
      setShowIssue(false);
      setMQty(0);
      setMRef('');
      setMReason('');
      setMLocation('');
      if (scanMode) tryFocusSku(true);
    } catch (err: any) {
      alert(err?.message || String(err));
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  };

  // Return submit
  const submitReturn = async () => {
    if (!found) return alert('Find an item first.');
    if (!mLocation) return alert('Please select a location for return.');
    if (!mQty || mQty <= 0) return alert('Quantity must be > 0.');

    setLoading(true);
    if (submittingRef.current) return;
    submittingRef.current = true;

    try {
      const clientTxId = makeClientTxId();
      const { error } = await supabase.rpc('return_stock', {
        p_item_id: found.id,
        p_qty: mQty,
        p_ref: mRef || null,
        p_reason: mReason || null,
        p_client_tx_id: clientTxId,
      });
      if (error) throw error;

      // attach location
      await supabase
        .from('stock_moves')
        .update({ location: mLocation })
        .eq('client_tx_id', clientTxId);

      // Auto-sync pricing
      await syncItemPricing();

      await findBySku();
      await loadHistory();
      alert('Return saved.');
      setShowReturn(false);
      setMQty(0);
      setMRef('');
      setMReason('');
      setMLocation('');
      if (scanMode) tryFocusSku(true);
    } catch (err: any) {
      alert(err?.message || String(err));
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  };

  // Adjust submit
  const submitAdjust = async () => {
    if (!found) return alert('Find an item first.');
    if (!mLocation) return alert('Please select a location for adjust.');
    if (!mQty || mQty === 0) return alert('Adjustment delta cannot be 0.');

    const loc = locBalances.find(l => l.name === mLocation);
    if (!loc) return alert('Invalid location.');
    if (mQty < 0 && loc.qty + mQty < 0) {
      return alert(`This would make "${mLocation}" negative. Available: ${loc.qty}, delta: ${mQty}`);
    }

    setLoading(true);
    if (submittingRef.current) return;
    submittingRef.current = true;

    try {
      const clientTxId = makeClientTxId();
      const { error } = await supabase.rpc('adjust_stock_delta', {
        p_item_id: found.id,
        p_delta: mQty,
        p_ref: mRef || null,
        p_reason: mReason || null,
        p_client_tx_id: clientTxId,
      });
      if (error) throw error;

      // attach location
      await supabase
        .from('stock_moves')
        .update({ location: mLocation })
        .eq('client_tx_id', clientTxId);

      // Auto-sync pricing
      await syncItemPricing();

      await findBySku();
      await loadHistory();
      alert('Adjustment saved.');
      setShowAdjust(false);
      setMQty(0);
      setMRef('');
      setMReason('');
      setMLocation('');
      if (scanMode) tryFocusSku(true);
    } catch (err: any) {
      alert(err?.message || String(err));
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  };

  /* ------------------------- Derived values ------------------------------ */

  // Receive: live sale price calculation when editing purchase/gst/margin
  useEffect(() => {
    const calc = purchasePrice * (1 + (gstPct || 0) / 100) * (1 + (marginPct || 0) / 100);
    if (!Number.isFinite(calc)) return;
    setSalePrice((prev) => {
      const tol = 0.00001;
      if (Math.abs((prev || 0) - calc) < tol) return prev;
      return Number(calc.toFixed(2));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purchasePrice, gstPct, marginPct]);

  const selectedLocQty = useMemo(() => {
    if (!mLocation) return 0;
    const foundLoc = locBalances.find(l => l.name === mLocation);
    return foundLoc?.qty ?? 0;
  }, [locBalances, mLocation]);

  /* ------------------------------ UI ------------------------------------ */

  return (
    <div className="grid md:grid-cols-3 gap-4">
      {/* LEFT: SKU + Actions */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">Stock Operations</h2>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={scanMode} onChange={(e) => setScanMode(e.target.checked)} />
            <span>Scan Mode (auto focus SKU)</span>
          </label>
        </div>

        {/* SKU row */}
        <div className="flex gap-2 mb-3">
          <input
            ref={skuRef}
            className="input"
            placeholder="SKU (scan or type)"
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
        <div className="mb-3">
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
                SKU: <b>{found.sku}</b> • UoM: <b>{found.uom_code || '-'}</b> • Current Qty: <b>{found.stock_qty ?? 0}</b> •{' '}
                Avg Cost: <b>₹ {(found.unit_cost ?? 0).toFixed(2)}</b>
              </>
            ) : (
              <>UoM: — • Current Qty: — • Avg Cost: —</>
            )}
          </div>
        </div>

        {/* Per-location stock */}
        {found && (
          <div className="rounded border p-2 bg-gray-50 mb-3">
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
        <div className="grid grid-cols-3 gap-2 mb-4">
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

        {/* Action buttons */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Button type="button" onClick={() => (found ? setShowReceive(true) : alert('Find an item first.'))}>
            Receive
          </Button>
          <Button
            type="button"
            onClick={() => (found ? setShowAdjust(true) : alert('Find an item first.'))}
            className="bg-amber-500 hover:bg-amber-600 text-white"
          >
            Adjust
          </Button>
          <Button
            type="button"
            onClick={() => (found ? setShowIssue(true) : alert('Find an item first.'))}
            className="bg-red-600 hover:bg-red-700 text-white"
          >
            Issue
          </Button>
          <Button
            type="button"
            onClick={() => (found ? setShowReturn(true) : alert('Find an item first.'))}
            className="bg-green-600 hover:bg-green-700 text-white"
          >
            Return
          </Button>
        </div>
      </div>

      {/* RIGHT: Movements table */}
      <div className="md:col-span-2 card">
        <div className="flex flex-wrap items-end gap-3 mb-3">
          <div className="text-lg font-semibold mr-auto">Recent Stock Movements</div>

          <input
            className="input"
            placeholder="Search (SKU / Item / Type / Ref / Location)…"
            value={movesSearch}
            onChange={(e) => setMovesSearch(e.target.value)}
          />

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
                  <button className="w-full text-left font-semibold" onClick={() => toggleSort('created_at')}>Date {sortKey==='created_at' ? (sortDir==='asc'?'▲':'▼'):'↕'}</button>
                </th>
                <th>
                  <button className="w-full text-left font-semibold" onClick={() => toggleSort('sku')}>Item {sortKey==='sku'?'▲/▼':'↕'}</button>
                </th>
                <th>
                  <button className="w-full text-left font-semibold" onClick={() => toggleSort('move_type')}>Type {sortKey==='move_type' ? (sortDir==='asc'?'▲':'▼'):'↕'}</button>
                </th>
                <th className="text-right">
                  <button className="w-full text-right font-semibold" onClick={() => toggleSort('qty')}>Qty {sortKey==='qty' ? (sortDir==='asc'?'▲':'▼'):'↕'}</button>
                </th>
                <th>
                  <button className="w-full text-left font-semibold" onClick={() => toggleSort('uom_code')}>UoM {sortKey==='uom_code' ? (sortDir==='asc'?'▲':'▼'):'↕'}</button>
                </th>
                <th className="text-right">
                  <button className="w-full text-right font-semibold" onClick={() => toggleSort('unit_cost')}>Unit Cost {sortKey==='unit_cost' ? (sortDir==='asc'?'▲':'▼'):'↕'}</button>
                </th>
                <th className="text-right">
                  <button className="w-full text-right font-semibold" onClick={() => toggleSort('total_cost')}>Total Cost {sortKey==='total_cost' ? (sortDir==='asc'?'▲':'▼'):'↕'}</button>
                </th>
                <th>
                  <button className="w-full text-left font-semibold" onClick={() => toggleSort('ref')}>Ref {sortKey==='ref' ? (sortDir==='asc'?'▲':'▼'):'↕'}</button>
                </th>
                <th>
                  <button className="w-full text-left font-semibold" onClick={() => toggleSort('location')}>Location {sortKey==='location' ? (sortDir==='asc'?'▲':'▼'):'↕'}</button>
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

      {/* ------------------------ RECEIVE MODAL ------------------------- */}
      <Modal
        title={`Receive — ${found?.sku || ''}`}
        open={showReceive}
        onClose={() => setShowReceive(false)}
      >
        {!found ? (
          <div className="text-sm text-gray-600">Find an item first.</div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label">Qty</label>
                <input
                  className="input"
                  type="number"
                  min={1}
                  step="1"
                  value={rcvQty}
                  onChange={(e) => setRcvQty(parseInt(e.target.value || '0', 10))}
                />
              </div>
              <div>
                <label className="label">UoM</label>
                <select
                  className="input"
                  value={rcvUom}
                  onChange={(e) => setRcvUom(e.target.value)}
                >
                  <option value="">(use default {found.uom_code || '-'})</option>
                  {allUoms.map((u) => (
                    <option key={u.code} value={u.code}>
                      {u.code} — {u.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label">Purchase Price (per {rcvUom || found.uom_code || 'UoM'})</label>
                <input
                  className="input"
                  type="number"
                  step="0.01"
                  min={0}
                  value={purchasePrice}
                  onChange={(e) => setPurchasePrice(parseFloat(e.target.value || '0'))}
                />
              </div>
              <div>
                <label className="label">GST %</label>
                <input
                  className="input"
                  type="number"
                  step="0.01"
                  min={0}
                  value={gstPct}
                  onChange={(e) => setGstPct(parseFloat(e.target.value || '0'))}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label">Margin %</label>
                <input
                  className="input"
                  type="number"
                  step="0.01"
                  value={marginPct}
                  onChange={(e) => setMarginPct(parseFloat(e.target.value || '0'))}
                />
              </div>
              <div>
                <label className="label">Selling Price (auto, editable)</label>
                <input
                  className="input"
                  type="number"
                  step="0.01"
                  min={0}
                  value={salePrice}
                  onChange={(e) => setSalePrice(parseFloat(e.target.value || '0'))}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label">Reference (PO# etc.)</label>
                <input className="input" value={rcvRef} onChange={(e) => setRcvRef(e.target.value)} />
              </div>
              <div>
                <label className="label">Reason / Note</label>
                <input className="input" value={rcvReason} onChange={(e) => setRcvReason(e.target.value)} />
              </div>
            </div>

            {/* Location: existing or new */}
            <div>
              <label className="label">Location</label>
              <div className="grid grid-cols-2 gap-2">
                <select
                  className="input"
                  value={useCustomLocation ? '__NEW__' : (rcvLocation || '')}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === '__NEW__') {
                      setUseCustomLocation(true);
                      setRcvLocation('');
                    } else {
                      setUseCustomLocation(false);
                      setRcvLocation(v);
                    }
                  }}
                >
                  <option value="">{locBalances.length ? 'Select existing…' : 'No locations yet'}</option>
                  {locBalances.map((l) => (
                    <option key={l.name} value={l.name}>
                      {l.name} — {l.qty} {found.uom_code || ''}
                    </option>
                  ))}
                  <option value="__NEW__">Other / New…</option>
                </select>
                <input
                  className="input"
                  placeholder="Type new location"
                  value={useCustomLocation ? rcvLocation : ''}
                  onChange={(e) => setRcvLocation(e.target.value)}
                  disabled={!useCustomLocation}
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              <Button type="button" onClick={() => setShowReceive(false)} className="bg-gray-200 hover:bg-gray-300 text-gray-900">
                Cancel
              </Button>
              <Button type="button" onClick={submitReceive} disabled={loading}>
                {loading ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ------------------------ ISSUE MODAL --------------------------- */}
      <Modal
        title={`Issue — ${found?.sku || ''}`}
        open={showIssue}
        onClose={() => setShowIssue(false)}
      >
        {!found ? (
          <div className="text-sm text-gray-600">Find an item first.</div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label">Qty</label>
                <input
                  className="input"
                  type="number"
                  min={1}
                  step="1"
                  value={mQty}
                  onChange={(e) => setMQty(parseInt(e.target.value || '0', 10))}
                />
              </div>
              <div>
                <label className="label">Location</label>
                <select
                  className="input"
                  value={mLocation}
                  onChange={(e) => setMLocation(e.target.value)}
                >
                  <option value="">Select location…</option>
                  {locBalances.map((l) => (
                    <option key={l.name} value={l.name}>
                      {l.name} — {l.qty} {found.uom_code || ''}
                    </option>
                  ))}
                </select>
                {mLocation && (
                  <div className="text-xs text-gray-600 mt-1">
                    Available at <b>{mLocation}</b>: <b>{selectedLocQty}</b> {found?.uom_code || ''}
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label">Reference</label>
                <input className="input" value={mRef} onChange={(e) => setMRef(e.target.value)} />
              </div>
              <div>
                <label className="label">Reason / Note</label>
                <input className="input" value={mReason} onChange={(e) => setMReason(e.target.value)} />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              <Button type="button" onClick={() => setShowIssue(false)} className="bg-gray-200 hover:bg-gray-300 text-gray-900">
                Cancel
              </Button>
              <Button type="button" onClick={submitIssue} disabled={loading}>
                {loading ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ------------------------ RETURN MODAL -------------------------- */}
      <Modal
        title={`Return — ${found?.sku || ''}`}
        open={showReturn}
        onClose={() => setShowReturn(false)}
      >
        {!found ? (
          <div className="text-sm text-gray-600">Find an item first.</div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label">Qty</label>
                <input
                  className="input"
                  type="number"
                  min={1}
                  step="1"
                  value={mQty}
                  onChange={(e) => setMQty(parseInt(e.target.value || '0', 10))}
                />
              </div>
              <div>
                <label className="label">Location</label>
                <select
                  className="input"
                  value={mLocation}
                  onChange={(e) => setMLocation(e.target.value)}
                >
                  <option value="">Select location…</option>
                  {locBalances.map((l) => (
                    <option key={l.name} value={l.name}>
                      {l.name} — {l.qty} {found.uom_code || ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label">Reference</label>
                <input className="input" value={mRef} onChange={(e) => setMRef(e.target.value)} />
              </div>
              <div>
                <label className="label">Reason / Note</label>
                <input className="input" value={mReason} onChange={(e) => setMReason(e.target.value)} />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              <Button type="button" onClick={() => setShowReturn(false)} className="bg-gray-200 hover:bg-gray-300 text-gray-900">
                Cancel
              </Button>
              <Button type="button" onClick={submitReturn} disabled={loading}>
                {loading ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ------------------------ ADJUST MODAL -------------------------- */}
      <Modal
        title={`Adjust — ${found?.sku || ''}`}
        open={showAdjust}
        onClose={() => setShowAdjust(false)}
      >
        {!found ? (
          <div className="text-sm text-gray-600">Find an item first.</div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label">Delta Qty (use negative to reduce)</label>
                <input
                  className="input"
                  type="number"
                  step="1"
                  value={mQty}
                  onChange={(e) => setMQty(parseInt(e.target.value || '0', 10))}
                  placeholder="-2 (lost) or 3 (found)"
                />
              </div>
              <div>
                <label className="label">Location</label>
                <select
                  className="input"
                  value={mLocation}
                  onChange={(e) => setMLocation(e.target.value)}
                >
                  <option value="">Select location…</option>
                  {locBalances.map((l) => (
                    <option key={l.name} value={l.name}>
                      {l.name} — {l.qty} {found.uom_code || ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label">Reference</label>
                <input className="input" value={mRef} onChange={(e) => setMRef(e.target.value)} />
              </div>
              <div>
                <label className="label">Reason / Note</label>
                <input className="input" value={mReason} onChange={(e) => setMReason(e.target.value)} />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              <Button type="button" onClick={() => setShowAdjust(false)} className="bg-gray-200 hover:bg-gray-300 text-gray-900">
                Cancel
              </Button>
              <Button type="button" onClick={submitAdjust} disabled={loading}>
                {loading ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
