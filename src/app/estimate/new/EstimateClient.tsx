'use client';

export const dynamic = 'force-dynamic';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import Button from '@/components/Button';
import Protected from '@/components/Protected';

/* =============================
   Minimal types for Estimate UI
   ============================= */

interface Customer {
  id: string;
  first_name: string;
  last_name: string;
  phone?: string | null;
  street_name?: string | null;
  village_town?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
}

interface ItemDb {
  id: string;
  sku: string;
  name: string;
  unit_cost: number;
  tax_rate?: number | null;      // fallback for GST if gst_percent not present
  gst_percent?: number | null;   // preferred GST% field if available
  margin_percent?: number | null;
  uom: { code?: string }[] | { code?: string } | null;
}

interface Row {
  id: string;
  sku_input: string;
  item_id: string;
  description: string;
  uom_code: string;
  base_cost: number;     // current cost from item
  qty: number;

  // Hidden in UI, used for computation only
  gst_pct: number;       // GST% (from item.gst_percent || item.tax_rate || 0)
  margin_pct: number;    // Margin% (from item.margin_percent || 0)

  // internal UI helpers
  last_sku_tried?: string;
}

function ceilRupee(n: number) {
  const x = Number(n || 0);
  return Number.isFinite(x) ? Math.ceil(x) : 0;
}
function safeUomCode(u: ItemDb['uom']): string {
  if (Array.isArray(u)) return u[0]?.code ?? '';
  return (u as any)?.code ?? '';
}
function makeId(): string {
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
function fullName(c: Partial<Customer>) {
  return [c.first_name, c.last_name].filter(Boolean).join(' ').trim();
}
function oneLineAddress(c: Partial<Customer>) {
  return [c.street_name, c.village_town, c.city, c.postal_code, c.state]
    .filter(Boolean)
    .map(s => String(s).trim())
    .join(', ');
}

/* =========================================
   Lightweight bridge from Inventory → Here
   - Inventory page can post localStorage:
     localStorage.setItem('inventory-selected-item', JSON.stringify({ sku, id? }))
   - Or navigate with ?add_sku=SKU
   ========================================= */
class StorageBus {
  key: string;
  constructor(key = 'inventory-selected-item') { this.key = key; }
  on(fn: (payload: any) => void) {
    const handler = (ev: StorageEvent) => {
      try {
        if (ev.key !== this.key || !ev.newValue) return;
        const payload = JSON.parse(ev.newValue);
        fn(payload);
      } catch (e) { console.error('StorageBus.on parse error', e); }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }
}
const fromInventory = new StorageBus('inventory-selected-item');

/* ============================
   QR cache per-SKU (data URLs)
   ============================ */
const qrCache = new Map<string, string>();
async function getQrDataUrl(value: string) {
  const v = (value || '').trim();
  if (!v) return '';
  if (qrCache.has(v)) return qrCache.get(v)!;
  try {
    const QR: any = await import('qrcode');
    const toDataURL = (QR?.toDataURL || QR?.default?.toDataURL);
    const dataUrl = await toDataURL(v, { margin: 0, scale: 4 });
    qrCache.set(v, dataUrl);
    return dataUrl;
  } catch (e) {
    console.error('QR generate failed', e);
    return '';
  }
}

/* ============================
   Estimate Page (No Stock/Pay)
   ============================ */
export default function EstimatePage() {
  // Brand
  const brandName    = process.env.NEXT_PUBLIC_BRAND_NAME     || 'Vinayak Hardware';
  const brandLogo    = process.env.NEXT_PUBLIC_BRAND_LOGO_URL || '/logo.png';
  const brandAddress = process.env.NEXT_PUBLIC_BRAND_ADDRESS  || 'Bilimora, Gandevi, Navsari, Gujarat, 396321';
  const brandPhone   = process.env.NEXT_PUBLIC_BRAND_PHONE    || '+91 7046826808';

  // Header (Estimate)
  const [issuedAt, setIssuedAt] = useState<string>(() => new Date().toISOString().slice(0,10));
  const [estimateNo, setEstimateNo] = useState<string>(''); // can be auto on save

  // Customer
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerId, setCustomerId] = useState<string>('');
  const [customerName, setCustomerName] = useState<string>('');
  const [customerAddress1Line, setCustomerAddress1Line] = useState<string>('');
  const [showCreateCustomer, setShowCreateCustomer] = useState(false);

  const [newCust, setNewCust] = useState({
    first_name: '', last_name: '', phone: '',
    street_name: '', village_town: '', city: '', state: '', postal_code: '',
  });

  // Rows
  const [rows, setRows] = useState<Row[]>([]);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  // Barcode Scan (optional)
  const [barcodeMode, setBarcodeMode] = useState(false);
  const barcodeInputRef = useRef<HTMLInputElement | null>(null);
  const [barcodeBuffer, setBarcodeBuffer] = useState('');
  const [scanQty, setScanQty] = useState<number>(1);

  // QR cache state for rendering (rowId -> dataUrl)
  const [qrMap, setQrMap] = useState<Record<string, string>>({});

  // focus map for SKU inputs
  const skuInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => { setRows([makeEmptyRow()]); }, []);

  function makeEmptyRow(): Row {
    return {
      id: makeId(),
      sku_input: '',
      item_id: '',
      description: '',
      uom_code: '',
      base_cost: 0,
      qty: 1,
      gst_pct: 0,
      margin_pct: 0,
      last_sku_tried: '',
    };
  }

  // Derived totals (only Line Total shown; includes cost+gst+margin)
  const totals = useMemo(() => {
    let grand = 0;
    for (const r of rows) {
      if (!r.item_id || !r.qty) continue;
      const perUnit = computeUnitEstimate(r.base_cost, r.gst_pct, r.margin_pct);
      grand += ceilRupee(perUnit * r.qty);
    }
    return { grand: ceilRupee(grand) };
  }, [rows]);

  // --- Computation helpers ---
  function computeUnitEstimate(base: number, gst: number, margin: number) {
    const b = Number(base || 0);
    const g = Number(gst || 0);
    const m = Number(margin || 0);
    // As requested: current cost + GST + margin (additive on base)
    const unit = b + (b * g / 100) + (b * m / 100);
    return ceilRupee(unit);
  }

  // ====== SKU lookup / set ======
  const SKU_LOOKUP_DEBOUNCE_MS = 250;
  const skuTimersRef = useRef<Record<string, any>>({});

  useEffect(() => {
    return () => {
      const timers = skuTimersRef.current || {};
      Object.keys(timers).forEach(k => {
        try { clearTimeout(timers[k]); } catch {}
      });
    };
  }, []);

  const setSkuInput = (rowId: string, text: string) => {
    setRows(prev => prev.map(r => r.id === rowId ? { ...r, sku_input: text, last_sku_tried: '' } : r));

    if (!barcodeMode) {
      const trimmed = (text || '').trim();

      if (skuTimersRef.current[rowId]) {
        try { clearTimeout(skuTimersRef.current[rowId]); } catch {}
        delete skuTimersRef.current[rowId];
      }

      if (trimmed) {
        skuTimersRef.current[rowId] = setTimeout(() => {
          if (trimmed.length >= 3) {
            setItemBySku(rowId, trimmed, { silentNotFound: true });
          }
        }, SKU_LOOKUP_DEBOUNCE_MS);
      }
    }
  };

  const setItemBySku = async (rowId: string, skuRaw: string, opts?: { silentNotFound?: boolean }) => {
    const sku = (skuRaw || '').trim();
    if (!sku) return;

    if (skuTimersRef.current[rowId]) {
      try { clearTimeout(skuTimersRef.current[rowId]); } catch {}
      delete skuTimersRef.current[rowId];
    }

    const rowSnapshot = rows.find(r => r.id === rowId);
    const alreadyTriedSame = rowSnapshot && rowSnapshot.last_sku_tried && rowSnapshot.last_sku_tried.trim().toLowerCase() === sku.toLowerCase();

    const { data, error } = await supabase
      .from('items')
      .select(
        'id, sku, name, unit_cost, tax_rate, gst_percent, margin_percent, uom:units_of_measure ( code )'
      )
      .ilike('sku', sku)
      .limit(1);

    if (error) return alert(error.message);
    const rec = (data ?? [])[0] as ItemDb | undefined;

    if (!rec) {
      if (!opts?.silentNotFound && !alreadyTriedSame) {
        alert(`No item found for SKU "${sku}"`);
        setTimeout(() => {
          const el = skuInputRefs.current[rowId];
          if (el) { el.focus(); try { el.select(); } catch {} }
        }, 0);
      }
      setRows(prev => prev.map(r => r.id === rowId ? { ...r, last_sku_tried: sku } : r));
      return;
    }

    const uom_code = safeUomCode(rec.uom);
    const gst = Number(rec.gst_percent ?? rec.tax_rate ?? 0);
    const margin = Number(rec.margin_percent ?? 0);

    setRows(prev => prev.map(r => {
      if (r.id !== rowId) return r;
      return {
        ...r,
        sku_input: rec.sku,
        item_id: rec.id,
        description: rec.name || '',
        uom_code,
        base_cost: Number(rec.unit_cost || 0),
        gst_pct: gst,
        margin_pct: margin,
        last_sku_tried: rec.sku,
      };
    }));

    // Generate QR for this SKU (for display)
    const qr = await getQrDataUrl(rec.sku);
    setQrMap(prev => ({ ...prev, [rowId]: qr }));
  };

  const addRow = () => {
    const newRow: Row = makeEmptyRow();
    setRows(prev => [...prev, newRow]);
    setTimeout(() => focusSku(newRow.id), 0);
  };

  const removeRow = (rowId: string) => setRows(prev => prev.filter(r => r.id !== rowId));

  const setDescription = (rowId: string, desc: string) =>
    setRows(prev => prev.map(r => r.id === rowId ? { ...r, description: desc } : r));

  const setQty = (rowId: string, qty: number) =>
    setRows(prev => prev.map(r => r.id === rowId ? { ...r, qty: qty || 0 } : r));

  const focusSku = (rowId: string) => {
    requestAnimationFrame(() => {
      const el = skuInputRefs.current[rowId];
      if (el) {
        el.focus();
        try { el.select(); } catch {}
      } else {
        setTimeout(() => {
          const el2 = skuInputRefs.current[rowId];
          if (el2) { el2.focus(); try { el2.select(); } catch {} }
        }, 50);
      }
    });
  };

  // Add item via barcode scan
  useEffect(() => {
    if (!barcodeMode) return;
    const t = setTimeout(() => barcodeInputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [barcodeMode]);

  const processBarcode = async (codeRaw: string) => {
    const code = (codeRaw || '').trim();
    if (!code) return;

    const addQty = Number.isFinite(Number(scanQty)) && Number(scanQty) > 0 ? Number(scanQty) : 1;

    try {
      const { data, error } = await supabase
        .from('items')
        .select(
          'id, sku, name, unit_cost, tax_rate, gst_percent, margin_percent, uom:units_of_measure ( code )'
        )
        .ilike('sku', code)
        .limit(1);
      if (error) throw error;

      const rec = (data ?? [])[0] as ItemDb | undefined;
      if (!rec) {
        alert(`No item found for SKU "${code}"`);
        setTimeout(() => barcodeInputRef.current?.focus(), 0);
        return;
      }

      // If existing row for item, bump qty
      const existing = rows.find(r => r.item_id === rec.id);
      if (existing) {
        setRows(prev => prev.map(r => {
          if (r.id !== existing.id) return r;
          return {
            ...r,
            qty: Number(r.qty || 0) + addQty,
            base_cost: Number(rec.unit_cost || r.base_cost || 0),
            gst_pct: Number(rec.gst_percent ?? rec.tax_rate ?? r.gst_pct ?? 0),
            margin_pct: Number(rec.margin_percent ?? r.margin_pct ?? 0),
          };
        }));
        // ensure QR cached
        const qr = await getQrDataUrl(rec.sku);
        setQrMap(prev => ({ ...prev, [existing.id]: qr }));
        setTimeout(() => barcodeInputRef.current?.focus(), 0);
        return;
      }

      // else use first empty row or add a new one
      let target = rows.find(r => !r.item_id);
      if (!target) {
        target = makeEmptyRow();
        setRows(prev => [...prev, target!]);
      }

      await setItemBySku(target.id, code, { silentNotFound: true });
      setQty(target.id, addQty);

      setTimeout(() => barcodeInputRef.current?.focus(), 0);
    } catch (e: any) {
      console.error(e);
      alert(e?.message || 'Scan failed');
    } finally {
      setBarcodeBuffer('');
      setTimeout(() => barcodeInputRef.current?.focus(), 0);
    }
  };

  // Auto-add from Inventory page via localStorage event
  useEffect(() => {
    const off = fromInventory.on(async (payload) => {
      try {
        const sku = payload?.sku || payload?.SKU || payload?.code;
        if (!sku) return;
        // use first empty row or add
        let target = rows.find(r => !r.item_id);
        if (!target) {
          target = makeEmptyRow();
          setRows(prev => [...prev, target!]);
        }
        await setItemBySku(target.id, String(sku), { silentNotFound: false });
        setQty(target.id, 1);
      } catch (e) {
        console.error('Inventory add failed', e);
      }
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  // Auto-add via query param ?add_sku=SKU
  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      const sku = sp.get('add_sku');
      if (!sku) return;
      let target = rows.find(r => !r.item_id);
      if (!target) {
        target = makeEmptyRow();
        setRows(prev => [...prev, target!]);
      }
      setItemBySku(target.id, sku, { silentNotFound: false }).then(() => {
        setQty(target!.id, 1);
      });
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ===== Customer lookup/create (unchanged semantics) =====
  const lookupCustomerByPhone = async () => {
    const phone = (customerPhone || '').trim();
    if (!phone) return alert('Please enter a mobile number');
    const { data, error } = await supabase
      .from('customers')
      .select('id, first_name, last_name, phone, street_name, village_town, city, state, postal_code')
      .ilike('phone', phone);
    if (error) return alert(error.message);

    if (!data || data.length === 0) {
      setNewCust({ first_name: '', last_name: '', phone, street_name: '', village_town: '', city: '', state: '', postal_code: '' });
      setShowCreateCustomer(true);
      setCustomerId(''); setCustomerName(''); setCustomerAddress1Line('');
    } else {
      const c = data[0] as Customer;
      setCustomerId(c.id);
      setCustomerName(fullName(c));
      setCustomerAddress1Line(oneLineAddress(c));
      setShowCreateCustomer(false);
    }
  };

  const createCustomer = async () => {
    if (!newCust.first_name || !newCust.last_name) return alert('Please enter first and last name');
    const { data, error } = await supabase
      .from('customers')
      .insert([newCust])
      .select('id, first_name, last_name, phone, street_name, village_town, city, state, postal_code')
      .single();
    if (error) return alert(error.message);
    const c = data as Customer;
    setCustomerId(c.id);
    setCustomerPhone(c.phone || newCust.phone);
    setCustomerName(fullName(c));
    setCustomerAddress1Line(oneLineAddress(c));
    setShowCreateCustomer(false);
  };

  // ===== Save (Estimate only; no stock ops, no payments) =====
  const savingLatch = () => {
    if (savingRef.current || saving) return true;
    savingRef.current = true; setSaving(true);
    return false;
  };
  const saveDone = () => { setSaving(false); savingRef.current = false; };

  const saveEstimate = async () => {
    if (savingLatch()) return;

    const hasLine = rows.some(r => r.item_id && Number(r.qty || 0) > 0);
    if (!hasLine) { saveDone(); return alert('Add at least one line item'); }

    if (!customerId) {
      // Not hard error, but warn
      const cont = confirm('No customer selected. Save estimate without customer?');
      if (!cont) { saveDone(); return; }
    }

    try {
      // Number generation: prefer next_estimate_no; fallback to EST-{ts}
      let estNo = (estimateNo || '').trim();
      if (!estNo) {
        try {
          const { data: nextNo, error: eNo } = await supabase.rpc('next_estimate_no');
          if (!eNo && nextNo) estNo = String(nextNo);
        } catch {}
        if (!estNo) {
          // fallback: try next_invoice_no and convert
          try {
            const { data: nextInv, error: eInv } = await supabase.rpc('next_invoice_no');
            if (!eInv && nextInv) estNo = String(nextInv).replace(/^INV/i, 'EST');
          } catch {}
        }
        if (!estNo) estNo = 'EST-' + Date.now();
        setEstimateNo(estNo);
      }

      // compute per-line, build payload
      const grand = totals.grand;
      const lineRows = rows
        .filter(r => r.item_id && Number(r.qty || 0) > 0)
        .map(r => {
          const unit = computeUnitEstimate(r.base_cost, r.gst_pct, r.margin_pct); // includes gst + margin
          return {
            item_id: r.item_id,
            description: r.description,
            qty: Number(r.qty || 0),
            unit_price: ceilRupee(unit),
            tax_rate: 0, // tax already included in unit price for estimate (UI does not show tax)
            line_total: ceilRupee(Number(r.qty || 0) * ceilRupee(unit)),
            base_cost_at_sale: r.base_cost,       // store for reference
            margin_pct_at_sale: r.margin_pct,     // store for reference
            gst_percent_at_estimate: r.gst_pct,   // custom field (if your table has JSONB/meta)
          };
        });

      // Try saving to `estimates` table first (if it exists)
      let savedId: string | null = null;
      let usedTable: 'estimates' | 'invoices' = 'estimates';

      try {
        const { data: est, error: e1 } = await supabase
          .from('estimates')
          .insert([{
            estimate_no: estNo,
            customer_id: customerId || null,
            notes,
            total: grand,
            status: 'draft',
            issued_at: issuedAt,
            meta: null, // optional JSONB if present
          }])
          .select()
          .single();

        if (e1) throw e1;
        savedId = (est as any).id as string;

        // If you have a separate `estimate_items` table, use it here.
        // Otherwise, put lineRows into `estimate_items`. If not present,
        // we’ll fall back to invoices below.
        const { error: e2 } = await supabase.from('estimate_items').insert(
          lineRows.map(lr => ({ ...lr, estimate_id: savedId }))
        );
        if (e2) {
          console.warn('estimate_items insert failed (maybe table not present)', e2);
        }
      } catch (e) {
        // fallback to invoices with doc_type='estimate'
        console.warn('Saving to estimates failed; falling back to invoices:', e);
        usedTable = 'invoices';

        const { data: inv, error: e1 } = await supabase
          .from('invoices')
          .insert([{
            invoice_no: estNo,
            customer_id: customerId || null,
            notes,
            subtotal: grand, // store all as subtotal since tax already embedded
            tax_total: 0,
            grand_total: grand,
            status: 'estimate',
            doc_type: 'estimate',
            issued_at: issuedAt,
          }])
          .select()
          .single();
        if (e1) throw e1;
        const invId = (inv as any).id as string;
        savedId = invId;

        const { error: e2 } = await supabase.from('invoice_items').insert(
          lineRows.map(lr => ({
            invoice_id: invId,
            item_id: lr.item_id,
            description: lr.description,
            qty: lr.qty,
            unit_price: lr.unit_price,
            tax_rate: 0,
            line_total: lr.line_total,
            base_cost_at_sale: lr.base_cost_at_sale,
            margin_pct_at_sale: lr.margin_pct_at_sale,
          }))
        );
        if (e2) throw e2;
      }

      alert(`Estimate saved #${estNo} (${usedTable})`);
    } catch (err: any) {
      console.error(err);
      alert(err?.message || String(err));
    } finally { saveDone(); }
  };

  const handleNewEstimate = () => {
    setIssuedAt(new Date().toISOString().slice(0,10));
    setEstimateNo('');
    setCustomerPhone(''); setCustomerId(''); setCustomerName(''); setCustomerAddress1Line('');
    setShowCreateCustomer(false);
    setNewCust({ first_name: '', last_name: '', phone: '', street_name: '', village_town: '', city: '', state: '', postal_code: '' });
    setRows([makeEmptyRow()]);
    setNotes('');
    setSaving(false);
  };

  return (
    <Protected>
      {/* Hidden input to capture barcode scans when Barcode Mode is ON */}
      <input
        ref={barcodeInputRef}
        className="sr-only"
        value={barcodeBuffer}
        onChange={(e) => setBarcodeBuffer(e.target.value)}
        onKeyDown={async (e) => {
          if (!barcodeMode) return;
          if (e.key === 'Enter') {
            e.preventDefault();
            const code = barcodeBuffer;
            await processBarcode(code);
          }
        }}
        aria-hidden={!barcodeMode}
        tabIndex={barcodeMode ? 0 : -1}
      />

      {/* Header */}
      <div className="card mb-4">
        <div className="flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={brandLogo} alt="logo" className="h-14 w-14 rounded bg-white object-contain" />
          <div>
            <div className="text-2xl font-bold text-orange-600">{brandName}</div>
            <div className="text-sm text-gray-700">{brandAddress}</div>
            <div className="text-sm text-gray-700">Phone: {brandPhone}</div>
          </div>

          <div className="ml-auto flex gap-2 items-center flex-wrap">
            {/* Barcode Mode Toggle (optional) */}
            <label className="flex items-center gap-2 border rounded px-2 py-1 bg-white">
              <input
                type="checkbox"
                checked={barcodeMode}
                onChange={(e) => {
                  setBarcodeMode(e.target.checked);
                  if (e.target.checked) {
                    setTimeout(() => barcodeInputRef.current?.focus(), 0);
                  }
                }}
              />
              <span className="text-sm font-medium">Barcode Mode</span>
            </label>

            <label className="flex items-center gap-2 border rounded px-2 py-1 bg-white">
              <span className="text-sm font-medium">Scan Qty</span>
              <input
                type="number"
                min={1}
                step={1}
                className="input w-20"
                value={scanQty}
                onChange={(e) => {
                  const v = parseInt(e.target.value || '1', 10);
                  setScanQty(Number.isFinite(v) && v > 0 ? v : 1);
                }}
                disabled={!barcodeMode}
                title="How many units to add per scan"
              />
            </label>

            <Button type="button" onClick={handleNewEstimate} className="bg-gray-700 hover:bg-gray-800">
              New Estimate
            </Button>
          </div>
        </div>
      </div>

      <div className="card">
        <h1 className="text-xl font-semibold mb-4">New Estimate</h1>

        {/* Top fields */}
        <div className="grid md-grid-cols-3 md:grid-cols-3 gap-3 mb-4">
          <div>
            <label className="label">Estimate No</label>
            <input
              className="input"
              placeholder="Auto on save or enter manually"
              value={estimateNo}
              onChange={(e) => setEstimateNo(e.target.value)}
            />
          </div>

          <div>
            <label className="label">Estimate Date</label>
            <input className="input" type="date" value={issuedAt} onChange={(e) => setIssuedAt(e.target.value)} />
          </div>

          <div>
            <label className="label">Notes</label>
            <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes" />
          </div>
        </div>

        {/* Customer */}
        <div className="card mb-4">
          <div className="grid md:grid-cols-3 gap-3 items-end">
            <div>
              <label className="label">Customer Mobile</label>
              <input className="input" placeholder="Enter mobile number" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
            </div>
            <div><Button type="button" onClick={lookupCustomerByPhone}>Lookup Customer</Button></div>
            <div className="text-sm">
              <div className="font-semibold">Customer</div>
              <div>{customerName || '—'}</div>
              <div className="text-gray-600">{customerAddress1Line || '—'}</div>
            </div>
          </div>

          {showCreateCustomer && (
            <div className="mt-4 border-t pt-4">
              <div className="grid md:grid-cols-3 gap-3">
                <div><label className="label">First name</label><input className="input" value={newCust.first_name} onChange={(e)=>setNewCust({ ...newCust, first_name: e.target.value })} /></div>
                <div><label className="label">Last name</label><input className="input" value={newCust.last_name} onChange={(e)=>setNewCust({ ...newCust, last_name: e.target.value })} /></div>
                <div><label className="label">Phone</label><input className="input" value={newCust.phone} onChange={(e)=>setNewCust({ ...newCust, phone: e.target.value })} /></div>
                <div className="md:col-span-3"><label className="label">Street</label><input className="input" value={newCust.street_name} onChange={(e)=>setNewCust({ ...newCust, street_name: e.target.value })} /></div>
                <div><label className="label">Village/Town</label><input className="input" value={newCust.village_town} onChange={(e)=>setNewCust({ ...newCust, village_town: e.target.value })} /></div>
                <div><label className="label">City</label><input className="input" value={newCust.city} onChange={(e)=>setNewCust({ ...newCust, city: e.target.value })} /></div>
                <div><label className="label">State</label><input className="input" value={newCust.state} onChange={(e)=>setNewCust({ ...newCust, state: e.target.value })} /></div>
                <div><label className="label">PIN</label><input className="input" value={newCust.postal_code} onChange={(e)=>setNewCust({ ...newCust, postal_code: e.target.value })} /></div>
              </div>
              <div className="mt-3"><Button type="button" onClick={createCustomer}>Create Customer</Button></div>
            </div>
          )}
        </div>

        {/* Line items */}
        <div className="overflow-auto">
          <table className="table">
            <thead>
              <tr>
                <th style={{ minWidth: 160 }}>Item (SKU)</th>
                <th style={{ minWidth: 220 }}>Description</th>
                <th style={{ minWidth: 80 }}>UoM</th>
                <th style={{ minWidth: 80 }}>Qty</th>
                <th style={{ minWidth: 140 }}>Item QR</th>
                <th style={{ minWidth: 140 }} className="text-right">Line Total</th>
                <th></th>
              </tr>
            </thead>

            <tbody>
              {rows.map((r) => {
                const perUnit = computeUnitEstimate(r.base_cost, r.gst_pct, r.margin_pct);
                const lineTotal = ceilRupee((r.qty || 0) * perUnit);
                const qr = qrMap[r.id];

                return (
                  <tr key={r.id}>
                    <td>
                      <input
                        className="input"
                        placeholder={barcodeMode ? "Scan barcode…" : "Type/Scan SKU or press Enter"}
                        value={r.sku_input}
                        onChange={(e) => setSkuInput(r.id, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            const sku = r.sku_input.trim();
                            setRows(prev => prev.map(x => x.id === r.id ? { ...x, last_sku_tried: sku } : x));
                            setItemBySku(r.id, sku);
                          }
                        }}
                        onBlur={() => {
                          const v = (r.sku_input || '').trim();
                          if (!r.item_id && v && v.toLowerCase() !== (r.last_sku_tried || '').toLowerCase()) {
                            setRows(prev => prev.map(x => x.id === r.id ? { ...x, last_sku_tried: v } : x));
                            setItemBySku(r.id, v);
                          }
                        }}
                        readOnly={barcodeMode}
                        title={barcodeMode ? 'Barcode Mode ON: SKU is read-only. Scan to add/increase.' : undefined}
                        ref={(el) => { skuInputRefs.current[r.id] = el; }}
                      />
                    </td>
                    <td>
                      <input
                        className="input"
                        placeholder="Description"
                        value={r.description}
                        onChange={(e) => setDescription(r.id, e.target.value)}
                        disabled={!r.item_id}
                      />
                      {/* Hidden technicals: cost + gst + margin (not shown, but retained in state) */}
                    </td>
                    <td>
                      <input className="input" value={r.uom_code || ''} readOnly placeholder="-" />
                    </td>
                    <td>
                      <input
                        className="input"
                        type="number"
                        min={0}
                        step="1"
                        value={r.qty}
                        onChange={(e) => setQty(r.id, parseFloat(e.target.value || '0'))}
                        disabled={!r.item_id}
                      />
                    </td>
                    <td>
                      {!r.item_id ? (
                        <div className="text-xs text-gray-500">—</div>
                      ) : !qr ? (
                        <div className="text-xs text-gray-500">Generating…</div>
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={qr} alt={`QR ${r.sku_input}`} className="h-12 w-12 object-contain bg-white rounded" />
                      )}
                      {r.item_id && (
                        <div className="mt-1 text-[11px] text-gray-600">SKU: {r.sku_input}</div>
                      )}
                    </td>
                    <td className="text-right">₹ {lineTotal.toFixed(2)}</td>
                    <td>
                      <button type="button" className="text-red-600 hover:underline" onClick={() => removeRow(r.id)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>

            <tfoot>
              <tr>
                <td colSpan={7}>
                  <Button type="button" onClick={addRow}>+ Add Line</Button>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Totals + Save */}
        <div className="mt-6 grid lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2" />

          <div className="card">
            <div className="flex justify-between font-semibold text-lg">
              <div>Total</div>
              <div>₹ {totals.grand.toFixed(2)}</div>
            </div>

            <div className="mt-4 flex gap-2 flex-wrap">
              <Button type="button" onClick={saveEstimate} disabled={saving}>
                {saving ? 'Saving…' : 'Save Estimate'}
              </Button>
              <Button type="button" onClick={() => window.print()} className="bg-gray-700 hover:bg-gray-800">Print</Button>
              {estimateNo && <div className="text-sm text-gray-600 self-center">Saved #{estimateNo}</div>}
            </div>
          </div>
        </div>
      </div>
    </Protected>
  );
}
