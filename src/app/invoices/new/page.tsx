'use client';

export const dynamic = 'force-dynamic';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import Button from '@/components/Button';
import Protected from '@/components/Protected';

type DocType = 'sale' | 'return';

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
  tax_rate: number;
  uom: { code?: string }[] | { code?: string } | null;
}

interface Row {
  id: string;
  sku_input: string;
  item_id: string;
  description: string;
  uom_code: string;
  base_cost: number;
  qty: number;
  margin_pct: number;
  tax_rate: number;
  unit_price: number;
  issued_margin_pct?: number;
  return_qty?: number;

  /** NEW: per-row location selection + balances */
  location?: string; // selected location or typed "new" location
  use_custom_location?: boolean; // for return: true when typing "Other/New"
  loc_balances?: { name: string; qty: number }[]; // per-item balances
}

// -------- Helpers (always round up to next rupee) --------
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

/** ---------- Live mirror via localStorage ---------- */
class StorageBus {
  key: string;
  constructor(key = 'invoice-live-payload') { this.key = key; }
  post(payload: any) {
    try {
      const envelope = { ts: Date.now(), payload };
      const json = JSON.stringify(envelope);
      localStorage.setItem(this.key, json);
      try {
        window.dispatchEvent(new StorageEvent('storage', { key: this.key, newValue: json }));
      } catch {}
    } catch (e) { console.error('StorageBus.post error', e); }
  }
  on(fn: (payload: any) => void) {
    const handler = (ev: StorageEvent) => {
      try {
        if (ev.key !== this.key || !ev.newValue) return;
        const env = JSON.parse(ev.newValue);
        fn(env?.payload);
      } catch (e) { console.error('StorageBus.on parse error', e); }
    };
    window.addEventListener('storage', handler);
    try {
      const raw = localStorage.getItem(this.key);
      if (raw) { const env = JSON.parse(raw); fn(env?.payload); }
    } catch (e) { console.error('StorageBus initial load error', e); }
    return () => window.removeEventListener('storage', handler);
  }
}
const live = new StorageBus('invoice-live-payload');
// ---------------------------------------------------

