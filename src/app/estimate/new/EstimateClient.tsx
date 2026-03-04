'use client';

export const dynamic = 'force-dynamic';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import Button from '@/components/Button';
import Protected from '@/components/Protected';

/* =============================
   Types
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
  tax_rate?: number | null;
  gst_percent?: number | null;
  margin_percent?: number | null;
  uom: { code?: string }[] | { code?: string } | null;
}

interface Row {
  id: string;
  sku_input: string;
  item_id: string;
  description: string;
  uom_code: string;
  base_cost: number;   // base/current cost
  gst_pct: number;     // hidden in UI (only for computation)
  margin_pct: number;  // hidden in UI (only for computation)
  qty: number;
  last_sku_tried?: string;
}

/* =============================
   Utils
   ============================= */
const ceilRupee = (n: number) => Math.ceil((Number(n) || 0) + Number.EPSILON);

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

/* =============================
   QR generator (cached)
   ============================= */
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
  } catch {
    return '';
  }
}

/* =============================
   Main: Estimate Page
   ============================= */
export default function EstimatePage() {
  const router = useRouter();

  // Brand (optional)
  const brandName    = process.env.NEXT_PUBLIC_BRAND_NAME     || 'Vinayak Hardware';
  const brandLogo    = process.env.NEXT_PUBLIC_BRAND_LOGO_URL || '/logo.png';
  const brandAddress = process.env.NEXT_PUBLIC_BRAND_ADDRESS  || 'Bilimora, Gandevi, Navsari, Gujarat, 396321';
  const brandPhone   = process.env.NEXT_PUBLIC_BRAND_PHONE    || '+91 7046826808';

  // Header
  const [issuedAt, setIssuedAt] = useState<string>(() => new Date().toISOString().slice(0,10));
  const [estimateNo, setEstimateNo] = useState<string>('');
  const [notes, setNotes] = useState('');

  // Customer
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerId, setCustomerId] = useState<string>('');
  const [customerName, setCustomerName] = useState<string>('');
  const [customerAddress1Line, setCustomerAddress1Line] = useState<string>('');
  const [showCreateCustomer, setShowCreateCustomer] = useState(false);
  const [newCust, setNewCust] = useState({
    first_name: '',
    last_name: '',
    phone: '',
    street_name: '',
    village_town: '',
    city: '',
    state: '',
    postal_code: '',
  });

  // Lines
  const [rows, setRows] = useState<Row[]>([]);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  // QR per row
  const [qrMap, setQrMap] = useState<Record<string, string>>({});

  // Optional barcode scan mode
  const [barcodeMode, setBarcodeMode] = useState(false);
  const barcodeInputRef = useRef<HTMLInputElement | null>(null);
  const [barcodeBuffer, setBarcodeBuffer] = useState('');
  const [scanQty, setScanQty] = useState<number>(1);
  const skuInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // Boot with one row
  useEffect(() => { setRows([makeEmptyRow()]); }, []);
  function makeEmptyRow(): Row {
    return {
      id: makeId(),
      sku_input: '',
      item_id: '',
      description: '',
      uom_code: '',
      base_cost: 0,
      gst_pct: 0,
      margin_pct: 0,
      qty: 1,
      last_sku_tried: '',
    };
  }

  /* =================================
     Compute Totals
     ================================= */
  function computeUnit(base: number, gst: number, margin: number) {
    // current cost + GST + Margin (additive on base)
    const b = Number(base || 0);
    const g = Number(gst || 0);
    const m = Number(margin || 0);
    return ceilRupee(b + b * g / 100 + b * m / 100);
  }
  const totals = useMemo(() => {
    let grand = 0;
    for (const r of rows) {
      if (!r.item_id && !r.sku_input) continue;
      const perUnit = computeUnit(r.base_cost, r.gst_pct, r.margin_pct);
      grand += ceilRupee(perUnit * (Number(r.qty) || 0));
    }
    return { grand: ceilRupee(grand) };
  }, [rows]);

  /* =================================
     Seed from Inventory (Estimate Selected)
     ================================= */
  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      if (sp.get('seed') !== '1') return;

      const raw = localStorage.getItem('estimate-seed');
      if (!raw) return;

      const items = JSON.parse(raw);
      if (!Array.isArray(items) || items.length === 0) return;

      const seeded = items
        .map((it: any) => ({
          id: makeId(),
          sku_input: String(it.sku || it.SKU || ''),
          item_id: '', // optional
          description: String(it.name || it.sku || ''),
          uom_code: String(it.uom_code || ''),
          base_cost: Number(it.selling || 0), // selling already = cost+GST+margin
          gst_pct: 0,
          margin_pct: 0,
          qty: Math.max(1, Number(it.qty || 1)),
          last_sku_tried: String(it.sku || ''),
        }))
        .filter(r => !!r.sku_input);

      if (seeded.length === 0) return;

      setRows(seeded);

      // Preload QR images
      Promise.all(seeded.map(async r => [r.id, await getQrDataUrl(r.sku_input)] as const))
        .then(pairs => {
          const obj: Record<string, string> = {};
          for (const [id, url] of pairs) obj[id] = url || '';
          setQrMap(prev => ({ ...prev, ...obj }));
        })
        .catch(() => {});
    } catch (e) {
      console.error('Failed to read estimate-seed:', e);
    }
  }, []);

  /* =================================
     Support single add via ?sku=...&qty=...
     ================================= */
  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      const sku = sp.get('sku');
      const qty = Number(sp.get('qty') || '1');
      if (!sku) return;

      // use first empty or add new
      let target = rows.find(r => !r.item_id && !r.sku_input);
      if (!target) {
        target = makeEmptyRow();
        setRows(prev => [...prev, target!]);
      }
      setItemBySku(target.id, sku, { silentNotFound: false }).then(() => {
        setQty(target!.id, Math.max(1, qty));
      });
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* =================================
     SKU lookup (DB) and updates
     ================================= */
  const setItemBySku = async (rowId: string, skuRaw: string, opts?: { silentNotFound?: boolean }) => {
    const sku = (skuRaw || '').trim();
    if (!sku) return;

    const rowSnapshot = rows.find(r => r.id === rowId);
    const alreadyTriedSame =
      rowSnapshot?.last_sku_tried?.trim().toLowerCase() === sku.toLowerCase();

    const { data, error } = await supabase
      .from('items')
      .select('id, sku, name, unit_cost, tax_rate, gst_percent, margin_percent, uom:units_of_measure ( code )')
      .ilike('sku', sku)
      .limit(1);

    if (error) {
      alert(error.message);
      return;
    }
    const rec = (data ?? [])[0] as ItemDb | undefined;

    if (!rec) {
      if (!opts?.silentNotFound && !alreadyTriedSame) {
        alert(`No item found for SKU "${sku}"`);
        setTimeout(() => {
          const el = skuInputRefs.current[rowId];
          if (el) { el.focus(); try { el.select(); } catch {} }
        }, 0);
      }
      setRows(prev => prev.map(r => r.id === rowId ? ({ ...r, last_sku_tried: sku }) : r));
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

    const qr = await getQrDataUrl(rec.sku);
    setQrMap(prev => ({ ...prev, [rowId]: qr }));
  };

  const setSkuInput = (rowId: string, text: string) =>
    setRows(prev => prev.map(r => r.id === rowId ? { ...r, sku_input: text, last_sku_tried: '' } : r));
  const setDescription = (rowId: string, desc: string) =>
    setRows(prev => prev.map(r => r.id === rowId ? { ...r, description: desc } : r));
  const setQty = (rowId: string, qty: number) =>
    setRows(prev => prev.map(r => r.id === rowId ? { ...r, qty: qty || 0 } : r));

  const addRow = () => {
    const newRow: Row = makeEmptyRow();
    setRows(prev => [...prev, newRow]);
    setTimeout(() => {
      const el = skuInputRefs.current[newRow.id];
      if (el) { el.focus(); try { el.select(); } catch {} }
    }, 0);
  };
  const removeRow = (rowId: string) => setRows(prev => prev.filter(r => r.id !== rowId));

  /* =================================
     Barcode scan (optional)
     ================================= */
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
        .select('id, sku, name, unit_cost, tax_rate, gst_percent, margin_percent, uom:units_of_measure ( code )')
        .ilike('sku', code)
        .limit(1);
      if (error) throw error;

      const rec = (data ?? [])[0] as ItemDb | undefined;
      if (!rec) {
        alert(`No item found for SKU "${code}"`);
        setTimeout(() => barcodeInputRef.current?.focus(), 0);
        return;
      }

      // If exists, bump qty
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
        const qr = await getQrDataUrl(rec.sku);
        setQrMap(prev => ({ ...prev, [existing.id]: qr }));
        setTimeout(() => barcodeInputRef.current?.focus(), 0);
        return;
      }

      // else use empty row or new
      let target = rows.find(r => !r.item_id && !r.sku_input);
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

  /* =================================
     Customer lookup/create
     ================================= */
  const lookupCustomerByPhone = async () => {
    const phone = (customerPhone || '').trim();
    if (!phone) return alert('Please enter a mobile number');

    const { data, error } = await supabase
      .from('customers')
      .select('id, first_name, last_name, phone, street_name, village_town, city, state, postal_code')
      .ilike('phone', phone);

    if (error) return alert(error.message);

    if (!data || data.length === 0) {
      setNewCust({
        first_name: '',
        last_name: '',
        phone,
        street_name: '',
        village_town: '',
        city: '',
        state: '',
        postal_code: '',
      });
      setShowCreateCustomer(true);
      setCustomerId('');
      setCustomerName('');
      setCustomerAddress1Line('');
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

  /* =================================
     Save (Estimate only; no stock ops)
     ================================= */
  const latch = () => {
    if (savingRef.current || saving) return true;
    savingRef.current = true; setSaving(true);
    return false;
  };
  const release = () => { setSaving(false); savingRef.current = false; };

  const saveEstimate = async () => {
    if (latch()) return;

    const hasLine = rows.some(r => (r.item_id || r.sku_input) && Number(r.qty || 0) > 0);
    if (!hasLine) { release(); return alert('Add at least one line item'); }

    if (!customerId) {
      const proceed = confirm('No customer selected. Save estimate without customer?');
      if (!proceed) { release(); return; }
    }

    try {
      // Build estimate number
      let estNo = (estimateNo || '').trim();
      if (!estNo) {
        try {
          const { data: nextNo, error: eNo } = await supabase.rpc('next_estimate_no');
          if (!eNo && nextNo) estNo = String(nextNo);
        } catch {}
        if (!estNo) {
          try {
            const { data: nextInv, error: eInv } = await supabase.rpc('next_invoice_no');
            if (!eInv && nextInv) estNo = String(nextInv).replace(/^INV/i, 'EST');
          } catch {}
        }
        if (!estNo) estNo = 'EST-' + Date.now();
        setEstimateNo(estNo);
      }

      // Lines (unit already includes gst+margin through computeUnit)
      const lines = rows
        .filter(r => (r.item_id || r.sku_input) && Number(r.qty || 0) > 0)
        .map(r => {
          const unit = computeUnit(r.base_cost, r.gst_pct, r.margin_pct);
          return {
            item_id: r.item_id || null,
            sku: r.sku_input || null,
            description: r.description,
            qty: Number(r.qty || 0),
            unit_price: ceilRupee(unit),
            tax_rate: 0,
            line_total: ceilRupee(unit * Number(r.qty || 0)),
            base_cost_at_sale: r.base_cost,
            margin_pct_at_sale: r.margin_pct,
            gst_percent_at_estimate: r.gst_pct,
            uom_code: r.uom_code || null,
          };
        });

      const grand = totals.grand;
      let usedTable: 'estimates' | 'invoices' = 'estimates';
      let savedId: string | null = null;

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
          }])
          .select()
          .single();
        if (e1) throw e1;
        savedId = (est as any).id;

        const { error: e2 } = await supabase
          .from('estimate_items')
          .insert(lines.map(l => ({ ...l, estimate_id: savedId })));
        if (e2) console.warn('estimate_items insert failed (maybe not present):', e2);
      } catch (e) {
        // Fallback to invoices/doc_type=estimate
        usedTable = 'invoices';
        const { data: inv, error: e1 } = await supabase
          .from('invoices')
          .insert([{
            invoice_no: estNo,
            customer_id: customerId || null,
            notes,
            subtotal: grand,
            tax_total: 0,
            grand_total: grand,
            status: 'estimate',
            doc_type: 'estimate',
            issued_at: issuedAt,
          }])
          .select()
          .single();
        if (e1) throw e1;
        savedId = (inv as any).id;

        const { error: e2 } = await supabase
          .from('invoice_items')
          .insert(lines.map(l => ({
            invoice_id: savedId,
            item_id: l.item_id,
            description: l.description,
            qty: l.qty,
            unit_price: l.unit_price,
            tax_rate: 0,
            line_total: l.line_total,
            base_cost_at_sale: l.base_cost_at_sale,
            margin_pct_at_sale: l.margin_pct_at_sale,
          })));
        if (e2) throw e2;
      }

      alert(`Estimate saved #${estNo} (${usedTable})`);
    } catch (err: any) {
      console.error(err);
      alert(err?.message || String(err));
    } finally { release(); }
  };

  const handleNew = () => {
    setIssuedAt(new Date().toISOString().slice(0,10));
    setEstimateNo('');
    setNotes('');
    setCustomerPhone(''); setCustomerId(''); setCustomerName(''); setCustomerAddress1Line('');
    setShowCreateCustomer(false);
    setNewCust({
      first_name: '',
      last_name: '',
      phone: '',
      street_name: '',
      village_town: '',
      city: '',
      state: '',
      postal_code: '',
    });
    setRows([makeEmptyRow()]);
    setSaving(false);
  };

  /* =================================
     Back to Inventory — smart behavior
     ================================= */
  const goBackToInventory = () => {
    // 1) If this tab/window was opened by script and opener is available:
    try {
      const openerWin = window.opener as Window | null;
      if (openerWin && !openerWin.closed) {
        try {
          // If same-origin, ensure opener is on Inventory
          if (openerWin.location.origin === window.location.origin) {
            if (!openerWin.location.pathname.startsWith('/inventory')) {
              openerWin.location.href = '/inventory';
            }
          }
        } catch {
          // Cross-origin: can't inspect, just focus and close
        }
        openerWin.focus?.();
        // Attempt to close this tab (allowed only if it was opened by script)
        window.close();
        return;
      }
    } catch {
      // ignore
    }

    // 2) If we have navigation history (came from inventory), go back
    if (document.referrer) {
      try {
        const ref = new URL(document.referrer);
        if (ref.origin === window.location.origin) {
          router.back();
          return;
        }
      } catch {}
    }

    // 3) Fallback: replace current tab with Inventory
    router.replace('/inventory');
  };

  /* ================================
     PRINT-ONLY STYLES + PRINT LAYOUT
     ================================ */
  const PrintStyles = () => (
    <style>{`
      .num { text-align: right; font-variant-numeric: tabular-nums; }

      .print-area table { width: 100%; border-collapse: collapse; }
      .print-area th, .print-area td {
        padding: 6px 8px;
        border-bottom: 1px dashed #ddd;
        vertical-align: middle;
      }
      .print-area thead th {
        border-bottom: 1px solid #bbb;
        font-weight: 600;
      }
      .print-area tfoot td {
        border-top: 1px solid #bbb;
      }

      @media print {
        @page { margin: 10mm; }
        body { background: #fff !important; }
        body * { visibility: hidden; }
        .print-area, .print-area * { visibility: visible; }
        .print-area { position: absolute; left: 0; top: 0; right: 0; }
        .no-print { display: none !important; }

        /* Avoid page-break inside rows */
        .print-area table { page-break-inside: auto; }
        .print-area tr { page-break-inside: avoid; page-break-after: auto; }
      }
    `}</style>
  );

  // Build the lines for print
  const printableLines = rows
    .filter(r => (r.item_id || r.sku_input) && Number(r.qty || 0) > 0)
    .map(r => {
      const unit = computeUnit(r.base_cost, r.gst_pct, r.margin_pct);
      const lineTotal = ceilRupee(unit * Number(r.qty || 0));
      return {
        sku: r.sku_input,
        description: r.description,
        uom_code: r.uom_code || '',
        qty: r.qty,
        unit_price: unit,
        line_total: lineTotal,
      };
    });

  return (
    <Protected>
      <PrintStyles />

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
            await processBarcode(barcodeBuffer);
          }
        }}
        aria-hidden={!barcodeMode}
        tabIndex={barcodeMode ? 0 : -1}
      />

      {/* ====== EDITOR (not printed) ====== */}
      <div className="no-print">
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
              {/* REPLACED Link with a button that knows how to close/focus/replace */}
              <button
                type="button"
                onClick={goBackToInventory}
                className="rounded border px-3 py-2 hover:bg-neutral-50"
                title="Go back to the Inventory page (close this window if possible)"
              >
                Back to Inventory
              </button>

              <label className="flex items-center gap-2 border rounded px-2 py-1 bg-white">
                <input
                  type="checkbox"
                  checked={barcodeMode}
                  onChange={(e) => {
                    setBarcodeMode(e.target.checked);
                    if (e.target.checked) setTimeout(() => barcodeInputRef.current?.focus(), 0);
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

              <Button type="button" onClick={handleNew} className="bg-gray-700 hover:bg-gray-800">
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

          {/* Lines */}
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
                  const perUnit = computeUnit(r.base_cost, r.gst_pct, r.margin_pct);
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
                          disabled={!r.sku_input}
                        />
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
                          disabled={!r.sku_input}
                        />
                      </td>
                      <td>
                        {!r.sku_input ? (
                          <div className="text-xs text-gray-500">—</div>
                        ) : !qr ? (
                          <div className="text-xs text-gray-500">Generating…</div>
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={qr} alt={`QR ${r.sku_input}`} className="h-12 w-12 object-contain bg-white rounded" />
                        )}
                        {r.sku_input && (
                          <div className="mt-1 text-[11px] text-gray-600">SKU: {r.sku_input}</div>
                        )}
                      </td>
                      <td className="text-right">₹ {lineTotal.toFixed(0)}</td>
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
                <div>₹ {totals.grand.toFixed(0)}</div>
              </div>
              <div className="mt-4 flex gap-2 flex-wrap">
                <Button type="button" onClick={saveEstimate} disabled={saving}>
                  {saving ? 'Saving…' : 'Save Estimate'}
                </Button>
                <Button type="button" onClick={() => window.print()} className="bg-gray-700 hover:bg-gray-800">
                  Print
                </Button>
                {estimateNo && <div className="text-sm text-gray-600 self-center">Saved #{estimateNo}</div>}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ====== PRINT-ONLY AREA ====== */}
      <div className="print-area">
        {/* Brand header */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 12 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {brandLogo ? <img src={brandLogo} alt="logo" style={{ width: 48, height: 48, objectFit: 'contain', borderRadius: 6, background: '#fff' }} /> : null}
          <div>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#ea580c' }}>{brandName}</div>
            <div style={{ fontSize: 12, color: '#374151' }}>{brandAddress}</div>
            <div style={{ fontSize: 12, color: '#374151' }}>Phone: {brandPhone}</div>
          </div>
        </div>

        {/* Doc header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>Estimate</div>
            {estimateNo ? <div style={{ fontSize: 12, color: '#374151' }}>No: {estimateNo}</div> : null}
            <div style={{ fontSize: 12, color: '#374151' }}>Date: {issuedAt || '—'}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontWeight: 600 }}>Bill To</div>
            <div style={{ fontSize: 13 }}>{customerName || '—'}</div>
            <div style={{ fontSize: 12, color: '#374151' }}>{customerAddress1Line || '—'}</div>
            {notes ? <div style={{ fontSize: 12, color: '#374151', marginTop: 4 }}>Notes: {notes}</div> : null}
          </div>
        </div>

        {/* Lines */}
        <div style={{ overflow: 'hidden' }}>
          <table>
            <thead>
              <tr>
                <th>SKU</th>
                <th style={{ minWidth: 220 }}>Description</th>
                <th>UoM</th>
                <th className="num">Qty</th>
                <th className="num">Unit</th>
                <th className="num">Line Total</th>
              </tr>
            </thead>
            <tbody>
              {printableLines.length === 0 ? (
                <tr><td colSpan={6} style={{ padding: '10px 8px', fontSize: 12, color: '#6b7280' }}>No items</td></tr>
              ) : (
                printableLines.map((ln, idx) => (
                  <tr key={idx}>
                    <td>{ln.sku}</td>
                    <td>{ln.description}</td>
                    <td>{ln.uom_code || '-'}</td>
                    <td className="num">{ln.qty}</td>
                    <td className="num">₹ {Number(ln.unit_price || 0).toFixed(0)}</td>
                    <td className="num">₹ {Number(ln.line_total || 0).toFixed(0)}</td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot>
              <tr className="num" style={{ fontWeight: 600 }}>
                <td colSpan={5} style={{ textAlign: 'right' }}>Total</td>
                <td>₹ {totals.grand.toFixed(0)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </Protected>
  );
}
