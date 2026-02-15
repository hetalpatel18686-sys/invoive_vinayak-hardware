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
  unit_cost: number; // avg cost from stock
  tax_rate: number;
  uom: { code?: string }[] | { code?: string } | null;
}

interface Row {
  id: string;
  sku_input: string;  // typed/scanned SKU
  item_id: string;
  description: string;
  uom_code: string;
  base_cost: number;  // from items.unit_cost
  qty: number;
  margin_pct: number;
  tax_rate: number;
  unit_price: number; // editable (cost + margin%)
}

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
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
    .map((s) => String(s).trim())
    .join(', ');
}

/** Live mirror channel (User → Customer tab) */
class LiveChannel {
  ch: BroadcastChannel | null = null;
  constructor(name = 'invoice-live') {
    try { this.ch = new BroadcastChannel(name); } catch { this.ch = null; }
  }
  post(data: any) { try { this.ch?.postMessage(data); } catch {} }
  on(fn: (data: any) => void) {
    if (!this.ch) return () => {};
    const handler = (ev: MessageEvent) => fn(ev.data);
    this.ch.addEventListener('message', handler);
    return () => this.ch?.removeEventListener('message', handler);
  }
}
const live = new LiveChannel('invoice-live');

export default function NewInvoicePage() {
  // Determine view from URL (no useSearchParams)
  const [isCustomerView, setIsCustomerView] = useState(false);
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const sp = new URLSearchParams(window.location.search);
      setIsCustomerView(sp.get('display') === 'customer');
    }
  }, []);

  // Brand
  const brandName    = process.env.NEXT_PUBLIC_BRAND_NAME     || 'Vinayak Hardware';
  const brandLogo    = process.env.NEXT_PUBLIC_BRAND_LOGO_URL || '/logo.png';
  const brandAddress = process.env.NEXT_PUBLIC_BRAND_ADDRESS  || 'Bilimora, Gandevi, Navsari, Gujarat, 396321';
  const brandPhone   = process.env.NEXT_PUBLIC_BRAND_PHONE    || '+91 7046826808';

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
    first_name: '',
    last_name: '',
    phone: '',
    street_name: '',
    village_town: '',
    city: '',
    state: '',
    postal_code: '',
  });

  // Rows + state
  const [rows, setRows] = useState<Row[]>([]);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [invoiceIdJustSaved, setInvoiceIdJustSaved] = useState<string | null>(null);
  const [invoiceNoJustSaved, setInvoiceNoJustSaved] = useState<string | null>(null);
  const savingRef = useRef(false);

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
      margin_pct: 0,
      tax_rate: 0,
      unit_price: 0,
    };
  }

  // -------- Customer lookup & create --------
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

  // -------- Item by SKU (type/scan then Enter) --------
  const setItemBySku = async (rowId: string, skuRaw: string) => {
    const sku = (skuRaw || '').trim();
    if (!sku) return;
    const { data, error } = await supabase
      .from('items')
      .select('id, sku, name, unit_cost, tax_rate, uom:units_of_measure ( code )')
      .ilike('sku', sku)
      .limit(1);
    if (error) return alert(error.message);
    const rec = (data ?? [])[0] as ItemDb | undefined;
    if (!rec) return alert(`No item found for SKU "${sku}"`);

    const uom_code = safeUomCode(rec.uom);
    setRows(prev => prev.map(r => {
      if (r.id !== rowId) return r;
      const base = Number(rec.unit_cost || 0);
      const unit = round2(base * (1 + (r.margin_pct || 0) / 100));
      return {
        ...r,
        sku_input: rec.sku,
        item_id: rec.id,
        description: rec.name || '',
        uom_code,
        base_cost: base,
        tax_rate: Number(rec.tax_rate || 0),
        unit_price: unit,
      };
    }));
  };

  // -------- Row setters --------
  const setSkuInput = (rowId: string, text: string) => setRows(prev => prev.map(r => r.id === rowId ? { ...r, sku_input: text } : r));
  const setDescription = (rowId: string, desc: string) => setRows(prev => prev.map(r => r.id === rowId ? { ...r, description: desc } : r));
  const setMargin = (rowId: string, m: number) => setRows(prev => prev.map(r => {
    if (r.id !== rowId) return r;
    const unit = round2((r.base_cost || 0) * (1 + (m || 0) / 100));
    return { ...r, margin_pct: m || 0, unit_price: unit };
  }));
  const setTaxRate = (rowId: string, rate: number) => setRows(prev => prev.map(r => r.id === rowId ? { ...r, tax_rate: rate || 0 } : r));
  const setQty = (rowId: string, qty: number) => setRows(prev => prev.map(r => r.id === rowId ? { ...r, qty: qty || 0 } : r));
  const setUnitPrice = (rowId: string, price: number) => setRows(prev => prev.map(r => r.id === rowId ? { ...r, unit_price: price || 0 } : r));
  const addRow = () => setRows(prev => [...prev, makeEmptyRow()]);
  const removeRow = (rowId: string) => setRows(prev => prev.filter(r => r.id !== rowId));

  // -------- Return: load by invoice no --------
  const loadItemsFromInvoiceNo = async () => {
    const invNo = (originalInvoiceNo || '').trim();
    if (!invNo) return alert('Please enter the original invoice no');

    const { data: invs, error: e1 } = await supabase
      .from('invoices')
      .select('id, invoice_no')
      .eq('invoice_no', invNo)
      .limit(1);
    if (e1) return alert(e1.message);
    const inv = (invs ?? [])[0];
    if (!inv) return alert('Invoice not found');

    const { data: lines, error: e2 } = await supabase
      .from('invoice_items')
      .select('item_id, description, qty, unit_price, tax_rate, items:items ( sku, name, unit_cost, tax_rate, uom:units_of_measure ( code ) )')
      .eq('invoice_id', inv.id);
    if (e2) return alert(e2.message);

    const prefilled: Row[] = (lines ?? []).map((ln: any) => {
      const uom_code = safeUomCode(ln.items?.uom ?? null);
      const base = Number(ln.items?.unit_cost || 0);
      return {
        id: makeId(),
        sku_input: ln.items?.sku || '',
        item_id: ln.item_id,
        description: ln.description || ln.items?.name || '',
        uom_code,
        base_cost: base,
        qty: 1, // default for return
        margin_pct: 0,
        tax_rate: Number(ln.tax_rate || ln.items?.tax_rate || 0),
        unit_price: Number(ln.unit_price || 0),
      };
    });
    setRows(prefilled.length > 0 ? prefilled : [makeEmptyRow()]);
  };

  // -------- Totals --------
  const totals = useMemo(() => {
    let subtotal = 0, tax = 0;
    for (const r of rows) {
      const line = (r.qty || 0) * (r.unit_price || 0);
      subtotal += line;
      tax += line * ((r.tax_rate || 0) / 100);
    }
    return { subtotal: round2(subtotal), tax: round2(tax), grand: round2(subtotal + tax) };
  }, [rows]);

  // -------- Live mirror to Customer Screen --------
  useEffect(() => {
    if (isCustomerView) return; // customer listens only
    const payload = {
      brand: { name: brandName, logo: brandLogo, address: brandAddress, phone: brandPhone },
      header: { docType, issuedAt, customerName, customerAddress1Line },
      lines: rows.map(r => ({
        sku: r.sku_input,
        description: r.description,
        uom_code: r.uom_code,
        qty: r.qty,
        unit_price: r.unit_price,
        tax_rate: r.tax_rate,
        line_total: round2(r.qty * r.unit_price),
      })),
      totals,
    };
    live.post({ type: 'invoice-update', payload });
  }, [isCustomerView, rows, totals, brandName, brandLogo, brandAddress, brandPhone, docType, issuedAt, customerName, customerAddress1Line]);

  // -------- Save --------
  const savingLatch = () => {
    if (savingRef.current || saving) return true;
    savingRef.current = true; setSaving(true);
    return false;
  };
  const saveDone = () => { setSaving(false); savingRef.current = false; };

  const save = async () => {
    if (savingLatch()) return;
    if (!customerId) { saveDone(); return alert('Please lookup or create the customer (by phone) first'); }
    const hasLine = rows.some(r => r.item_id && r.qty > 0);
    if (!hasLine) { saveDone(); return alert('Add at least one line item'); }

    try {
      // next invoice no (fallback)
      let invoiceNo = '';
      const { data: nextNo, error: eNo } = await supabase.rpc('next_invoice_no');
      invoiceNo = !eNo && nextNo ? String(nextNo) : 'INV-' + Date.now();

      // invoice
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

      // invoice lines
      const lineRows = rows
        .filter(r => r.item_id && r.qty > 0)
        .map(r => ({
          invoice_id: invId,
          item_id: r.item_id,
          description: r.description,
          qty: r.qty,
          unit_price: r.unit_price,
          tax_rate: r.tax_rate,
          line_total: round2(r.qty * r.unit_price),
        }));
      const { error: e2 } = await supabase.from('invoice_items').insert(lineRows);
      if (e2) throw e2;

      // stock moves (idempotent)
      const moveRpc = docType === 'sale' ? 'issue_stock' : 'return_stock';
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (!r.item_id || !r.qty) continue;
        const client_tx_id = makeId(); // real UUID value
        const { error } = await supabase.rpc(moveRpc, {
          p_item_id: r.item_id,
          p_qty: r.qty,
          p_ref: invoiceNo,
          p_reason: docType,
          p_client_tx_id: client_tx_id,
        });
        if (error) throw error;
      }

      setInvoiceIdJustSaved(invId);
      setInvoiceNoJustSaved(invoiceNo);
      alert('Saved invoice #' + invoiceNo);
    } catch (err: any) {
      console.error(err);
      // If you see: "Could not find the table 'public.invoice'" → rename to invoices (plural)
      alert(err?.message || String(err));
    } finally {
      saveDone();
    }
  };

  // -------- Reset --------
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
  };

  // -------- Open Customer Screen --------
  const openCustomerScreen = () => {
    const url = new URL(window.location.href);
    url.searchParams.set('display', 'customer');
    window.open(url.toString(), '_blank', 'noopener,noreferrer');
  };

  // =======================
  // Customer Screen only
  // =======================
  if (isCustomerView) {
    const [liveState, setLiveState] = useState<any>(null);
    useEffect(() => {
      const off = live.on((msg) => { if (msg?.type === 'invoice-update') setLiveState(msg.payload); });
      return off;
    }, []);

    const brand = liveState?.brand ?? { name: brandName, logo: brandLogo, address: brandAddress, phone: brandPhone };
    const header = liveState?.header ?? { docType, issuedAt, customerName, customerAddress1Line };
    const liveLines: any[] = liveState?.lines ?? [];
    const liveTotals = liveState?.totals ?? { subtotal: 0, tax: 0, grand: 0 };

    const onPrint = () => window.print();

    return (
      <div className="p-4 print:p-0">
        <style>{`
          @media print {
            @page { margin: 8mm; }
            .no-print { display: none !important; }
            .card { box-shadow: none !important; border: 0 !important; }
            body { background: #fff !important; }
          }
        `}</style>

        <div className="no-print mb-3">
          <Button type="button" onClick={onPrint}>Print</Button>
        </div>

        <div className="card">
          {/* Header */}
          <div className="flex items-center gap-4 mb-4">
            <img src={brand.logo} alt="logo" className="h-14 w-14 rounded bg-white object-contain" />
            <div>
              <div className="text-2xl font-bold text-orange-600">{brand.name}</div>
              <div className="text-sm text-gray-700">{brand.address}</div>
              <div className="text-sm text-gray-700">Phone: {brand.phone}</div>
            </div>
            <div className="ml-auto text-right">
              <div className="text-lg font-semibold">{header.docType === 'return' ? 'Return' : 'Invoice'}</div>
              <div className="text-sm">Date: {header.issuedAt || '—'}</div>
            </div>
          </div>

          {/* Customer */}
          <div className="mb-4">
            <div className="font-semibold">Customer</div>
            <div>{header.customerName || '—'}</div>
            <div className="text-sm text-gray-700">{header.customerAddress1Line || '—'}</div>
          </div>

          {/* Lines (NO margin/cost columns) */}
          <div className="overflow-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th style={{ minWidth: 220 }}>Description</th>
                  <th>UoM</th>
                  <th className="text-right">Qty</th>
                  <th className="text-right">Unit Price</th>
                  <th className="text-right">Tax %</th>
                  <th className="text-right">Line Total</th>
                </tr>
              </thead>
              <tbody>
                {liveLines.map((ln, idx) => (
                  <tr key={idx}>
                    <td>{ln.sku}</td>
                    <td>{ln.description}</td>
                    <td>{ln.uom_code || '-'}</td>
                    <td className="text-right">{ln.qty}</td>
                    <td className="text-right">₹ {Number(ln.unit_price || 0).toFixed(2)}</td>
                    <td className="text-right">{Number(ln.tax_rate || 0).toFixed(2)}</td>
                    <td className="text-right">₹ {Number(ln.line_total || 0).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={5}></td>
                  <td className="text-right font-medium">Subtotal</td>
                  <td className="text-right">₹ {Number(liveTotals.subtotal || 0).toFixed(2)}</td>
                </tr>
                <tr>
                  <td colSpan={5}></td>
                  <td className="text-right font-medium">Tax</td>
                  <td className="text-right">₹ {Number(liveTotals.tax || 0).toFixed(2)}</td>
                </tr>
                <tr className="font-semibold">
                  <td colSpan={5}></td>
                  <td className="text-right">Total</td>
                  <td className="text-right">₹ {Number(liveTotals.grand || 0).toFixed(2)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>
    );
  }

  // =======================
  // User Screen (editor)
  // =======================
  return (
    <Protected>
      {/* Header with brand + action buttons */}
      <div className="card mb-4">
        <div className="flex items-center gap-4">
          <img src={brandLogo} alt="logo" className="h-14 w-14 rounded bg-white object-contain" />
          <div>
            <div className="text-2xl font-bold text-orange-600">{brandName}</div>
            <div className="text-sm text-gray-700">{brandAddress}</div>
            <div className="text-sm text-gray-700">Phone: {brandPhone}</div>
          </div>

          <div className="ml-auto flex gap-2">
            <Button type="button" onClick={() => {
              const url = new URL(window.location.href);
              url.searchParams.set('display', 'customer');
              window.open(url.toString(), '_blank', 'noopener,noreferrer');
            }}>
              Open Customer Screen
            </Button>
            <Button type="button" onClick={handleNewInvoice} className="bg-gray-700 hover:bg-gray-800">
              New Invoice
            </Button>
          </div>
        </div>
      </div>

      <div className="card">
        <h1 className="text-xl font-semibold mb-4">New Invoice</h1>

        {/* Top: type/date/notes */}
        <div className="grid md:grid-cols-3 gap-3 mb-4">
          <div>
            <label className="label">Type</label>
            <select className="input" value={docType} onChange={(e) => setDocType(e.target.value as DocType)}>
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

        {/* Return: original invoice number */}
        {docType === 'return' && (
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
              <div>
                <Button type="button" onClick={loadItemsFromInvoiceNo}>Load Items</Button>
              </div>
              <div className="text-sm text-gray-600">
                Loads items from original invoice. Adjust quantities for return.
              </div>
            </div>
          </div>
        )}

        {/* Customer by mobile number */}
        <div className="card mb-4">
          <div className="grid md:grid-cols-3 gap-3 items-end">
            <div>
              <label className="label">Customer Mobile</label>
              <input
                className="input"
                placeholder="Enter mobile number"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
              />
            </div>
            <div>
              <Button type="button" onClick={lookupCustomerByPhone}>Lookup Customer</Button>
            </div>

            <div className="text-sm">
              <div className="font-semibold">Customer</div>
              <div>{customerName || '—'}</div>
              <div className="text-gray-600">{customerAddress1Line || '—'}</div>
            </div>
          </div>

          {showCreateCustomer && (
            <div className="mt-4 border-t pt-4">
              <div className="grid md:grid-cols-3 gap-3">
                <div>
                  <label className="label">First name</label>
                  <input
                    className="input"
                    value={newCust.first_name}
                    onChange={(e) => setNewCust({ ...newCust, first_name: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Last name</label>
                  <input
                    className="input"
                    value={newCust.last_name}
                    onChange={(e) => setNewCust({ ...newCust, last_name: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Phone</label>
                  <input
                    className="input"
                    value={newCust.phone}
                    onChange={(e) => setNewCust({ ...newCust, phone: e.target.value })}
                  />
                </div>

                <div className="md:col-span-3">
                  <label className="label">Street</label>
                  <input
                    className="input"
                    value={newCust.street_name}
                    onChange={(e) => setNewCust({ ...newCust, street_name: e.target.value })}
                  />
                </div>

                <div>
                  <label className="label">Village/Town</label>
                  <input
                    className="input"
                    value={newCust.village_town}
                    onChange={(e) => setNewCust({ ...newCust, village_town: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">City</label>
                  <input
                    className="input"
                    value={newCust.city}
                    onChange={(e) => setNewCust({ ...newCust, city: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">State</label>
                  <input
                    className="input"
                    value={newCust.state}
                    onChange={(e) => setNewCust({ ...newCust, state: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">PIN</label>
                  <input
                    className="input"
                    value={newCust.postal_code}
                    onChange={(e) => setNewCust({ ...newCust, postal_code: e.target.value })}
                  />
                </div>
              </div>

              <div className="mt-3">
                <Button type="button" onClick={createCustomer}>Create Customer</Button>
              </div>
            </div>
          )}
        </div>

        {/* Line items — EXACT order you requested */}
        <div className="overflow-auto">
          <table className="table">
            <thead>
              <tr>
                <th style={{ minWidth: 160 }}>Item (SKU)</th>
                <th style={{ minWidth: 220 }}>Description</th>
                <th style={{ minWidth: 80 }}>UoM</th>
                <th style={{ minWidth: 110 }}>Current Cost</th>
                <th style={{ minWidth: 80 }}>Qty</th>
                <th style={{ minWidth: 110 }}>Margin %</th>
                <th style={{ minWidth: 80 }}>Tax %</th>
                <th style={{ minWidth: 120 }}>Unit Price</th>
                <th style={{ minWidth: 120 }}>Line Total</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const lineTotal = round2((r.qty || 0) * (r.unit_price || 0));
                return (
                  <tr key={r.id}>
                    {/* Item (SKU) — type/scan then Enter */}
                    <td>
                      <input
                        className="input"
                        placeholder="Type/Scan SKU, then Enter"
                        value={r.sku_input}
                        onChange={(e) => setSkuInput(r.id, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            setItemBySku(r.id, r.sku_input);
                          }
                        }}
                      />
                    </td>

                    {/* Description */}
                    <td>
                      <input
                        className="input"
                        placeholder="Description"
                        value={r.description}
                        onChange={(e) => setDescription(r.id, e.target.value)}
                      />
                    </td>

                    {/* UoM (readonly) */}
                    <td>
                      <input className="input" value={r.uom_code || ''} readOnly placeholder="-" />
                    </td>

                    {/* Current Cost (readonly) */}
                    <td>
                      <input className="input" value={r.base_cost.toFixed(2)} readOnly />
                    </td>

                    {/* Qty */}
                    <td>
                      <input
                        className="input"
                        type="number"
                        min={0}
                        step="1"
                        value={r.qty}
                        onChange={(e) => setQty(r.id, parseFloat(e.target.value || '0'))}
                      />
                    </td>

                    {/* Margin % */}
                    <td>
                      <input
                        className="input"
                        type="number"
                        step="0.01"
                        value={r.margin_pct}
                        onChange={(e) => setMargin(r.id, parseFloat(e.target.value || '0'))}
                      />
                    </td>

                    {/* Tax % */}
                    <td>
                      <input
                        className="input"
                        type="number"
                        step="0.01"
                        value={r.tax_rate}
                        onChange={(e) => setTaxRate(r.id, parseFloat(e.target.value || '0'))}
                      />
                    </td>

                    {/* Unit Price (editable) */}
                    <td>
                      <input
                        className="input"
                        type="number"
                        step="0.01"
                        value={r.unit_price}
                        onChange={(e) => setUnitPrice(r.id, parseFloat(e.target.value || '0'))}
                      />
                    </td>

                    {/* Line Total */}
                    <td>₹ {lineTotal.toFixed(2)}</td>

                    {/* Remove */}
                    <td>
                      <button
                        type="button"
                        className="text-red-600 hover:underline"
                        onClick={() => removeRow(r.id)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={10}>
                  <Button type="button" onClick={addRow}>+ Add Line</Button>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Totals + Save */}
        <div className="mt-6 grid md:grid-cols-3 gap-4">
          <div className="md:col-span-2"></div>
          <div className="card">
            <div className="flex justify-between">
              <div>Subtotal</div>
              <div>₹ {totals.subtotal.toFixed(2)}</div>
            </div>
            <div className="flex justify-between">
              <div>Tax</div>
              <div>₹ {totals.tax.toFixed(2)}</div>
            </div>
            <div className="flex justify-between font-semibold text-lg">
              <div>Total</div>
              <div>₹ {totals.grand.toFixed(2)}</div>
            </div>

            <div className="mt-4 flex gap-2">
              <Button type="button" onClick={save} disabled={saving}>
                {saving ? 'Saving…' : 'Save Invoice'}
              </Button>
              {invoiceNoJustSaved && (
                <div className="text-sm text-gray-600 self-center">Saved #{invoiceNoJustSaved}</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </Protected>
  );
}