export default function NewInvoicePage() {
  // Read view flags synchronously on first render (prevents crash)
  const [isCustomerView] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const sp = new URLSearchParams(window.location.search);
    return sp.get('display') === 'customer';
  });
  const [autoPrint] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const sp = new URLSearchParams(window.location.search);
    return sp.get('autoprint') === '1' || sp.get('_print') === '1' || sp.get('print') === '1';
  });

  // Customer view – listen for live payload
  const [liveState, setLiveState] = useState<any>(null);
  const [hasLiveData, setHasLiveData] = useState(false);
  // 🆕 If payment is done from Customer View, show it immediately here:
  const [custPayments, setCustPayments] = useState<any[] | null>(null);

  useEffect(() => {
    if (!isCustomerView) return;
    const off = live.on((payload) => {
      if (payload) { setLiveState(payload); setHasLiveData(true); }
    });
    return off;
  }, [isCustomerView]);

  // Auto-print after first payload (or fallback)
  useEffect(() => {
    if (!isCustomerView || !autoPrint) return;
    let printed = false;
    const maybePrint = () => { if (!printed) { printed = true; window.print(); } };
    if (hasLiveData) {
      const t = setTimeout(maybePrint, 100);
      return () => clearTimeout(t);
    }
    const t2 = setTimeout(maybePrint, 1500);
    return () => clearTimeout(t2);
  }, [isCustomerView, autoPrint, hasLiveData]);

  // Brand (🆕 will be SHOWN on Customer View too)
  const brandName    = process.env.NEXT_PUBLIC_BRAND_NAME     || 'Vinayak Hardware';
  const brandLogo    = process.env.NEXT_PUBLIC_BRAND_LOGO_URL || '/logo.png';
  const brandAddress = process.env.NEXT_PUBLIC_BRAND_ADDRESS  || 'Bilimora, Gandevi, Navsari, Gujarat, 396321';
  const brandPhone   = process.env.NEXT_PUBLIC_BRAND_PHONE    || '+91 7046826808';
  const upiId        = process.env.NEXT_PUBLIC_UPI_ID         || 'patelkb308@okaxis';

  // Header
  const [issuedAt, setIssuedAt] = useState<string>(() => new Date().toISOString().slice(0,10));
  const [docType, setDocType] = useState<DocType>('sale');
  const [originalInvoiceNo, setOriginalInvoiceNo] = useState<string>('');

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

  // Rows + state
  const [rows, setRows] = useState<Row[]>([]);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [invoiceIdJustSaved, setInvoiceIdJustSaved] = useState<string | null>(null);
  const [invoiceNoJustSaved, setInvoiceNoJustSaved] = useState<string | null>(null);
  const [invoiceGrandTotalAtSave, setInvoiceGrandTotalAtSave] = useState<number | null>(null);
  const savingRef = useRef(false);

  // Return helpers
  const [customerInvoices, setCustomerInvoices] = useState<{ id: string; invoice_no: string; issued_at?: string | null; grand_total?: number | null }[]>([]);
  const [originalGrandTotal, setOriginalGrandTotal] = useState<number>(0);

  // Payments state (editor)
  const [payments, setPayments] = useState<any[]>([]);
  const [paymentsLoading, setPaymentsLoading] = useState(false);

  // Pay modal + meta
  const [showPayModal, setShowPayModal] = useState(false);
  const [payMethod, setPayMethod] = useState<'cash'|'card'|'qr'|'other'>('cash');
  const [payAmount, setPayAmount] = useState<number>(0);
  const [payReference, setPayReference] = useState<string>('');
  const [payDirection, setPayDirection] = useState<'in'|'out'>('in');
  // Card/QR meta
  const [cardHolder, setCardHolder] = useState('');
  const [cardLast4, setCardLast4] = useState('');
  const [cardAuth, setCardAuth] = useState('');
  const [cardTxn, setCardTxn] = useState('');
  const [qrImageUrl, setQrImageUrl] = useState(''); // dataURL (auto-generated)
  const [qrTxn, setQrTxn] = useState('');
  const [generatingQR, setGeneratingQR] = useState(false);

  // 🆕 Barcode mode (scanner-only)
  const [barcodeMode, setBarcodeMode] = useState(false);
  const barcodeInputRef = useRef<HTMLInputElement | null>(null);
  const [barcodeBuffer, setBarcodeBuffer] = useState('');

  useEffect(() => { setRows([makeEmptyRow()]); }, []);
  function makeEmptyRow(): Row {
    return {
      id: makeId(), sku_input: '', item_id: '', description: '', uom_code: '',
      base_cost: 0, qty: 1, margin_pct: 0, tax_rate: 0, unit_price: 0,
      issued_margin_pct: 0, return_qty: 0,
      // NEW
      location: '', use_custom_location: false, loc_balances: [],
    };
  }

  // ----- payments load (editor)
  const refreshPayments = async (invoiceId: string) => {
    try {
      setPaymentsLoading(true);
      const { data, error } = await supabase
        .from('payments')
        .select('id, method, direction, amount, reference, meta, is_void, created_at')
        .eq('invoice_id', invoiceId)
        .eq('is_void', false)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setPayments(data || []);
    } catch (err) { console.error(err); }
    finally { setPaymentsLoading(false); }
  };

  // ----- customer lookup/create
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
      setCustomerInvoices([]);
    } else {
      const c = data[0] as Customer;
      setCustomerId(c.id);
      setCustomerName(fullName(c));
      setCustomerAddress1Line(oneLineAddress(c));
      setShowCreateCustomer(false);

      if (docType === 'return') {
        const { data: invs } = await supabase
          .from('invoices')
          .select('id, invoice_no, issued_at, grand_total')
          .eq('customer_id', c.id)
          .order('issued_at', { ascending: false })
          .limit(100);
        setCustomerInvoices(invs ?? []);
      }
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

  /** NEW: per-item location balances loader (+cache for repeated items) */
  const locCacheRef = useRef<Map<string, { name: string; qty: number }[]>>(new Map());
  const loadLocBalances = async (itemId: string): Promise<{ name: string; qty: number }[]> => {
    if (!itemId) return [];
    if (locCacheRef.current.has(itemId)) return locCacheRef.current.get(itemId)!;

    const { data, error } = await supabase
      .from('stock_moves')
      .select('move_type, qty, location, item_id')
      .eq('item_id', itemId);

    if (error) {
      console.warn('loadLocBalances error', error);
      return [];
    }

    const map = new Map<string, number>();
    (data ?? []).forEach((r: any) => {
      const mt = String(r.move_type || '').toLowerCase() as 'receive'|'issue'|'return'|'adjust';
      const loc = (String(r.location ?? '').trim()) || '(unassigned)';
      const qRaw = Number(r.qty ?? 0);
      let delta = qRaw;
      if (mt === 'issue') delta = -Math.abs(qRaw);
      else if (mt === 'receive' || mt === 'return') delta = Math.abs(qRaw);
      // adjust: use sign as-is
      map.set(loc, (map.get(loc) ?? 0) + delta);
    });

    const balances = Array.from(map.entries())
      .map(([name, qty]) => ({ name, qty }))
      .sort((a, b) => a.name.localeCompare(b.name));

    locCacheRef.current.set(itemId, balances);
    return balances;
  };

  // ----- set item by SKU (sale) — unit_price always ceil
  // 🆕 added 'opts' to control alert behaviour
  const setItemBySku = async (rowId: string, skuRaw: string, opts?: { silentNotFound?: boolean }) => {
    const sku = (skuRaw || '').trim();
    if (!sku) return;
    const { data, error } = await supabase
      .from('items')
      .select('id, sku, name, unit_cost, tax_rate, uom:units_of_measure ( code )')
      .ilike('sku', sku)
      .limit(1);
    if (error) return alert(error.message);
    const rec = (data ?? [])[0] as ItemDb | undefined;
    if (!rec) {
      if (!opts?.silentNotFound) alert(`No item found for SKU "${sku}"`);
      return;
    }

    const uom_code = safeUomCode(rec.uom);
    const balances = await loadLocBalances(rec.id);

    setRows(prev => prev.map(r => {
      if (r.id !== rowId) return r;
      const base = Number(rec.unit_cost || 0);
      const calc = base * (1 + (r.margin_pct || 0) / 100);
      const unit = ceilRupee(calc); // round up
      return {
        ...r,
        sku_input: rec.sku,
        item_id: rec.id,
        description: rec.name || '',
        uom_code,
        base_cost: base,
        tax_rate: Number(rec.tax_rate || 0),
        unit_price: unit,
        // NEW: reset location for this row + provide options
        location: '',
        use_custom_location: false,
        loc_balances: balances,
      };
    }));
  };

  // ===== Debounced SKU auto-lookup (per row)
  const SKU_LOOKUP_DEBOUNCE_MS = 300;
  const skuTimersRef = useRef<Record<string, any>>({});

  useEffect(() => {
    return () => {
      const timers = skuTimersRef.current || {};
      Object.keys(timers).forEach(k => {
        try { clearTimeout(timers[k]); } catch {}
      });
    };
  }, []);

  // Map of refs for each row's SKU input (to focus new rows)
  const skuInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
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

  // ----- row setters (respect rounding rule)
  const setSkuInput = (rowId: string, text: string) => {
    setRows(prev => prev.map(r => r.id === rowId ? { ...r, sku_input: text } : r));

    // Debounced lookup only in SALE + normal typing mode
    if (docType !== 'return' && !barcodeMode) {
      const trimmed = (text || '').trim();

      if (skuTimersRef.current[rowId]) {
        try { clearTimeout(skuTimersRef.current[rowId]); } catch {}
      }

      if (trimmed) {
        skuTimersRef.current[rowId] = setTimeout(() => {
          // silent auto-lookup while typing; no alert if not found
          // optionally trigger only when user typed 3+ chars to reduce noise
          if (trimmed.length >= 3) {
            setItemBySku(rowId, trimmed, { silentNotFound: true });
          }
        }, SKU_LOOKUP_DEBOUNCE_MS);
      }
    }
  };

  const setDescription = (rowId: string, desc: string) =>
    setRows(prev => prev.map(r => r.id === rowId ? { ...r, description: desc } : r));

  const setMargin = (rowId: string, m: number) =>
    setRows(prev => prev.map(r => {
      if (r.id !== rowId) return r;
      const calc = (r.base_cost || 0) * (1 + (m || 0) / 100);
      const unit = ceilRupee(calc);
      return { ...r, margin_pct: m || 0, unit_price: unit };
    }));

  const setTaxRate = (rowId: string, rate: number) =>
    setRows(prev => prev.map(r => r.id === rowId ? { ...r, tax_rate: rate || 0 } : r));

  const setQty = (rowId: string, qty: number) =>
    setRows(prev => prev.map(r => r.id === rowId ? { ...r, qty: qty || 0 } : r));

  const setUnitPrice = (rowId: string, price: number) =>
    setRows(prev => prev.map(r => r.id === rowId ? { ...r, unit_price: ceilRupee(price) } : r));

  const setReturnQty = (rowId: string, ret: number) =>
    setRows(prev => prev.map(r => {
      if (r.id !== rowId) return r;
      const clamped = Math.max(0, Math.min(Number(r.qty || 0), ret || 0));
      return { ...r, return_qty: clamped };
    }));

  // NEW: set row location selection / typing
  const setRowLocation = (rowId: string, loc: string, isCustom: boolean) => {
    setRows(prev => prev.map(r => r.id === rowId ? { ...r, location: loc, use_custom_location: isCustom } : r));
  };

  // ---- Add row + auto-focus its SKU
  const addRow = () => {
    const newRow: Row = {
      id: makeId(), sku_input: '', item_id: '', description: '', uom_code: '',
      base_cost: 0, qty: 1, margin_pct: 0, tax_rate: 0, unit_price: 0,
      issued_margin_pct: 0, return_qty: 0,
      // NEW:
      location: '', use_custom_location: false, loc_balances: [],
    };
    setRows(prev => [...prev, newRow]);
    setTimeout(() => focusSku(newRow.id), 0);
  };

  const removeRow = (rowId: string) => setRows(prev => prev.filter(r => r.id !== rowId));

  // ----- Return: load items by invoice no
  const loadItemsFromInvoiceNo = async () => {
    const invNo = (originalInvoiceNo || '').trim();
    if (!invNo) return alert('Please enter the original invoice no');

    const { data: invs, error: e1 } = await supabase
      .from('invoices')
      .select('id, invoice_no, issued_at, subtotal, tax_total, grand_total')
      .eq('invoice_no', invNo)
      .limit(1);
    if (e1) return alert(e1.message);
    const inv = (invs ?? [])[0];
    if (!inv) return alert('Invoice not found');

    setOriginalGrandTotal(Number(inv.grand_total || 0));

    const { data: lines, error: e2 } = await supabase
      .from('invoice_items')
      .select('item_id, description, qty, unit_price, tax_rate, base_cost_at_sale, margin_pct_at_sale')
      .eq('invoice_id', inv.id);
    if (e2) return alert(e2.message);

    if (!lines || lines.length === 0) {
      setRows([makeEmptyRow()]);
      return;
    }

    const itemIds = Array.from(new Set(lines.map((ln: any) => ln.item_id).filter(Boolean)));
    const { data: items, error: e3 } = await supabase
      .from('items')
      .select('id, sku, name, unit_cost, tax_rate, uom_id')
      .in('id', itemIds);
    if (e3) return alert(e3.message);

    const byId = new Map<string, any>();
    (items ?? []).forEach((it: any) => byId.set(it.id, it));

    let uomMap = new Map<any, string>();
    try {
      const uomIds = Array.from(new Set((items ?? []).map(it => it?.uom_id).filter(Boolean)));
      if (uomIds.length > 0) {
        const { data: uoms } = await supabase
          .from('units_of_measure')
          .select('id, code')
          .in('id', uomIds);
        (uoms ?? []).forEach((u: any) => uomMap.set(u.id, u.code));
      }
    } catch {}

    // NEW: preload location balances per unique item (using cache)
    const balByItem: Record<string, { name: string; qty: number }[]> = {};
    await Promise.all(itemIds.map(async (id) => {
      balByItem[id] = await loadLocBalances(id);
    }));

    const prefilled: Row[] = (lines ?? []).map((ln: any) => {
      const it = byId.get(ln.item_id) || {};
      const uom_code = (it?.uom_id && uomMap.get(it.uom_id)) || '';

      let issued_margin_pct = 0;
      if (typeof ln.margin_pct_at_sale === 'number') {
        issued_margin_pct = Number(ln.margin_pct_at_sale) || 0;
      } else {
        const baseNow = Number(it.unit_cost || 0);
        issued_margin_pct = baseNow > 0 ? Math.ceil(((Number(ln.unit_price || 0) - baseNow) / baseNow) * 100) : 0;
      }

      return {
        id: makeId(),
        sku_input: it?.sku || '',
        item_id: ln.item_id,
        description: ln.description || it?.name || '',
        uom_code,
        base_cost: Number(ln.base_cost_at_sale ?? it?.unit_cost ?? 0),
        qty: Number(ln.qty || 0),
        margin_pct: 0,
        tax_rate: Number(ln.tax_rate || it?.tax_rate || 0),
        unit_price: Number(ln.unit_price || 0),
        issued_margin_pct,
        return_qty: 0,
        // NEW: populate per-item location balances; no default selection
        location: '',
        use_custom_location: false,
        loc_balances: balByItem[ln.item_id] || [],
      };
    });

    setRows(prefilled.length > 0 ? prefilled : [makeEmptyRow()]);
  };

  // ----- totals
  const totals = useMemo(() => {
    let subtotal = 0, tax = 0;
    for (const r of rows) {
      const qty = (docType === 'return' ? Number(r.return_qty || 0) : Number(r.qty || 0));
      const lineAmount = ceilRupee(qty * Number(r.unit_price || 0));
      subtotal += lineAmount;
      const lineTaxRaw = lineAmount * (Number(r.tax_rate || 0) / 100);
      const lineTax = ceilRupee(lineTaxRaw);
      tax += lineTax;
    }
    return { subtotal: ceilRupee(subtotal), tax: ceilRupee(tax), grand: ceilRupee(subtotal + tax) };
  }, [rows, docType]);

  // ----- payments summary (for editor + live payload)
  const computePaymentSummary = () => {
    const paidIn  = (payments || []).filter(p => p.direction === 'in').reduce((s, p) => s + Number(p.amount || 0), 0);
    const paidOut = (payments || []).filter(p => p.direction === 'out').reduce((s, p) => s + Number(p.amount || 0), 0);
    const paidInCeil  = ceilRupee(paidIn);
    const paidOutCeil = ceilRupee(paidOut);
    const grandAtSave = invoiceGrandTotalAtSave ?? totals.grand;
    const balance = docType === 'return'
      ? ceilRupee(grandAtSave - paidOutCeil + paidInCeil)
      : ceilRupee(grandAtSave - paidInCeil + paidOutCeil);
    return {
      paidIn: paidInCeil,
      paidOut: paidOutCeil,
      netPaid: ceilRupee(paidInCeil - paidOutCeil),
      balance,
    };
  };

  // ----- live payload (🆕 now also includes invoiceId so Customer View can pay)
  const buildLivePayload = () => {
    const pay = computePaymentSummary();
    return {
      brand: { name: brandName, logo: brandLogo, address: brandAddress, phone: brandPhone },
      header: { docType, issuedAt, customerName, customerAddress1Line, invoiceNo: invoiceNoJustSaved ?? null, notes },
      invoiceId: invoiceIdJustSaved ?? null, // 🆕
      lines: rows.map(r => {
        const qty = docType === 'return' ? Number(r.return_qty || 0) : Number(r.qty || 0);
        const line_total = ceilRupee(qty * Number(r.unit_price || 0));
        return {
          sku: r.sku_input,
          description: r.description,
          uom_code: r.uom_code,
          qty,
          unit_price: ceilRupee(r.unit_price),
          tax_rate: r.tax_rate,
          line_total,
        };
      }),
      totals,
      payments: (payments || []).map(p => ({
        id: p.id,
        created_at: p.created_at,
        method: p.method,
        direction: p.direction,
        amount: ceilRupee(p.amount),
        reference: p.reference,
      })),
      paySummary: pay,
    };
  };

  // ----- mirror to customer screen
  useEffect(() => {
    if (isCustomerView) return;
    live.post(buildLivePayload());
  }, [
    isCustomerView, rows, totals, docType, issuedAt, customerName, customerAddress1Line,
    payments, invoiceGrandTotalAtSave, invoiceNoJustSaved, notes
  ]);

  // ---------- NEW: validation helpers for locations ----------
  const getSelectedLocQty = (r: Row) => {
    if (!r.location || !r.loc_balances?.length) return 0;
    const found = r.loc_balances.find(l => l.name === r.location);
    return found?.qty ?? 0;
  };

  const validateLocationsBeforeSave = (): string | null => {
    if (docType === 'sale') {
      for (const r of rows) {
        const qtyToIssue = Number(r.qty || 0);
        if (!r.item_id || qtyToIssue <= 0) continue;

        if (!r.location) {
          return `Please select a Location for item ${r.sku_input || r.description || r.item_id}.`;
        }
        const exists = (r.loc_balances || []).some(l => l.name === r.location);
        if (!exists) {
          return `Selected Location "${r.location}" does not exist for item ${r.sku_input || r.description}.`;
        }
        const available = getSelectedLocQty(r);
        if (available < qtyToIssue) {
          return `Insufficient qty at "${r.location}" for item ${r.sku_input || r.description}. Available: ${available}, Required: ${qtyToIssue}.`;
        }
      }
    } else {
      // return
      for (const r of rows) {
        const qtyToReturn = Number(r.return_qty || 0);
        if (!r.item_id || qtyToReturn <= 0) continue;

        if (!r.location) {
          return `Please select/enter a Location for returned item ${r.sku_input || r.description || r.item_id}.`;
        }
        // For return, allow new custom locations, so no existence check required.
        // If not custom, it's from dropdown and exists.
      }
    }
    return null;
  };

  // ----- save invoice/return
  const savingLatch = () => {
    if (savingRef.current || saving) return true;
    savingRef.current = true; setSaving(true);
    return false;
  };
  const saveDone = () => { setSaving(false); savingRef.current = false; };

  const save = async () => {
    if (savingLatch()) return;
    if (!customerId) { saveDone(); return alert('Please lookup or create the customer (by phone) first'); }

    const hasLine = docType === 'return'
      ? rows.some(r => r.item_id && Number(r.return_qty || 0) > 0)
      : rows.some(r => r.item_id && Number(r.qty || 0) > 0);

    if (!hasLine) { saveDone(); return alert('Add at least one line item'); }

    // NEW: validate per-line location
    const locErr = validateLocationsBeforeSave();
    if (locErr) { saveDone(); return alert(locErr); }

    try {
      let invoiceNo = '';
      const { data: nextNo, error: eNo } = await supabase.rpc('next_invoice_no');
      invoiceNo = !eNo && nextNo ? String(nextNo) : 'INV-' + Date.now();

      const { data: inv, error: e1 } = await supabase
        .from('invoices')
        .insert([{
          invoice_no: invoiceNo,
          customer_id: customerId,
          notes,
          subtotal: totals.subtotal,
          tax_total: totals.tax,
          grand_total: totals.grand,
          status: 'sent',
          doc_type: docType,
          issued_at: issuedAt,
        }])
        .select()
        .single();
      if (e1) throw e1;
      const invId = (inv as any).id as string;

      const lineRows =
        (docType === 'return'
          ? rows.filter(r => r.item_id && Number(r.return_qty || 0) > 0)
              .map(r => ({
                invoice_id: invId,
                item_id: r.item_id,
                description: r.description,
                qty: Number(r.return_qty || 0),
                unit_price: ceilRupee(r.unit_price),
                tax_rate: r.tax_rate,
                line_total: ceilRupee(Number(r.return_qty || 0) * ceilRupee(r.unit_price)),
              }))
          : rows.filter(r => r.item_id && Number(r.qty || 0) > 0)
              .map(r => ({
                invoice_id: invId,
                item_id: r.item_id,
                description: r.description,
                qty: Number(r.qty || 0),
                unit_price: ceilRupee(r.unit_price),
                tax_rate: r.tax_rate,
                line_total: ceilRupee(Number(r.qty || 0) * ceilRupee(r.unit_price)),
                base_cost_at_sale: r.base_cost,
                margin_pct_at_sale: r.margin_pct,
              }))
        );

      const { error: e2 } = await supabase.from('invoice_items').insert(lineRows);
      if (e2) throw e2;

      const moveRpc = docType === 'sale' ? 'issue_stock' : 'return_stock';
      for (const r of rows) {
        const qtyToMove = docType === 'return' ? Number(r.return_qty || 0) : Number(r.qty || 0);
        if (!r.item_id || !qtyToMove) continue;
        let client_tx_id = '';
        try { client_tx_id = crypto.randomUUID(); } catch { client_tx_id = makeId(); }
        const { error } = await supabase.rpc(moveRpc, {
          p_item_id: r.item_id, p_qty: qtyToMove, p_ref: invoiceNo, p_reason: docType, p_client_tx_id: client_tx_id,
        });
        if (error) throw error;

        // NEW: attach per-line location to stock_moves via client_tx_id
        if (r.location && r.location.trim()) {
          try {
            await supabase
              .from('stock_moves')
              .update({ location: r.location.trim() })
              .eq('client_tx_id', client_tx_id);
          } catch (e) {
            console.warn('location post-update skipped:', e);
          }
        }
      }

      setInvoiceIdJustSaved(invId);
      setInvoiceNoJustSaved(invoiceNo);
      setInvoiceGrandTotalAtSave(totals.grand);
      await refreshPayments(invId);

      try { live.post(buildLivePayload()); } catch {}

      alert(`${docType === 'return' ? 'Saved return #' : 'Saved invoice #'}${invoiceNo}`);
    } catch (err: any) {
      console.error(err);
      alert(err?.message || String(err));
    } finally { saveDone(); }
  };

  // ----- reset
  const handleNewInvoice = () => {
    setIssuedAt(new Date().toISOString().slice(0, 10));
    setDocType('sale');
    setOriginalInvoiceNo('');
    setCustomerPhone(''); setCustomerId(''); setCustomerName(''); setCustomerAddress1Line('');
    setShowCreateCustomer(false);
    setNewCust({ first_name: '', last_name: '', phone: '', street_name: '', village_town: '', city: '', state: '', postal_code: '' });
    setRows([makeEmptyRow()]);
    setNotes('');
    setSaving(false);
    setInvoiceIdJustSaved(null);
    setInvoiceNoJustSaved(null);
    setInvoiceGrandTotalAtSave(null);
    setCustomerInvoices([]);
    setOriginalGrandTotal(0);
    setPayments([]);
    locCacheRef.current.clear();
  };

  // ----- open customer views
  const openCustomerScreen = () => {
    try { live.post(buildLivePayload()); } catch {}
    const qs = new URLSearchParams();
    qs.set('display', 'customer');
    const final = `${window.location.pathname}?${qs.toString()}`;
    const w = window.open(final, '_blank');
    if (!w) alert('Please allow pop-ups for this site to open the Customer Screen.');
  };
  const openCustomerPrint = () => {
    try { live.post(buildLivePayload()); } catch {}
    const qs = new URLSearchParams();
    qs.set('display', 'customer');
    qs.set('autoprint', '1');
    const final = `${window.location.pathname}?${qs.toString()}`;
    const w = window.open(final, '_blank');
    if (!w) alert('Please allow pop-ups for this site to open the Print view.');
  };

  // ===== Auto-generate QR (UPI read-only) =====
  const buildUpiUri = (upi: string, amount: number, note: string, payeeName: string) => {
    if (!upi) return '';
    const params = new URLSearchParams();
    params.set('pa', upi);
    if (payeeName) params.set('pn', payeeName);
    if (amount > 0) params.set('am', ceilRupee(amount).toString());
    params.set('cu', 'INR');
    if (note) params.set('tn', note);
    return `upi://pay?${params.toString()}`;
  };

  useEffect(() => {
    if (payMethod !== 'qr') return;
    if (!upiId) return;
    let cancelled = false;
    (async () => {
      try {
        setGeneratingQR(true);
        const QR: any = await import('qrcode');
        const upi = buildUpiUri(
          upiId.trim(),
          payAmount || 0,
          payReference || (invoiceNoJustSaved ?? 'Payment'),
          brandName
        );
        const toDataURL = (QR?.toDataURL || QR?.default?.toDataURL);
        const dataUrl = await toDataURL(upi, { margin: 1, scale: 8 });
        if (!cancelled) setQrImageUrl(dataUrl);
      } catch (e: any) {
        if (!cancelled) { console.error(e); alert(e?.message || 'Failed to generate QR'); }
      } finally {
        if (!cancelled) setGeneratingQR(false);
      }
    })();
    return () => { cancelled = true; };
  }, [payMethod, upiId, payAmount, payReference, invoiceNoJustSaved, brandName]);

  // ----- confirm payment (works from both Editor & Customer View)
  const confirmPayment = async () => {
    try {
      // Prefer editor id; else use live payload (customer view)
      const liveInvoiceId = liveState?.invoiceId ?? liveState?.header?.invoiceNo ? liveState?.invoiceId : null;
      const effectiveInvoiceId = invoiceIdJustSaved || liveInvoiceId || null;

      if (!effectiveInvoiceId) return alert('No saved invoice to attach payment.');
      if (!payAmount || payAmount <= 0) return alert('Enter a positive amount.');

      const meta: any = {};
      if (payMethod === 'card') {
        meta.card_holder = cardHolder || null;
        meta.card_last4 = cardLast4 || null;
        meta.card_auth  = cardAuth  || null;
        meta.card_txn   = cardTxn   || null;
      } else if (payMethod === 'qr') {
        meta.qr_image_url = qrImageUrl || null;
        meta.qr_txn       = qrTxn || null;
        meta.upi_id       = upiId || null;
      }

      const payload = {
        invoice_id: effectiveInvoiceId,
        method: payMethod,
        direction: payDirection,
        amount: ceilRupee(payAmount),
        reference: payReference || null,
        meta,
      };

      const { data, error } = await supabase.from('payments').insert([payload]).select().single();
      if (error) throw error;

      setShowPayModal(false);

      if (invoiceIdJustSaved) {
        await refreshPayments(effectiveInvoiceId);
        try { live.post(buildLivePayload()); } catch {}
      }

      if (isCustomerView) {
        setCustPayments([...(custPayments ?? liveState?.payments ?? []), data]);
      }

      if (data?.id) {
        const url = `${window.location.origin}/receipts/${data.id}`;
        window.open(url, '_blank', 'noopener,noreferrer');
      }

      // 🆕 Auto-print on QR payments (both Editor & Customer View)
      if (payMethod === 'qr') {
        setTimeout(() => {
          try { window.print(); } catch {}
        }, 200);
      }
    } catch (err: any) {
      console.error(err);
      alert(err?.message || String(err));
    }
  };

  // 🆕 BARCODE: focus hidden input whenever barcode mode ON
  useEffect(() => {
    if (!barcodeMode) return;
    const t = setTimeout(() => barcodeInputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [barcodeMode]);

  // 🆕 BARCODE: process scanned code
  const processBarcode = async (codeRaw: string) => {
    const code = (codeRaw || '').trim();
    if (!code) return;

    try {
      const { data, error } = await supabase
        .from('items')
        .select('id, sku, name, unit_cost, tax_rate, uom:units_of_measure ( code )')
        .ilike('sku', code)
        .limit(1);
      if (error) throw error;
      const rec = (data ?? [])[0] as ItemDb | undefined;

      if (!rec) {
        alert(`No item found for SKU "${code}"`);
        return;
      }

      // If item row exists, increment qty
      const existing = rows.find(r => r.item_id === rec.id);
      if (existing) {
        setQty(existing.id, Number(existing.qty || 0) + 1);
        // Ensure balances are present for existing row if needed
        if (!existing.loc_balances || existing.loc_balances.length === 0) {
          const balances = await loadLocBalances(rec.id);
          setRows(prev => prev.map(r => r.id === existing.id ? { ...r, loc_balances: balances } : r));
        }
      } else {
        // Use first empty row or create new, set item and qty 1
        let target = rows.find(r => !r.item_id);
        if (!target) {
          target = makeEmptyRow();
          setRows(prev => [...prev, target!]);
        }
        await setItemBySku(target.id, code);
        setQty(target.id, 1);
      }
    } catch (e: any) {
      console.error(e);
      alert(e?.message || 'Scan failed');
    } finally {
      setBarcodeBuffer('');
      setTimeout(() => barcodeInputRef.current?.focus(), 0);
    }
  };

  // =======================
  // Customer Screen only
  // =======================
  if (isCustomerView) {
    const header = liveState?.header ?? { docType, issuedAt, customerName, customerAddress1Line, invoiceNo: invoiceNoJustSaved, notes };
    const liveLines: any[] = liveState?.lines ?? [];
    const liveTotals = liveState?.totals ?? { subtotal: 0, tax: 0, grand: 0 };
    const paymentsList: any[] = (custPayments ?? liveState?.payments) ?? [];
    const paySummary = liveState?.paySummary ?? { paidIn: 0, paidOut: 0, netPaid: 0, balance: liveTotals.grand || 0 };

    const docTitle = header.docType === 'return' ? 'Return' : 'Invoice';

    return (
      <div className="fixed inset-0 bg-white p-4 print:p-0 overflow-auto">
        <style>{`
          /* Shared numeric alignment for screen & print */
          .num { text-align: right; font-variant-numeric: tabular-nums; }

          @media print {
            @page { margin: 8mm; }
            body * { visibility: hidden !important; }
            .print-area, .print-area * { visibility: visible !important; }
            .print-area { position: absolute; left: 0; top: 0; width: 100%; }
            .no-print { display: none !important; }
          }
        `}</style>

        {/* Controls (not printed) */}
        <div className="no-print mb-3 flex gap-2">
          <Button
            type="button"
            onClick={() => {
              const direction = header.docType === 'return' ? 'out' : 'in';
              setPayDirection(direction);
              setPayMethod('cash');
              const baseAmount = Number(paySummary.balance || liveTotals.grand || 0);
              setPayAmount(baseAmount);
              setPayReference(header.invoiceNo ? `Invoice ${header.invoiceNo}` : '');
              setCardHolder(''); setCardLast4(''); setCardAuth(''); setCardTxn('');
              setQrImageUrl(''); setQrTxn('');
              setShowPayModal(true);
            }}
            className="bg-green-600 hover:bg-green-700"
            title="Record a payment"
          >
            Pay
          </Button>

          <Button type="button" onClick={() => window.print()}>Print</Button>
          <Button type="button" onClick={() => window.close()} className="bg-gray-700 hover:bg-gray-800">Close</Button>
        </div>

        {/* Pure Invoice Area */}
        <div className="print-area">
          {/* Brand header */}
          <div className="mb-3 flex items-start gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {brandLogo ? <img src={brandLogo} alt="logo" className="h-12 w-12 rounded bg-white object-contain" /> : null}
            <div>
              <div className="text-2xl font-bold text-orange-600">{brandName}</div>
              <div className="text-sm text-gray-700">{brandAddress}</div>
              <div className="text-sm text-gray-700">Phone: {brandPhone}</div>
            </div>
          </div>

          {/* Minimal doc heading */}
          <div className="mb-3 flex items-start justify-between">
            <div>
              <div className="text-xl font-semibold">{docTitle}</div>
              {header.invoiceNo ? (
                <div className="text-sm text-gray-700">No: {header.invoiceNo}</div>
              ) : null}
              <div className="text-sm text-gray-700">Date: {header.issuedAt || '—'}</div>
            </div>
          </div>

          {/* Bill To */}
          <div className="mb-4">
            <div className="font-semibold">Bill To</div>
            <div>{header.customerName || '—'}</div>
            <div className="text-sm text-gray-700">{header.customerAddress1Line || '—'}</div>
            {header.notes ? (
              <div className="text-sm text-gray-700 mt-1">Notes: {header.notes}</div>
            ) : null}
          </div>

          {/* Lines */}
          <div className="overflow-auto">
            <table className="table w-full">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th style={{ minWidth: 220 }}>Description</th>
                  <th>UoM</th>
                  <th className="num">Qty</th>
                  <th className="num">Unit</th>
                  <th className="num">Tax %</th>
                  <th className="num">Line Total</th>
                </tr>
              </thead>
              <tbody>
                {liveLines.map((ln, idx) => (
                  <tr key={idx}>
                    <td>{ln.sku}</td>
                    <td>{ln.description}</td>
                    <td>{ln.uom_code || '-'}</td>
                    <td className="num">{ln.qty}</td>
                    <td className="num">₹ {Number(ln.unit_price || 0).toFixed(2)}</td>
                    <td className="num">{Number(ln.tax_rate || 0).toFixed(2)}</td>
                    <td className="num">₹ {Number(ln.line_total || 0).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={5}></td>
                  <td className="num font-medium">Subtotal</td>
                  <td className="num">₹ {Number(liveTotals.subtotal || 0).toFixed(2)}</td>
                </tr>
                <tr>
                  <td colSpan={5}></td>
                  <td className="num font-medium">Tax</td>
                  <td className="num">₹ {Number(liveTotals.tax || 0).toFixed(2)}</td>
                </tr>
                <tr className="font-semibold">
                  <td colSpan={5}></td>
                  <td className="num">Total</td>
                  <td className="num">₹ {Number(liveTotals.grand || 0).toFixed(2)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Payments (Customer View) */}
          <div className="mt-4">
            <div className="font-semibold mb-1">Payments</div>
            {(paymentsList.length === 0) ? (
              <div className="text-sm text-gray-600">No payments yet.</div>
            ) : (
              <div className="overflow-auto">
                <table className="table w-full">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Method</th>
                      <th>Direction</th>
                      <th>Reference</th>
                      <th className="num">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paymentsList.map(p => (
                      <tr key={p.id}>
                        <td>{p.created_at ? new Date(p.created_at).toLocaleString() : '—'}</td>
                        <td className="capitalize">{p.method}</td>
                        <td className="uppercase">{p.direction}</td>
                        <td>{p.reference || '—'}</td>
                        <td className="num">₹ {Number(p.amount || 0).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="mt-2 grid sm:grid-cols-2 gap-3">
              <div className="border rounded p-2">
                <div className="flex justify-between"><div>Paid In</div><div>₹ {Number(paySummary.paidIn || 0).toFixed(2)}</div></div>
                <div className="flex justify-between"><div>Refunded (Out)</div><div>₹ {Number(paySummary.paidOut || 0).toFixed(2)}</div></div>
                <div className="flex justify-between font-semibold"><div>Net Paid</div><div>₹ {Number(paySummary.netPaid || 0).toFixed(2)}</div></div>
              </div>
              <div className="border rounded p-2">
                <div className="flex justify-between font-semibold">
                  <div>{header.docType === 'return' ? 'Refund Remaining' : 'Balance Due'}</div>
                  <div>₹ {Number(paySummary.balance || 0).toFixed(2)}</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ---- Pay Modal (Customer View) ---- */}
        {showPayModal && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
            <div className="bg-white rounded shadow-lg p-4 w-full max-w-md">
              <div className="text-lg font-semibold mb-2">{header.docType === 'return' ? 'Refund' : 'Receive Payment'}</div>

              <div className="mb-3">
                <label className="label">Method</label>
                <div className="grid grid-cols-4 gap-2">
                  {(['cash','card','qr','other'] as const).map(m => (
                    <button
                      key={m}
                      type="button"
                      className={`px-3 py-2 rounded border ${payMethod===m ? 'bg-orange-600 text-white' : 'bg-white hover:bg-gray-50'}`}
                      onClick={() => setPayMethod(m)}
                    >
                      {m.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              {/* Card meta */}
              {payMethod === 'card' && (
                <div className="mb-3 grid grid-cols-2 gap-3">
                  <div><label className="label">Card Holder</label><input className="input" value={cardHolder} onChange={(e)=>setCardHolder(e.target.value)} /></div>
                  <div><label className="label">Last 4</label><input className="input" value={cardLast4} maxLength={4} onChange={(e)=>setCardLast4(e.target.value.replace(/\D/g,''))} /></div>
                  <div><label className="label">Auth Code</label><input className="input" value={cardAuth} onChange={(e)=>setCardAuth(e.target.value)} /></div>
                  <div><label className="label">Txn ID</label><input className="input" value={cardTxn} onChange={(e)=>setCardTxn(e.target.value)} /></div>
                </div>
              )}

              {/* QR meta — auto QR (UPI read-only) */}
              {payMethod === 'qr' && (
                <div className="mb-3 grid grid-cols-1 gap-3">
                  <div className="text-sm font-semibold text-gray-800">Scan‑to‑Pay</div>

                  <div>
                    <label className="label">UPI ID (read‑only)</label>
                    <input className="input" value={upiId} readOnly />
                  </div>

                  <div className="mt-2 border rounded p-2 flex flex-col items-center">
                    {!qrImageUrl ? (
                      <div className="text-sm text-gray-600">
                        {generatingQR ? 'Generating QR…' : 'QR will appear here'}
                      </div>
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={qrImageUrl} alt="QR" className="max-h-40 object-contain" />
                    )}
                    {upiId && <div className="mt-2 text-xs text-gray-700">UPI ID: <b>{upiId}</b></div>}
                  </div>

                  <div><label className="label">Txn ID (optional)</label><input className="input" value={qrTxn} onChange={(e)=>setQrTxn(e.target.value)} /></div>
                </div>
              )}

              <div className="mb-3 grid grid-cols-2 gap-3">
                <div>
                  <label className="label">{header.docType === 'return' ? 'Refund Amount' : 'Amount Received'}</label>
                  <input className="input" type="number" step="0.01" min={0} value={payAmount} onChange={(e) => setPayAmount(parseFloat(e.target.value || '0'))} />
                </div>
                <div>
                  <label className="label">Direction</label>
                  <select className="input" value={payDirection} onChange={(e) => setPayDirection(e.target.value as 'in'|'out')}>
                    <option value="in">IN (receive)</option>
                    <option value="out">OUT (refund)</option>
                  </select>
                </div>
              </div>

              <div className="mb-3">
                <label className="label">Reference (txn no / note)</label>
                <input className="input" value={payReference} onChange={(e) => setPayReference(e.target.value)} placeholder="Optional" />
              </div>

              <div className="flex items-center gap-2 mb-3">
                <button
                  type="button"
                  className="px-3 py-1 rounded bg-gray-200 hover:bg-gray-300 text-sm"
                  onClick={() => setPayAmount(Number(liveTotals.grand || 0))}
                >
                  Full Amount
                </button>
                <button
                  type="button"
                  className="px-3 py-1 rounded bg-gray-200 hover:bg-gray-300 text-sm"
                  onClick={() => {
                    const grandAtSave = Number(liveTotals.grand || 0);
                    const paidInLive = Number(paySummary.paidIn || 0);
                    const paidOutLive = Number(paySummary.paidOut || 0);
                    const remaining = header.docType === 'return'
                      ? grandAtSave - paidOutLive + paidInLive
                      : grandAtSave - paidInLive + paidOutLive;
                    setPayAmount(ceilRupee(Math.max(0, remaining)));
                  }}
                >
                  Remaining
                </button>
              </div>

              <div className="flex justify-end gap-2">
                <button type="button" className="px-3 py-2 rounded bg-gray-200 hover:bg-gray-300" onClick={() => setShowPayModal(false)}>Cancel</button>
                <button type="button" className="px-3 py-2 rounded bg-green-600 hover:bg-green-700 text-white" onClick={confirmPayment}>Confirm</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // =======================
  // User Screen (editor)
  // =======================
  const isReturn = docType === 'return';

  const paidIn  = useMemo(() => computePaymentSummary().paidIn,  [payments, totals.grand, invoiceGrandTotalAtSave, docType]);
  const paidOut = useMemo(() => computePaymentSummary().paidOut, [payments, totals.grand, invoiceGrandTotalAtSave, docType]);
  const netPaid = useMemo(() => computePaymentSummary().netPaid, [payments, totals.grand, invoiceGrandTotalAtSave, docType]);
  const balance = useMemo(() => computePaymentSummary().balance,[payments, totals.grand, invoiceGrandTotalAtSave, docType]);

  // --------- UI helper to render Location cell per row ----------
  const LocationCell = ({ row }: { row: Row }) => {
    const hasOptions = (row.loc_balances?.length || 0) > 0;
    if (!isReturn) {
      // SALE (Issue): must pick existing location
      return (
        <div>
          <select
            className="input"
            value={row.location || ''}
            onChange={(e) => setRowLocation(row.id, e.target.value, false)}
            disabled={!row.item_id}
            title="Select Location to issue from"
          >
            <option value="">Select location…</option>
            {(row.loc_balances || []).map(l => (
              <option key={l.name} value={l.name}>
                {l.name} — {l.qty}
              </option>
            ))}
          </select>
          {row.location && (
            <div className="text-xs text-gray-600 mt-1">
              Available: <b>{getSelectedLocQty(row)}</b> {row.uom_code || ''}
            </div>
          )}
          {!hasOptions && row.item_id && (
            <div className="text-xs text-amber-600 mt-1">
              No locations found for this item.
            </div>
          )}
        </div>
      );
    }

    // RETURN: choose existing or "Other/New"
    const value = row.use_custom_location ? '__NEW__' : (row.location || '');
    return (
      <div className="grid grid-cols-2 gap-2">
        <select
          className="input"
          value={value}
          onChange={(e) => {
            const v = e.target.value;
            if (v === '__NEW__') {
              setRowLocation(row.id, '', true);
            } else {
              setRowLocation(row.id, v, false);
            }
          }}
          disabled={!row.item_id}
          title="Select Location to return to"
        >
          <option value="">{hasOptions ? 'Select existing…' : 'No locations yet'}</option>
          {(row.loc_balances || []).map(l => (
            <option key={l.name} value={l.name}>
              {l.name} — {l.qty}
            </option>
          ))}
          <option value="__NEW__">Other / New…</option>
        </select>
        <input
          className="input"
          placeholder="Type new location"
          value={row.use_custom_location ? (row.location || '') : ''}
          onChange={(e) => setRowLocation(row.id, e.target.value, true)}
          disabled={!row.item_id || !row.use_custom_location}
        />
      </div>
    );
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

      {/* Editor Header */}
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
            {/* 🆕 Barcode Mode Toggle */}
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

            <Button type="button" onClick={openCustomerScreen}>Open Customer Screen</Button>
            <Button type="button" onClick={openCustomerPrint} className="bg-gray-700 hover:bg-gray-800">Print</Button>
            <Button type="button" onClick={handleNewInvoice} className="bg-gray-700 hover:bg-gray-800">
              New {isReturn ? 'Return' : 'Invoice'}
            </Button>
          </div>
        </div>
      </div>

      <div className="card">
        <h1 className="text-xl font-semibold mb-4">New {isReturn ? 'Return' : 'Invoice'}</h1>

        {/* Top */}
        <div className="grid md-grid-cols-3 md:grid-cols-3 gap-3 mb-4">
          <div>
            <label className="label">Type</label>
            <select
              className="input"
              value={docType}
              onChange={(e) => {
                const v = e.target.value as DocType;
                setDocType(v);
                if (v === 'sale') {
                  setOriginalInvoiceNo('');
                  setCustomerInvoices([]);
                  setOriginalGrandTotal(0);
                  setRows([makeEmptyRow()]);
                }
              }}
            >
              <option value="sale">Sale</option>
              <option value="return">Return</option>
            </select>
          </div>

          <div>
            <label className="label">Invoice Date</label>
            <input className="input" type="date" value={issuedAt} onChange={(e) => setIssuedAt(e.target.value)} />
          </div>

          <div>
            <label className="label">Notes</label>
            <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes" />
          </div>
        </div>

        {/* Return helpers */}
        {isReturn && (
          <div className="card mb-4">
            <div className="grid md:grid-cols-3 gap-3 items-end">
              <div>
                <label className="label">Original Invoice No</label>
                <input
                  className="input"
                  placeholder="Enter original invoice no (e.g., INV-123)"
                  value={originalInvoiceNo}
                  onChange={(e) => setOriginalInvoiceNo(e.target.value)}
                />
              </div>
              <div><Button type="button" onClick={loadItemsFromInvoiceNo}>Load Items</Button></div>
              <div className="text-sm text-gray-600">Loads items from original invoice. Enter <b>Return Qty</b> only.</div>
            </div>

            {customerInvoices.length > 0 && (
              <div className="mt-4 grid md:grid-cols-3 gap-3 items-end">
                <div className="md:col-span-2">
                  <label className="label">Select Customer Invoice</label>
                  <select className="input" value={originalInvoiceNo} onChange={(e) => setOriginalInvoiceNo(e.target.value)}>
                    <option value="">-- Choose invoice --</option>
                    {customerInvoices.map(inv => (
                      <option key={inv.id} value={inv.invoice_no}>
                        {inv.invoice_no} {inv.issued_at ? `• ${inv.issued_at}` : ''} {typeof inv.grand_total === 'number' ? `• ₹ ${inv.grand_total?.toFixed(2)}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div><Button type="button" onClick={loadItemsFromInvoiceNo}>Load Selected</Button></div>
              </div>
            )}
          </div>
        )}

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
              {!isReturn ? (
                <tr>
                  <th style={{ minWidth: 160 }}>Item (SKU)</th>
                  <th style={{ minWidth: 220 }}>Description</th>
                  <th style={{ minWidth: 80 }}>UoM</th>
                  <th style={{ minWidth: 110 }}>Current Cost</th>
                  <th style={{ minWidth: 140 }}>Location</th>{/* NEW */}
                  <th style={{ minWidth: 80 }}>Qty</th>
                  <th style={{ minWidth: 110 }}>Margin %</th>
                  <th style={{ minWidth: 80 }}>Tax %</th>
                  <th style={{ minWidth: 120 }}>Unit Price</th>
                  <th style={{ minWidth: 120 }}>Line Total</th>
                  <th></th>
                </tr>
              ) : (
                <tr>
                  <th style={{ minWidth: 120 }}>SKU</th>
                  <th style={{ minWidth: 220 }}>Description</th>
                  <th style={{ minWidth: 80 }}>UoM</th>
                  <th className="text-right" style={{ minWidth: 90 }}>Qty (Sold)</th>
                  <th className="text-right" style={{ minWidth: 80 }}>Tax %</th>
                  <th className="text-right" style={{ minWidth: 120 }}>Line Total</th>
                  <th style={{ minWidth: 180 }}>Location</th>{/* NEW */}
                  <th className="text-right" style={{ minWidth: 110 }}>Return Qty</th>
                  <th className="text-right" style={{ minWidth: 130 }}>Return Amount</th>
                  <th className="text-right" style={{ minWidth: 130 }}>Remaining</th>
                </tr>
              )}
            </thead>

            <tbody>
              {rows.map((r) => {
                if (!isReturn) {
                  const lineTotal = ceilRupee((r.qty || 0) * (r.unit_price || 0));
                  return (
                    <tr key={r.id}>
                      <td>
                        <input
                          className="input"
                          placeholder={barcodeMode ? "Scan barcode…" : "Type/Scan SKU (auto-lookup) or press Enter"}
                          value={r.sku_input}
                          onChange={(e) => setSkuInput(r.id, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); setItemBySku(r.id, r.sku_input); }
                          }}
                          onBlur={() => {
                            // Final attempt when leaving field: show alert if not found
                            const v = (r.sku_input || '').trim();
                            if (!r.item_id && v) setItemBySku(r.id, v);
                          }}
                          readOnly={barcodeMode}
                          title={barcodeMode ? 'Barcode Mode ON: SKU is read-only. Scan to add/increase.' : undefined}
                          ref={(el) => { skuInputRefs.current[r.id] = el; }}
                        />
                      </td>
                      <td><input className="input" placeholder="Description" value={r.description} onChange={(e) => setDescription(r.id, e.target.value)} /></td>
                      <td><input className="input" value={r.uom_code || ''} readOnly placeholder="-" /></td>
                      <td><input className="input" value={ceilRupee(r.base_cost).toFixed(2)} readOnly /></td>

                      {/* NEW: SALE Location cell */}
                      <td><LocationCell row={r} /></td>

                      <td><input className="input" type="number" min={0} step="1" value={r.qty} onChange={(e) => setQty(r.id, parseFloat(e.target.value || '0'))} /></td>
                      <td><input className="input" type="number" step="0.01" value={r.margin_pct} onChange={(e) => setMargin(r.id, parseFloat(e.target.value || '0'))} /></td>
                      <td><input className="input" type="number" step="0.01" value={r.tax_rate} onChange={(e) => setTaxRate(r.id, parseFloat(e.target.value || '0'))} /></td>
                      <td><input className="input" type="number" step="0.01" value={r.unit_price} onChange={(e) => setUnitPrice(r.id, parseFloat(e.target.value || '0'))} /></td>
                      <td>₹ {lineTotal.toFixed(2)}</td>
                      <td><button type="button" className="text-red-600 hover:underline" onClick={() => removeRow(r.id)}>Remove</button></td>
                    </tr>
                  );
                }

                // Return row
                const soldLineTotal = ceilRupee(Number(r.qty || 0) * Number(r.unit_price || 0));
                const retQty = Number(r.return_qty || 0);
                const returnAmount = ceilRupee(retQty * Number(r.unit_price || 0));
                const remaining = ceilRupee(soldLineTotal - returnAmount);

                return (
                  <tr key={r.id}>
                    <td><input className="input" value={r.sku_input} readOnly /></td>
                    <td>
                      <input className="input" value={r.description} readOnly />
                      <div className="text-xs text-gray-600 mt-1">Issued Margin: {Number(r.issued_margin_pct ?? 0).toFixed(2)}%</div>
                    </td>
                    <td><input className="input" value={r.uom_code || ''} readOnly placeholder="-" /></td>
                    <td className="text-right"><input className="input text-right" value={r.qty} readOnly /></td>
                    <td className="text-right"><input className="input text-right" value={Number(r.tax_rate).toFixed(2)} readOnly /></td>
                    <td className="text-right">₹ {soldLineTotal.toFixed(2)}</td>

                    {/* NEW: RETURN Location cell */}
                    <td><LocationCell row={r} /></td>

                    <td className="text-right">
                      <input className="input text-right" type="number" min={0} max={r.qty} step="1" value={retQty} onChange={(e) => setReturnQty(r.id, parseFloat(e.target.value || '0'))} />
                    </td>
                    <td className="text-right">₹ {returnAmount.toFixed(2)}</td>
                    <td className="text-right">₹ {remaining.toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>

            <tfoot>
              {!isReturn ? (
                <tr><td colSpan={11}><Button type="button" onClick={addRow}>+ Add Line</Button></td></tr>
              ) : (
                <tr><td colSpan={11} className="text-sm text-gray-600">All item details are read-only in Return mode. Enter <b>Return Qty</b> and select <b>Location</b>.</td></tr>
              )}
            </tfoot>
          </table>
        </div>

        {/* Totals + Save + Pay */}
        <div className="mt-6 grid lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-4">
            {isReturn && (
              <div className="card">
                <div className="flex justify-between"><div>Original Invoice Total</div><div>₹ {Number(originalGrandTotal || 0).toFixed(2)}</div></div>
                <div className="flex justify-between"><div>Return Total (this document)</div><div>₹ {totals.grand.toFixed(2)}</div></div>
                <div className="flex justify-between font-semibold"><div>Remaining After Return</div><div>₹ {(Number(originalGrandTotal || 0) - totals.grand).toFixed(2)}</div></div>
              </div>
            )}

            {invoiceIdJustSaved && (
              <div className="card">
                <div className="mb-2 font-semibold">Payments</div>
                {paymentsLoading ? (
                  <div className="text-sm text-gray-600">Loading payments…</div>
                ) : payments.length === 0 ? (
                  <div className="text-sm text-gray-600">No payments yet.</div>
                ) : (
                  <div className="overflow-auto">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>When</th>
                          <th>Method</th>
                          <th>Direction</th>
                          <th>Reference</th>
                          <th className="text-right">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {payments.map(p => (
                          <tr key={p.id}>
                            <td>{new Date(p.created_at).toLocaleString()}</td>
                            <td className="capitalize">{p.method}</td>
                            <td className="uppercase">{p.direction}</td>
                            <td>{p.reference || '—'}</td>
                            <td className="text-right">₹ {Number(p.amount || 0).toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="mt-3 grid sm:grid-cols-2 gap-2">
                  <div className="card">
                    <div className="flex justify-between"><div>Paid In</div><div>₹ {paidIn.toFixed(2)}</div></div>
                    <div className="flex justify-between"><div>Refunded (Out)</div><div>₹ {paidOut.toFixed(2)}</div></div>
                    <div className="flex justify-between font-semibold"><div>Net Paid</div><div>₹ {netPaid.toFixed(2)}</div></div>
                  </div>
                  <div className="card">
                    <div className="flex justify-between font-semibold">
                      <div>{isReturn ? 'Refund Remaining' : 'Balance Due'}</div>
                      <div>₹ {balance.toFixed(2)}</div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="card">
            <div className="flex justify-between"><div>Subtotal</div><div>₹ {totals.subtotal.toFixed(2)}</div></div>
            <div className="flex justify-between"><div>Tax</div><div>₹ {totals.tax.toFixed(2)}</div></div>
            <div className="flex justify-between font-semibold text-lg"><div>Total</div><div>₹ {totals.grand.toFixed(2)}</div></div>

            <div className="mt-4 flex gap-2 flex-wrap">
              <Button type="button" onClick={save} disabled={saving}>
                {saving ? 'Saving…' : isReturn ? 'Save Return' : 'Save Invoice'}
              </Button>
              <Button type="button" onClick={openCustomerPrint} className="bg-gray-700 hover:bg-gray-800">Print</Button>
              <Button
                type="button"
                onClick={() => {
                  if (!invoiceIdJustSaved) { alert('Please save the invoice/return first, then record payment.'); return; }
                  const direction = docType === 'return' ? 'out' : 'in';
                  setPayDirection(direction);
                  setPayMethod('cash');
                  const baseAmount = invoiceGrandTotalAtSave ?? totals.grand;
                  setPayAmount(Number(baseAmount || 0));
                  setPayReference('');
                  setCardHolder(''); setCardLast4(''); setCardAuth(''); setCardTxn('');
                  setQrImageUrl(''); setQrTxn('');
                  setShowPayModal(true);
                }}
                className="bg-green-600 hover:bg-green-700"
                disabled={!invoiceIdJustSaved}
                title={!invoiceIdJustSaved ? 'Save first to record payments' : ''}
              >
                Pay
              </Button>
              {invoiceNoJustSaved && <div className="text-sm text-gray-600 self-center">Saved #{invoiceNoJustSaved}</div>}
            </div>
          </div>
        </div>
      </div>

      {/* ---- Pay Modal (Editor) ---- */}
      {showPayModal && !isCustomerView && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded shadow-lg p-4 w-full max-w-md">
            <div className="text-lg font-semibold mb-2">{isReturn ? 'Refund' : 'Receive Payment'}</div>

            <div className="mb-3">
              <label className="label">Method</label>
              <div className="grid grid-cols-4 gap-2">
                {(['cash','card','qr','other'] as const).map(m => (
                  <button
                    key={m}
                    type="button"
                    className={`px-3 py-2 rounded border ${payMethod===m ? 'bg-orange-600 text-white' : 'bg-white hover:bg-gray-50'}`}
                    onClick={() => setPayMethod(m)}
                  >
                    {m.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            {/* Card meta */}
            {payMethod === 'card' && (
              <div className="mb-3 grid grid-cols-2 gap-3">
                <div><label className="label">Card Holder</label><input className="input" value={cardHolder} onChange={(e)=>setCardHolder(e.target.value)} /></div>
                <div><label className="label">Last 4</label><input className="input" value={cardLast4} maxLength={4} onChange={(e)=>setCardLast4(e.target.value.replace(/\D/g,''))} /></div>
                <div><label className="label">Auth Code</label><input className="input" value={cardAuth} onChange={(e)=>setCardAuth(e.target.value)} /></div>
                <div><label className="label">Txn ID</label><input className="input" value={cardTxn} onChange={(e)=>setCardTxn(e.target.value)} /></div>
              </div>
            )}

            {/* QR meta — auto QR (UPI read-only) */}
            {payMethod === 'qr' && (
              <div className="mb-3 grid grid-cols-1 gap-3">
                <div className="text-sm font-semibold text-gray-800">Scan‑to‑Pay</div>

                <div>
                  <label className="label">UPI ID (read‑only)</label>
                  <input className="input" value={upiId} readOnly />
                </div>

                <div className="mt-2 border rounded p-2 flex flex-col items-center">
                  {!qrImageUrl ? (
                    <div className="text-sm text-gray-600">
                      {generatingQR ? 'Generating QR…' : 'QR will appear here'}
                    </div>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={qrImageUrl} alt="QR" className="max-h-40 object-contain" />
                  )}
                  {upiId && <div className="mt-2 text-xs text-gray-700">UPI ID: <b>{upiId}</b></div>}
                </div>

                <div><label className="label">Txn ID (optional)</label><input className="input" value={qrTxn} onChange={(e)=>setQrTxn(e.target.value)} /></div>
              </div>
            )}

            <div className="mb-3 grid grid-cols-2 gap-3">
              <div>
                <label className="label">{isReturn ? 'Refund Amount' : 'Amount Received'}</label>
                <input className="input" type="number" step="0.01" min={0} value={payAmount} onChange={(e) => setPayAmount(parseFloat(e.target.value || '0'))} />
              </div>
              <div>
                <label className="label">Direction</label>
                <select className="input" value={payDirection} onChange={(e) => setPayDirection(e.target.value as 'in'|'out')}>
                  <option value="in">IN (receive)</option>
                  <option value="out">OUT (refund)</option>
                </select>
              </div>
            </div>

            <div className="mb-3">
              <label className="label">Reference (txn no / note)</label>
              <input className="input" value={payReference} onChange={(e) => setPayReference(e.target.value)} placeholder="Optional" />
            </div>

            <div className="flex items-center gap-2 mb-3">
              <button type="button" className="px-3 py-1 rounded bg-gray-200 hover:bg-gray-300 text-sm" onClick={() => setPayAmount(Number((invoiceGrandTotalAtSave ?? totals.grand) || 0))}>
                Full Amount
              </button>
              {invoiceIdJustSaved && (
                <button
                  type="button"
                  className="px-3 py-1 rounded bg-gray-200 hover:bg-gray-300 text-sm"
                  onClick={() => {
                    const grandAtSave = invoiceGrandTotalAtSave ?? totals.grand;
                    const remaining = isReturn ? grandAtSave - paidOut + paidIn : grandAtSave - paidIn + paidOut;
                    setPayAmount(ceilRupee(Math.max(0, remaining)));
                  }}
                >
                  Remaining
                </button>
              )}
            </div>

            <div className="flex justify-end gap-2">
              <button type="button" className="px-3 py-2 rounded bg-gray-200 hover:bg-gray-300" onClick={() => setShowPayModal(false)}>Cancel</button>
              <button type="button" className="px-3 py-2 rounded bg-green-600 hover:bg-green-700 text-white" onClick={confirmPayment}>Confirm</button>
            </div>
          </div>
        </div>
      )}
    </Protected>
  );
}
