'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import Button from '@/components/Button';

/* -------------------------------- Modal -------------------------------- */

function Modal({
  title,
  open,
  onClose,
  children,
  maxWidth = 1000,
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
  unit_cost?: number;
  uom_code?: string;
  low_stock_threshold?: number | null;

  purchase_price?: number | null;
  gst_percent?: number | null;
  margin_percent?: number | null;
  tax_rate?: number | null;
  unit_price?: number | null;
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

/** Bulk Line for multi-row operations */
type BulkLine = {
  /** item id after SKU lookup */
  item_id?: string;
  sku: string;
  name?: string | null;

  uom_code?: string; // default UoM from item, can override in Receive
  qty: number; // positive for receive/issue/return; for adjust can be +/- delta

  /** Pricing (Receive only) */
  purchase_price?: number;
  gst_percent?: number;
  margin_percent?: number;
  selling_price?: number;

  /** Common fields */
  ref?: string;
  reason?: string;

  /** Location fields */
  location?: string;
  useCustomLocation?: boolean; // Receive only
  customLocationText?: string; // Receive only

  /** Per-line location balances after SKU lookup */
  locBalances?: LocBalance[];

  /** Row-level error for validation */
  error?: string | null;
};

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
  /* -------- Global single-item state (unchanged) -------- */
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

  /** NEW: true if any modal is open */
const anyModalOpen = showReceive || showAdjust || showIssue || showReturn;
  
  /* -------- BULK state per modal -------- */
  const [receiveLines, setReceiveLines] = useState<BulkLine[]>([]);
  const [issueLines, setIssueLines] = useState<BulkLine[]>([]);
  const [returnLines, setReturnLines] = useState<BulkLine[]>([]);
  const [adjustLines, setAdjustLines] = useState<BulkLine[]>([]);

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
    // Do not steal focus while modal is open
    if (anyModalOpen) return;
    
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

  /** Load per-location balances for an item (for single view + bulk rows) */
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
      return balances;
    } catch (e) {
      console.warn('loadItemLocations failed:', e);
      setLocBalances([]);
      return [];
    }
  };

  /** Variant that returns balances without mutating the single-item panel */
  const getItemLocations = async (itemId: string): Promise<LocBalance[]> => {
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

        map.set(loc, (map.get(loc) ?? 0) + delta);
      });

      return Array.from(map.entries())
        .map(([name, qty]) => ({ name, qty }))
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch (e) {
      console.warn('getItemLocations failed:', e);
      return [];
    }
  };

  /** Fetch item by SKU (case-insensitive), return FoundItem or null */
  const fetchItemBySku = async (skuStr: string): Promise<FoundItem | null> => {
    const trimmed = skuStr.trim();
    if (!trimmed) return null;

    const { data, error } = await supabase
      .from('items')
      .select(
        'id, sku, name, description, stock_qty, unit_cost, low_stock_threshold, purchase_price, gst_percent, margin_percent, tax_rate, unit_price, uom:units_of_measure ( code )'
      )
      .ilike('sku', trimmed)
      .limit(1);

    if (error) throw error;

    const row: any = (data ?? [])[0];
    if (!row) return null;

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
      gst_percent: row.gst_percent ?? row.tax_rate ?? null,
      margin_percent: row.margin_percent ?? null,
      tax_rate: row.tax_rate ?? null,
      unit_price: row.unit_price ?? null,
    };
    return foundItem;
  };

  const findBySku = async () => {
    setFound(null);
    setLocBalances([]);
    const trimmed = sku.trim();
    if (!trimmed) return alert('Please enter SKU');

    try {
      const foundItem = await fetchItemBySku(trimmed);
      if (!foundItem) return alert('No item found for this SKU');

      setFound(foundItem);
      setMinQty(Number(foundItem.low_stock_threshold ?? 0));

      // Prefill Receive modal from DB values (for single-line convenience)
      // — these now only serve as defaults when creating first line in bulk modal
      await loadItemLocations(foundItem.id);

      requestAnimationFrame(() => skuRef.current?.focus());
    } catch (e: any) {
      alert(e?.message || String(e));
    }
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

  /* ------------------------- Pricing sync ------------------------- */

  /** Sync pricing on items row (bulk-safe) */
  const syncItemPricingFor = async (itemId: string, opts?: {
    purchase?: number | null;
    gst?: number | null;
    margin?: number | null;
    sale?: number | null;
  }) => {
    const purchase = Number.isFinite(opts?.purchase ?? NaN) ? Number(opts?.purchase) : 0;
    const gst = Number.isFinite(opts?.gst ?? NaN) ? Number(opts?.gst) : 0;
    const margin = Number.isFinite(opts?.margin ?? NaN) ? Number(opts?.margin) : 0;

    const computedSale = Number(
      ( (Number.isFinite(opts?.sale ?? NaN) && Number(opts?.sale) > 0)
          ? Number(opts?.sale)
          : (purchase * (1 + (gst || 0) / 100) * (1 + (margin || 0) / 100))
      ).toFixed(2)
    );

    const { error } = await supabase
      .from('items')
      .update({
        purchase_price: Number.isFinite(purchase) ? purchase : 0,
        gst_percent: Number.isFinite(gst) ? gst : 0,
        margin_percent: Number.isFinite(margin) ? margin : 0,
        tax_rate: Number.isFinite(gst) ? gst : 0,
        unit_price: Number.isFinite(computedSale) ? computedSale : 0,
      })
      .eq('id', itemId);

    if (error) throw error;
  };

  /* ------------------------------ BULK helpers -------------------------------- */

  const addReceiveLine = (seed?: Partial<BulkLine>) => {
    setReceiveLines(prev => [
      ...prev,
      {
        sku: seed?.sku || '',
        qty: seed?.qty ?? 0,
        uom_code: seed?.uom_code || '',
        purchase_price: seed?.purchase_price ?? 0,
        gst_percent: seed?.gst_percent ?? 0,
        margin_percent: seed?.margin_percent ?? 0,
        selling_price: seed?.selling_price ?? 0,
        ref: seed?.ref || '',
        reason: seed?.reason || '',
        location: seed?.location || '',
        useCustomLocation: false,
        customLocationText: '',
        error: null,
      },
    ]);
  };

  const addIssueLine = (seed?: Partial<BulkLine>) => {
    setIssueLines(prev => [
      ...prev,
      {
        sku: seed?.sku || '',
        qty: seed?.qty ?? 0,
        ref: seed?.ref || '',
        reason: seed?.reason || '',
        location: seed?.location || '',
        error: null,
      },
    ]);
  };

  const addReturnLine = (seed?: Partial<BulkLine>) => {
    setReturnLines(prev => [
      ...prev,
      {
        sku: seed?.sku || '',
        qty: seed?.qty ?? 0,
        ref: seed?.ref || '',
        reason: seed?.reason || '',
        location: seed?.location || '',
        error: null,
      },
    ]);
  };

  const addAdjustLine = (seed?: Partial<BulkLine>) => {
    setAdjustLines(prev => [
      ...prev,
      {
        sku: seed?.sku || '',
        qty: seed?.qty ?? 0, // can be negative
        ref: seed?.ref || '',
        reason: seed?.reason || '',
        location: seed?.location || '',
        error: null,
      },
    ]);
  };

  const removeLine = (kind: MoveType, idx: number) => {
    if (kind === 'receive') setReceiveLines(prev => prev.filter((_, i) => i !== idx));
    if (kind === 'issue') setIssueLines(prev => prev.filter((_, i) => i !== idx));
    if (kind === 'return') setReturnLines(prev => prev.filter((_, i) => i !== idx));
    if (kind === 'adjust') setAdjustLines(prev => prev.filter((_, i) => i !== idx));
  };

  const updateLineField = (
    kind: MoveType,
    idx: number,
    key: keyof BulkLine,
    value: any
  ) => {
    const setFn = (setter: React.Dispatch<React.SetStateAction<BulkLine[]>>) => {
      setter(prev => prev.map((ln, i) => (i === idx ? { ...ln, [key]: value, error: null } : ln)));
    };
    if (kind === 'receive') setFn(setReceiveLines);
    if (kind === 'issue') setFn(setIssueLines);
    if (kind === 'return') setFn(setReturnLines);
    if (kind === 'adjust') setFn(setAdjustLines);
  };

  const bulkFindSku = async (kind: MoveType, idx: number) => {
    const list = kind === 'receive' ? receiveLines
              : kind === 'issue'   ? issueLines
              : kind === 'return'  ? returnLines
              : adjustLines;
    const line = list[idx];
    const skuStr = (line?.sku || '').trim();
    if (!skuStr) {
      updateLineField(kind, idx, 'error', 'Please enter SKU.');
      return;
    }

    try {
      const item = await fetchItemBySku(skuStr);
      if (!item) {
        updateLineField(kind, idx, 'error', 'No item found for this SKU.');
        return;
      }

      const balances = await getItemLocations(item.id);

      const updater = (setter: React.Dispatch<React.SetStateAction<BulkLine[]>>) => {
        setter(prev => prev.map((ln, i) => {
          if (i !== idx) return ln;
          // defaults for receive pricing from DB if available
          const purchase = Number(item.purchase_price ?? item.unit_cost ?? 0);
          const gst = Number(item.gst_percent ?? item.tax_rate ?? 0);
          const margin = Number(item.margin_percent ?? 0);
          const sale = Number((purchase * (1 + (gst || 0) / 100) * (1 + (margin || 0) / 100)).toFixed(2));
          return {
            ...ln,
            item_id: item.id,
            sku: item.sku,
            name: item.name ?? '',
            uom_code: item.uom_code || '',
            // Only initialize receive fields if undefined or zero
            purchase_price: (ln.purchase_price ?? 0) || purchase,
            gst_percent: (ln.gst_percent ?? 0) || gst,
            margin_percent: (ln.margin_percent ?? 0) || margin,
            selling_price: (ln.selling_price ?? 0) || sale,
            locBalances: balances,
            error: null,
          };
        }));
      };

      if (kind === 'receive') updater(setReceiveLines);
      if (kind === 'issue') updater(setIssueLines);
      if (kind === 'return') updater(setReturnLines);
      if (kind === 'adjust') updater(setAdjustLines);
    } catch (e: any) {
      updateLineField(kind, idx, 'error', e?.message || String(e));
    }
  };

  const clearBulk = (kind: MoveType) => {
    if (kind === 'receive') setReceiveLines([]);
    if (kind === 'issue') setIssueLines([]);
    if (kind === 'return') setReturnLines([]);
    if (kind === 'adjust') setAdjustLines([]);
  };

  /* ----------------------------- Submit: BULK -------------------------------- */

  const submitReceiveBulk = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setLoading(true);

    // Basic validation
    const errors: string[] = [];
    const validLines = receiveLines.map((ln, idx) => {
      const uomCode = ln.uom_code || '';
      const loc =
        (ln.useCustomLocation ? (ln.customLocationText || '').trim() : (ln.location || '').trim()) || '';

      let err = '';
      if (!ln.sku) err = 'SKU required';
      else if (!ln.item_id) err = 'Click Find to load item';
      else if (!ln.qty || ln.qty <= 0) err = 'Qty must be > 0';
      else if (!Number.isFinite(ln.purchase_price)) err = 'Purchase price required';
      if (err) {
        errors.push(`Row ${idx + 1} (${ln.sku}): ${err}`);
      }
      return { ln, idx, uomCode, loc };
    });

    if (errors.length) {
      alert('Please fix the following:\n' + errors.join('\n'));
      setLoading(false);
      submittingRef.current = false;
      return;
    }

    const results: string[] = [];
    try {
      for (const { ln, idx, uomCode, loc } of validLines) {
        const clientTxId = makeClientTxId();

        // 1) Receive
        const { error } = await supabase.rpc('receive_stock_avg', {
          p_item_id: ln.item_id!,
          p_qty: ln.qty,
          p_unit_cost: Number(ln.purchase_price ?? 0),
          p_uom_code: uomCode || null,
          p_ref: (ln.ref || null),
          p_reason: (ln.reason || null),
          p_client_tx_id: clientTxId,
        });
        if (error) {
          results.push(`❌ Row ${idx + 1} (${ln.sku}): ${error.message}`);
          continue;
        }

        // 2) Location
        if (loc) {
          try {
            await supabase
              .from('stock_moves')
              .update({ location: loc })
              .eq('client_tx_id', clientTxId);
          } catch (e: any) {
            results.push(`⚠️ Row ${idx + 1} (${ln.sku}): received but location not saved (${e?.message || e})`);
          }
        }

        // 3) Sync pricing on item
        try {
          await syncItemPricingFor(ln.item_id!, {
            purchase: Number(ln.purchase_price ?? 0),
            gst: Number(ln.gst_percent ?? 0),
            margin: Number(ln.margin_percent ?? 0),
            sale: Number(ln.selling_price ?? 0),
          });
        } catch (e: any) {
          results.push(`⚠️ Row ${idx + 1} (${ln.sku}): received but pricing not updated (${e?.message || e})`);
        }

        results.push(`✅ Row ${idx + 1} (${ln.sku}): received ${ln.qty} ${uomCode || ''}`);
      }

      await loadHistory();
      if (found?.id) await loadItemLocations(found.id);
      alert(results.join('\n'));

      // Close and reset
      setShowReceive(false);
      clearBulk('receive');
      if (scanMode) tryFocusSku(true);
    } catch (e: any) {
      alert(e?.message || String(e));
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  };

  const submitIssueBulk = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setLoading(true);

    // Validate lines and location availability
    const errors: string[] = [];
    const validLines = issueLines.map((ln, idx) => {
      let err = '';
      if (!ln.sku) err = 'SKU required';
      else if (!ln.item_id) err = 'Click Find to load item';
      else if (!ln.location) err = 'Select location';
      else if (!ln.qty || ln.qty <= 0) err = 'Qty must be > 0';

      const locQty = (ln.locBalances || []).find(l => l.name === ln.location)?.qty ?? 0;
      if (!err && ln.qty > locQty) err = `Insufficient qty at ${ln.location}. Available: ${locQty}`;

      if (err) errors.push(`Row ${idx + 1} (${ln.sku}): ${err}`);
      return { ln, idx };
    });

    if (errors.length) {
      alert('Please fix the following:\n' + errors.join('\n'));
      setLoading(false);
      submittingRef.current = false;
      return;
    }

    const results: string[] = [];
    try {
      for (const { ln, idx } of validLines) {
        const clientTxId = makeClientTxId();
        const { error } = await supabase.rpc('issue_stock', {
          p_item_id: ln.item_id!,
          p_qty: ln.qty,
          p_ref: (ln.ref || null),
          p_reason: (ln.reason || null),
          p_client_tx_id: clientTxId,
        });
        if (error) {
          results.push(`❌ Row ${idx + 1} (${ln.sku}): ${error.message}`);
          continue;
        }

        // attach location
        try {
          await supabase
            .from('stock_moves')
            .update({ location: ln.location })
            .eq('client_tx_id', clientTxId);
        } catch (e: any) {
          results.push(`⚠️ Row ${idx + 1} (${ln.sku}): issued but location not saved (${e?.message || e})`);
        }

        // Keep pricing in sync (no changes—recompute sale from last)
        try {
          await syncItemPricingFor(ln.item_id!);
        } catch {}

        results.push(`✅ Row ${idx + 1} (${ln.sku}): issued ${ln.qty} from ${ln.location}`);
      }

      await loadHistory();
      if (found?.id) await loadItemLocations(found.id);
      alert(results.join('\n'));

      setShowIssue(false);
      clearBulk('issue');
      if (scanMode) tryFocusSku(true);
    } catch (e: any) {
      alert(e?.message || String(e));
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  };

  const submitReturnBulk = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setLoading(true);

    // Validate
    const errors: string[] = [];
    const validLines = returnLines.map((ln, idx) => {
      let err = '';
      if (!ln.sku) err = 'SKU required';
      else if (!ln.item_id) err = 'Click Find to load item';
      else if (!ln.location) err = 'Select location';
      else if (!ln.qty || ln.qty <= 0) err = 'Qty must be > 0';
      if (err) errors.push(`Row ${idx + 1} (${ln.sku}): ${err}`);
      return { ln, idx };
    });

    if (errors.length) {
      alert('Please fix the following:\n' + errors.join('\n'));
      setLoading(false);
      submittingRef.current = false;
      return;
    }

    const results: string[] = [];
    try {
      for (const { ln, idx } of validLines) {
        const clientTxId = makeClientTxId();
        const { error } = await supabase.rpc('return_stock', {
          p_item_id: ln.item_id!,
          p_qty: ln.qty,
          p_ref: (ln.ref || null),
          p_reason: (ln.reason || null),
          p_client_tx_id: clientTxId,
        });
        if (error) {
          results.push(`❌ Row ${idx + 1} (${ln.sku}): ${error.message}`);
          continue;
        }

        // attach location
        try {
          await supabase
            .from('stock_moves')
            .update({ location: ln.location })
            .eq('client_tx_id', clientTxId);
        } catch (e: any) {
          results.push(`⚠️ Row ${idx + 1} (${ln.sku}): returned but location not saved (${e?.message || e})`);
        }

        // Sync pricing (no change)
        try {
          await syncItemPricingFor(ln.item_id!);
        } catch {}

        results.push(`✅ Row ${idx + 1} (${ln.sku}): returned ${ln.qty} to ${ln.location}`);
      }

      await loadHistory();
      if (found?.id) await loadItemLocations(found.id);
      alert(results.join('\n'));

      setShowReturn(false);
      clearBulk('return');
      if (scanMode) tryFocusSku(true);
    } catch (e: any) {
      alert(e?.message || String(e));
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  };

  const submitAdjustBulk = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setLoading(true);

    // Validate & location negative check
    const errors: string[] = [];
    const validLines = adjustLines.map((ln, idx) => {
      let err = '';
      if (!ln.sku) err = 'SKU required';
      else if (!ln.item_id) err = 'Click Find to load item';
      else if (!ln.location) err = 'Select location';
      else if (!ln.qty || ln.qty === 0) err = 'Adjustment delta cannot be 0';

      const currentLocQty = (ln.locBalances || []).find(l => l.name === ln.location)?.qty ?? 0;
      if (!err && ln.qty < 0 && currentLocQty + ln.qty < 0) {
        err = `This would make "${ln.location}" negative. Available: ${currentLocQty}, delta: ${ln.qty}`;
      }

      if (err) errors.push(`Row ${idx + 1} (${ln.sku}): ${err}`);
      return { ln, idx };
    });

    if (errors.length) {
      alert('Please fix the following:\n' + errors.join('\n'));
      setLoading(false);
      submittingRef.current = false;
      return;
    }

    const results: string[] = [];
    try {
      for (const { ln, idx } of validLines) {
        const clientTxId = makeClientTxId();
        const { error } = await supabase.rpc('adjust_stock_delta', {
          p_item_id: ln.item_id!,
          p_delta: ln.qty,
          p_ref: (ln.ref || null),
          p_reason: (ln.reason || null),
          p_client_tx_id: clientTxId,
        });
        if (error) {
          results.push(`❌ Row ${idx + 1} (${ln.sku}): ${error.message}`);
          continue;
        }

        // attach location
        try {
          await supabase
            .from('stock_moves')
            .update({ location: ln.location })
            .eq('client_tx_id', clientTxId);
        } catch (e: any) {
          results.push(`⚠️ Row ${idx + 1} (${ln.sku}): adjusted but location not saved (${e?.message || e})`);
        }

        // Sync pricing (no change)
        try {
          await syncItemPricingFor(ln.item_id!);
        } catch {}

        results.push(`✅ Row ${idx + 1} (${ln.sku}): adjusted by ${ln.qty} at ${ln.location}`);
      }

      await loadHistory();
      if (found?.id) await loadItemLocations(found.id);
      alert(results.join('\n'));

      setShowAdjust(false);
      clearBulk('adjust');
      if (scanMode) tryFocusSku(true);
    } catch (e: any) {
      alert(e?.message || String(e));
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  };

  /* ------------------------- Derived values ------------------------------ */

  const selectedLocQty = useMemo(() => {
    if (!found) return 0;
    // keep single-item helper
    return 0;
  }, [locBalances, found]);

  /* ------------------------------ UI ------------------------------------ */

/** Helper: renders a SKU row cell with Find button (local state + keeps focus) */
function SkuCell({
  kind, idx, line, placeholder = 'SKU…'
}: { kind: MoveType; idx: number; line: BulkLine; placeholder?: string }) {
  const skuInputRef = React.useRef<HTMLInputElement>(null);

  // Keep what the user is typing locally (prevents re-mounts on every key)
  const [localSku, setLocalSku] = React.useState<string>(line.sku ?? '');

  // If parent updates the SKU (e.g., after Find fills actual SKU), sync it into local
  React.useEffect(() => {
    setLocalSku(line.sku ?? '');
  }, [line.sku]);

  // Push the local value to parent state
  const commitSkuToParent = React.useCallback(() => {
    if (localSku !== (line.sku ?? '')) {
      updateLineField(kind, idx, 'sku', localSku);
    }
  }, [kind, idx, localSku, line.sku]);

  return (
    <div className="flex items-center gap-1 w-full min-w-[300px]">
      <input
        ref={skuInputRef}
        className="input flex-1 min-w-0 h-9"
        type="text"
        inputMode="text"
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        value={localSku}
        onChange={(e) => {
          setLocalSku(e.target.value);
          // keep caret in the same box
          requestAnimationFrame(() => skuInputRef.current?.focus());
        }}
        onBlur={() => {
          commitSkuToParent();
          // while modal open, keep focus inside the field if you want
          if (anyModalOpen) requestAnimationFrame(() => skuInputRef.current?.focus());
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commitSkuToParent();
            bulkFindSku(kind, idx);
            requestAnimationFrame(() => skuInputRef.current?.focus());
          }
        }}
      />

      {/* Use plain <button> and do NOT let it take focus */}
      <button
        type="button"
        className="inline-flex items-center rounded bg-orange-500 hover:bg-orange-600 text-white px-3 py-2 text-sm"
        onMouseDown={(e) => e.preventDefault()}   // <- critical so focus stays in input
        onClick={() => {
          commitSkuToParent();
          bulkFindSku(kind, idx);
          requestAnimationFrame(() => skuInputRef.current?.focus());
        }}
      >
        Find
      </button>
    </div>
  );
}

  /** Helper: Location picker for Receive (with custom) and for others (select only) */
  function LocationCell({
    kind, idx, line
  }: { kind: MoveType; idx: number; line: BulkLine }) {
    if (kind === 'receive') {
      const options = line.locBalances || [];
      const currentVal = line.useCustomLocation ? '__NEW__' : (line.location || '');
      return (
        <div className="grid grid-cols-2 gap-1">
          <select
            className="input"
            value={currentVal}
            onChange={(e) => {
              const v = e.target.value;
              if (v === '__NEW__') {
                updateLineField(kind, idx, 'useCustomLocation', true);
                updateLineField(kind, idx, 'location', '');
              } else {
                updateLineField(kind, idx, 'useCustomLocation', false);
                updateLineField(kind, idx, 'location', v);
              }
            }}
          >
            <option value="">{options.length ? 'Select existing…' : 'No locations yet'}</option>
            {options.map(l => (
              <option key={l.name} value={l.name}>
                {l.name} — {l.qty}
              </option>
            ))}
            <option value="__NEW__">Other / New…</option>
          </select>
          <input
            className="input"
            placeholder="Type new location"
            value={line.useCustomLocation ? (line.customLocationText || '') : ''}
            onChange={(e) => updateLineField(kind, idx, 'customLocationText', e.target.value)}
            disabled={!line.useCustomLocation}
          />
        </div>
      );
    }

    // For Issue/Return/Adjust: select only
    const options = line.locBalances || [];
    return (
      <select
        className="input"
        value={line.location || ''}
        onChange={(e) => updateLineField(kind, idx, 'location', e.target.value)}
      >
        <option value="">Select location…</option>
        {options.map(l => (
          <option key={l.name} value={l.name}>
            {l.name} — {l.qty}
          </option>
        ))}
      </select>
    );
  }

  /** Render row-level error (if any) */
  function RowError({ line }: { line: BulkLine }) {
    if (!line.error) return null;
    return <div className="text-xs text-red-600 mt-1">{line.error}</div>;
  }

  return (
    <div className="grid md:grid-cols-3 gap-4">

   {/* Back to Dashboard (full width row, left-aligned) */}
<div className="col-span-full mb-2">
  <Link
    href="/dashboard"
    className="inline-flex items-center rounded border border-orange-600 px-3 py-1.5 text-sm font-semibold text-orange-700 hover:bg-orange-50"
    aria-label="Back to Dashboard"
  >
    ← Back to Dashboard
  </Link>
</div>
    
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
            disabled={anyModalOpen}        // ← add this line
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
            <Button type="button" onClick={async () => {
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
            }} disabled={!found || savingMin}>
              {savingMin ? 'Saving…' : 'Save Min'}
            </Button>
          </div>
        </div>

        {/* Action buttons */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Button
            type="button"
            onClick={async () => {
              // seed first line with found (optional)
              const seed = found ? {
                sku: found.sku,
                uom_code: found.uom_code || '',
                purchase_price: Number(found.purchase_price ?? found.unit_cost ?? 0),
                gst_percent: Number(found.gst_percent ?? found.tax_rate ?? 0),
                margin_percent: Number(found.margin_percent ?? 0),
                selling_price: Number((Number(found.purchase_price ?? found.unit_cost ?? 0)
                  * (1 + Number(found.gst_percent ?? found.tax_rate ?? 0) / 100)
                  * (1 + Number(found.margin_percent ?? 0) / 100)).toFixed(2)),
              } : undefined;

              setReceiveLines([]);
              if (seed) {
                addReceiveLine(seed);
                // auto-find to populate item_id + loc balances
                setTimeout(() => bulkFindSku('receive', 0), 0);
              } else {
                addReceiveLine();
              }
              setShowReceive(true);
            }}
          >
            Receive
          </Button>

          <Button
            type="button"
            onClick={() => {
              setAdjustLines([]);
              if (found) {
                addAdjustLine({ sku: found.sku });
                setTimeout(() => bulkFindSku('adjust', 0), 0);
              } else {
                addAdjustLine();
              }
              setShowAdjust(true);
            }}
            className="bg-amber-500 hover:bg-amber-600 text-white"
          >
            Adjust
          </Button>

          <Button
            type="button"
            onClick={() => {
              setIssueLines([]);
              if (found) {
                addIssueLine({ sku: found.sku });
                setTimeout(() => bulkFindSku('issue', 0), 0);
              } else {
                addIssueLine();
              }
              setShowIssue(true);
            }}
            className="bg-red-600 hover:bg-red-700 text-white"
          >
            Issue
          </Button>

          <Button
            type="button"
            onClick={() => {
              setReturnLines([]);
              if (found) {
                addReturnLine({ sku: found.sku });
                setTimeout(() => bulkFindSku('return', 0), 0);
              } else {
                addReturnLine();
              }
              setShowReturn(true);
            }}
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

      {/* ------------------------ RECEIVE (BULK) MODAL ------------------------- */}
      <Modal
        title="Receive — Bulk"
        open={showReceive}
        onClose={() => setShowReceive(false)}
      >
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-600">
              Tip: Fill SKU and click <b>Find</b> to load item details and locations. Add as many lines as you need.
            </div>
            <div className="flex gap-2">
              <Button type="button" onClick={() => addReceiveLine()}>Add Line</Button>
              <Button type="button" className="bg-gray-200 hover:bg-gray-300 text-gray-900" onClick={() => clearBulk('receive')}>Clear</Button>
            </div>
          </div>

          <div className="overflow-auto">
            <table className="table w-full">
              <thead>
                <tr>
                  <th>#</th>
                  <th>SKU</th>
                  <th>Item</th>
                  <th>Qty</th>
                  <th>UoM</th>
                  <th>Purchase</th>
                  <th>GST%</th>
                  <th>Margin%</th>
                  <th>Selling</th>
                  <th>Ref</th>
                  <th>Reason</th>
                  <th style={{minWidth: 150}}>Location</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {receiveLines.length === 0 ? (
                  <tr><td colSpan={13} className="p-3 text-sm text-gray-600">No lines. Click “Add Line”.</td></tr>
                ) : receiveLines.map((ln, idx) => (
                  <tr key={idx}>
                    <td>{idx + 1}</td>
                    <td style={{ minWidth: 260 }}>
                      <SkuCell kind="receive" idx={idx} line={ln} />
                      <RowError line={ln} />
                    </td>
                    <td style={{maxWidth: 220}}>
                      <div className="text-sm truncate" title={ln.name || ''}>{ln.name || '—'}</div>
                    </td>
                    <td>
                      <input
                        className="input w-100"
                        type="number"
                        min={1}
                        step="1"
                        value={ln.qty || 0}
                        onChange={(e) => updateLineField('receive', idx, 'qty', parseInt(e.target.value || '0', 10))}
                      />
                    </td>
                    <td>
                      <select
                        className="input w-100"
                        value={ln.uom_code || ''}
                        onChange={(e) => updateLineField('receive', idx, 'uom_code', e.target.value)}
                      >
                        <option value="">(default)</option>
                        {allUoms.map(u => (
                          <option key={u.code} value={u.code}>{u.code} — {u.name}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        className="input w-100"
                        type="number"
                        step="0.01"
                        min={0}
                        value={ln.purchase_price ?? 0}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value || '0');
                          updateLineField('receive', idx, 'purchase_price', v);
                          // auto compute selling
                          const sale = Number((v * (1 + (Number(ln.gst_percent || 0) / 100)) * (1 + (Number(ln.margin_percent || 0) / 100))).toFixed(2));
                          updateLineField('receive', idx, 'selling_price', sale);
                        }}
                      />
                    </td>
                    <td>
                      <input
                        className="input w-100"
                        type="number"
                        step="0.01"
                        min={0}
                        value={ln.gst_percent ?? 0}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value || '0');
                          updateLineField('receive', idx, 'gst_percent', v);
                          const sale = Number(((Number(ln.purchase_price || 0)) * (1 + (v / 100)) * (1 + (Number(ln.margin_percent || 0) / 100))).toFixed(2));
                          updateLineField('receive', idx, 'selling_price', sale);
                        }}
                      />
                    </td>
                    <td>
                      <input
                        className="input w-100"
                        type="number"
                        step="0.01"
                        value={ln.margin_percent ?? 0}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value || '0');
                          updateLineField('receive', idx, 'margin_percent', v);
                          const sale = Number(((Number(ln.purchase_price || 0)) * (1 + (Number(ln.gst_percent || 0) / 100)) * (1 + (v / 100))).toFixed(2));
                          updateLineField('receive', idx, 'selling_price', sale);
                        }}
                      />
                    </td>
                    <td>
                      <input
                        className="input w-100"
                        type="number"
                        step="0.01"
                        min={0}
                        value={ln.selling_price ?? 0}
                        onChange={(e) => updateLineField('receive', idx, 'selling_price', parseFloat(e.target.value || '0'))}
                      />
                    </td>
                    <td>
                      <input
                        className="input w-100"
                        value={ln.ref || ''}
                        onChange={(e) => updateLineField('receive', idx, 'ref', e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        className="input w-100"
                        value={ln.reason || ''}
                        onChange={(e) => updateLineField('receive', idx, 'reason', e.target.value)}
                      />
                    </td>
                    <td>
                      <LocationCell kind="receive" idx={idx} line={ln} />
                    </td>
                    <td>
                      <Button type="button" className="bg-gray-200 hover:bg-gray-300 text-gray-900" onClick={() => removeLine('receive', idx)}>Remove</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button type="button" onClick={() => setShowReceive(false)} className="bg-gray-200 hover:bg-gray-300 text-gray-900">
              Cancel
            </Button>
            <Button type="button" onClick={submitReceiveBulk} disabled={loading}>
              {loading ? 'Saving…' : 'Save All'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ------------------------ ISSUE (BULK) MODAL --------------------------- */}
      <Modal
        title="Issue — Bulk"
        open={showIssue}
        onClose={() => setShowIssue(false)}
      >
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-600">
              Enter multiple SKUs, select locations, and quantities to issue.
            </div>
            <div className="flex gap-2">
              <Button type="button" onClick={() => addIssueLine()}>Add Line</Button>
              <Button type="button" className="bg-gray-200 hover:bg-gray-300 text-gray-900" onClick={() => clearBulk('issue')}>Clear</Button>
            </div>
          </div>

          <div className="overflow-auto">
            <table className="table w-full">
              <thead>
                <tr>
                  <th>#</th>
                  <th>SKU</th>
                  <th>Item</th>
                  <th>Qty</th>
                  <th>Location</th>
                  <th>Ref</th>
                  <th>Reason</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {issueLines.length === 0 ? (
                  <tr><td colSpan={8} className="p-3 text-sm text-gray-600">No lines. Click “Add Line”.</td></tr>
                ) : issueLines.map((ln, idx) => (
                  <tr key={idx}>
                    <td>{idx + 1}</td>
                    <td style={{ minWidth: 260 }}>
                      <SkuCell kind="issue" idx={idx} line={ln} />
                      <RowError line={ln} />
                    </td>
                    <td style={{maxWidth: 220}}>
                      <div className="text-sm truncate" title={ln.name || ''}>{ln.name || '—'}</div>
                    </td>
                    <td>
                      <input
                        className="input w-100"
                        type="number"
                        min={1}
                        step="1"
                        value={ln.qty || 0}
                        onChange={(e) => updateLineField('issue', idx, 'qty', parseInt(e.target.value || '0', 10))}
                      />
                    </td>
                    <td>
                      <LocationCell kind="issue" idx={idx} line={ln} />
                    </td>
                    <td>
                      <input
                        className="input w-100"
                        value={ln.ref || ''}
                        onChange={(e) => updateLineField('issue', idx, 'ref', e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        className="input w-100"
                        value={ln.reason || ''}
                        onChange={(e) => updateLineField('issue', idx, 'reason', e.target.value)}
                      />
                    </td>
                    <td>
                      <Button type="button" className="bg-gray-200 hover:bg-gray-300 text-gray-900" onClick={() => removeLine('issue', idx)}>Remove</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button type="button" onClick={() => setShowIssue(false)} className="bg-gray-200 hover:bg-gray-300 text-gray-900">
              Cancel
            </Button>
            <Button type="button" onClick={submitIssueBulk} disabled={loading}>
              {loading ? 'Saving…' : 'Save All'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ------------------------ RETURN (BULK) MODAL -------------------------- */}
      <Modal
        title="Return — Bulk"
        open={showReturn}
        onClose={() => setShowReturn(false)}
      >
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-600">
              Enter multiple SKUs, select the location to return into, and quantities.
            </div>
            <div className="flex gap-2">
              <Button type="button" onClick={() => addReturnLine()}>Add Line</Button>
              <Button type="button" className="bg-gray-200 hover:bg-gray-300 text-gray-900" onClick={() => clearBulk('return')}>Clear</Button>
            </div>
          </div>

          <div className="overflow-auto">
            <table className="table w-full">
              <thead>
                <tr>
                  <th>#</th>
                  <th>SKU</th>
                  <th>Item</th>
                  <th>Qty</th>
                  <th>Location</th>
                  <th>Ref</th>
                  <th>Reason</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {returnLines.length === 0 ? (
                  <tr><td colSpan={8} className="p-3 text-sm text-gray-600">No lines. Click “Add Line”.</td></tr>
                ) : returnLines.map((ln, idx) => (
                  <tr key={idx}>
                    <td>{idx + 1}</td>
                    <td style={{ minWidth: 260 }}>
                      <SkuCell kind="return" idx={idx} line={ln} />
                      <RowError line={ln} />
                    </td>
                    <td style={{maxWidth: 220}}>
                      <div className="text-sm truncate" title={ln.name || ''}>{ln.name || '—'}</div>
                    </td>
                    <td>
                      <input
                        className="input w-100"
                        type="number"
                        min={1}
                        step="1"
                        value={ln.qty || 0}
                        onChange={(e) => updateLineField('return', idx, 'qty', parseInt(e.target.value || '0', 10))}
                      />
                    </td>
                    <td>
                      <LocationCell kind="return" idx={idx} line={ln} />
                    </td>
                    <td>
                      <input
                        className="input w-100"
                        value={ln.ref || ''}
                        onChange={(e) => updateLineField('return', idx, 'ref', e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        className="input w-100"
                        value={ln.reason || ''}
                        onChange={(e) => updateLineField('return', idx, 'reason', e.target.value)}
                      />
                    </td>
                    <td>
                      <Button type="button" className="bg-gray-200 hover:bg-gray-300 text-gray-900" onClick={() => removeLine('return', idx)}>Remove</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button type="button" onClick={() => setShowReturn(false)} className="bg-gray-200 hover:bg-gray-300 text-gray-900">
              Cancel
            </Button>
            <Button type="button" onClick={submitReturnBulk} disabled={loading}>
              {loading ? 'Saving…' : 'Save All'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ------------------------ ADJUST (BULK) MODAL -------------------------- */}
      <Modal
        title="Adjust — Bulk"
        open={showAdjust}
        onClose={() => setShowAdjust(false)}
      >
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-600">
              Positive delta increases stock, negative delta decreases stock. Location negative check is enforced per row.
            </div>
            <div className="flex gap-2">
              <Button type="button" onClick={() => addAdjustLine()}>Add Line</Button>
              <Button type="button" className="bg-gray-200 hover:bg-gray-300 text-gray-900" onClick={() => clearBulk('adjust')}>Clear</Button>
            </div>
          </div>

          <div className="overflow-auto">
            <table className="table w-full">
              <thead>
                <tr>
                  <th>#</th>
                  <th>SKU</th>
                  <th>Item</th>
                  <th>Delta Qty</th>
                  <th>Location</th>
                  <th>Ref</th>
                  <th>Reason</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {adjustLines.length === 0 ? (
                  <tr><td colSpan={8} className="p-3 text-sm text-gray-600">No lines. Click “Add Line”.</td></tr>
                ) : adjustLines.map((ln, idx) => (
                  <tr key={idx}>
                    <td>{idx + 1}</td>
                    <td style={{ minWidth: 260 }}>
                      <SkuCell kind="adjust" idx={idx} line={ln} />
                      <RowError line={ln} />
                    </td>
                    <td style={{maxWidth: 220}}>
                      <div className="text-sm truncate" title={ln.name || ''}>{ln.name || '—'}</div>
                    </td>
                    <td>
                      <input
                        className="input w-100"
                        type="number"
                        step="1"
                        value={ln.qty || 0}
                        onChange={(e) => updateLineField('adjust', idx, 'qty', parseInt(e.target.value || '0', 10))}
                        placeholder="-2 (lost) or 3 (found)"
                      />
                    </td>
                    <td>
                      <LocationCell kind="adjust" idx={idx} line={ln} />
                    </td>
                    <td>
                      <input
                        className="input w-100"
                        value={ln.ref || ''}
                        onChange={(e) => updateLineField('adjust', idx, 'ref', e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        className="input w-100"
                        value={ln.reason || ''}
                        onChange={(e) => updateLineField('adjust', idx, 'reason', e.target.value)}
                      />
                    </td>
                    <td>
                      <Button type="button" className="bg-gray-200 hover:bg-gray-300 text-gray-900" onClick={() => removeLine('adjust', idx)}>Remove</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button type="button" onClick={() => setShowAdjust(false)} className="bg-gray-200 hover:bg-gray-300 text-gray-900">
              Cancel
            </Button>
            <Button type="button" onClick={submitAdjustBulk} disabled={loading}>
              {loading ? 'Saving…' : 'Save All'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
