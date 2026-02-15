
'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import Button from '@/components/Button';
import Protected from '@/components/Protected';

type DocType = 'sale' | 'return';
type ViewMode = 'user' | 'customer';

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
  unit_cost: number;                       // avg cost from stock
  tax_rate: number;
  uom: { code?: string }[] | { code?: string } | null;
}

interface Row {
  id: string;
  sku_input: string;                       // typed/scanned SKU
  item_id: string;
  description: string;
  uom_code: string;                        // readonly from item
  base_cost: number;                       // readonly from items.unit_cost (avg cost)
  qty: number;
  margin_pct: number;                      // % → used to compute unit_price from cost
  tax_rate: number;
  unit_price: number;                      // editable (defaults from cost + margin%)
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
    // eslint-disable-next-line no-mixed-operators
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

/** A small, safe live channel to mirror rows to the Customer Screen */
class LiveChannel {
  ch: BroadcastChannel | null = null;
  constructor(name = 'invoice-live') {
    try {
      this.ch = new BroadcastChannel(name);
    } catch {
      this.ch = null;
    }
  }
  post(data: any) {
    try { this.ch?.postMessage(data); } catch {}
  }
  on(fn: (data: any) => void) {
    if (!this.ch) return () => {};
    const handler = (ev: MessageEvent) => fn(ev.data);
    this.ch.addEventListener('message', handler);
    return () => this.ch?.removeEventListener('message', handler);
  }
}
const live = new LiveChannel('invoice-live');

export default function NewInvoicePage() {
  const search = useSearchParams();
  const viewParam = (search.get('display') || 'user') as ViewMode;
  const isCustomerView = viewParam === 'customer';

  // --- Branding ---
  const brandName    = process.env.NEXT_PUBLIC_BRAND_NAME     || 'Vinayak Hardware';
  const brandLogo    = process.env.NEXT_PUBLIC_BRAND_LOGO_URL || '/logo.png';
  const brandAddress = process.env.NEXT_PUBLIC_BRAND_ADDRESS  || 'Bilimora, Gandevi, Navsari, Gujarat, 396321';
  const brandPhone   = process.env.NEXT_PUBLIC_BRAND_PHONE    || '+91 7046826808';

  // --- Header ---
  const [issuedAt, setIssuedAt] = useState<string>(() => {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  });
  const [docType, setDocType] = useState<DocType>('sale');
  const [originalInvoiceNo, setOriginalInvoiceNo] = useState<string>('');

  // --- Customer ---
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

  // --- Rows & state ---
  const [rows, setRows] = useState<Row[]>([]);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [invoiceIdJustSaved, setInvoiceIdJustSaved] = useState<string | null>(null);
  const [invoiceNoJustSaved, setInvoiceNoJustSaved] = useState<string | null>(null);

  // Double-save latch
  const savingRef = useRef(false);

  useEffect(() => {
    setRows([makeEmptyRow()]);
  }, []);

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

  // -------- Customer lookup --------
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
    if (!newCust.first_name || !newCust.last_name) {
      return alert('Please enter first and last name');
    }
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
    setRows(prev =>
      prev.map(r => {
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
      })
    );
  };

  // -------- Row setters --------
  const setSkuInput = (rowId: string, text: string) =>
    setRows(prev => prev.map(r => (r.id === rowId ? { ...r, sku_input: text } : r)));

  const setDescription = (rowId: string, desc: string) =>
    setRows(prev => prev.map(r => (r.id === rowId ? { ...r, description: desc } : r)));

  const setMargin = (rowId: string, m: number) =>
    setRows(prev =>
      prev.map(r => {
        if (r.id !== rowId) return r;
        const unit = round2((r.base_cost || 0) * (1 + (m || 0) / 100));
        return { ...r, margin_pct: m || 0, unit_price: unit };
      })
    );

  const setTaxRate = (rowId: string, rate: number) =>
    setRows(prev => prev.map(r => (r.id === rowId ? { ...r, tax_rate: rate || 0 } : r)));

  const setQty = (rowId: string, qty: number) =>
    setRows(prev => prev.map(r => (r.id === rowId ? { ...r, qty: qty || 0 } : r)));

  const setUnitPrice = (rowId: string, price: number) =>
    setRows(prev => prev.map(r => (r.id === rowId ? { ...r, unit_price: price || 0 } : r)));

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
        qty: 1, // default to 1 to return; user can adjust
        margin_pct: 0,
        tax_rate: Number(ln.tax_rate || ln.items?.tax_rate || 0),
        unit_price: Number(ln.unit_price || 0),
      };
    });
    setRows(prefilled.length > 0 ? prefilled : [makeEmptyRow()]);
  };

  // -------- Totals --------
  const totals = useMemo(() => {
    let subtotal = 0;
    let tax = 0;
    for (const r of rows) {
      const line = (r.qty || 0) * (r.unit_price || 0);
      subtotal += line;
      tax += line * ((r.tax_rate || 0) / 100);
    }
    return { subtotal: round2(subtotal), tax: round2(tax), grand: round2(subtotal + tax) };
  }, [rows]);

  // -------- Live mirror → Customer Screen --------
  useEffect(() => {
    if (isCustomerView) return; // customer only listens
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
  const save = async () => {
    if (savingRef.current || saving) return;
    if (!customerId) return alert('Please lookup or create the customer (by phone) first');
    const hasLine = rows.some(r => r.item_id && r.qty > 0);
    if (!hasLine) return alert('Add at least one line item');

    savingRef.current = true;
    setSaving(true);
    try {
      // Next invoice number (fallback to timestamp)
      let invoiceNo = '';
      const { data: nextNo, error: eNo } = await supabase.rpc('next_invoice_no');
      invoiceNo = !eNo && nextNo ? String(nextNo) : 'INV-' + Date.now();

      // Insert invoice
      const { data: inv, error: e1 } = await supabase
        .from('invoices') // PLURAL table name
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

      // Insert invoice lines
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

      // Stock moves via idempotent RPCs
      const moveRpc = docType === 'sale' ? 'issue_stock' : 'return_stock';
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (!r.item_id || !r.qty) continue;
        const client_tx_id = `${invoiceNo}-${i}-${r.item_id}`;
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
      alert(err?.message || String(err));
    } finally {
      setSaving(false);
      savingRef.current = false;
    }
  };

  // -------- Reset --------
  const handleNewInvoice = () => {
    setIssuedAt(new Date().toISOString().slice(0, 10));
    setDocType('sale');
    setOriginalInvoiceNo('');
    setCustomerPhone('');
    setCustomerId('');
    setCustomerName('');
    setCustomerAddress1Line('');
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
    // Listen live
    const [liveState, setLiveState] = useState<any>(null);
    useEffect(() => {
      const off = live.on((msg) => {
        if (msg?.type === 'invoice-update') setLiveState(msg.payload);
      });
      return off;
    }, []);

    const brand = liveState?.brand ?? { name: brandName, logo: brandLogo, address: brandAddress, phone: brandPhone };
    const header = liveState?.header ?? { docType, issuedAt, customerName, customerAddress1Line };
    const liveLines: any[] = liveState?.lines ?? [];
    const liveTotals = liveState?.totals ?? { subtotal: 0, tax: 0, grand: 0 };

    const onPrint = () => window.print();

    return (
      <div className="p-4 print:p-0">
        {/* Print CSS: lean margins, no shadows */}
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

          {/* Lines (Customer view: no margin/cost columns) */}
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
            <Button type="button" onClick={openCustomerScreen}>
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
                Loads items from original invoice. Adjust quantities you’re returning.
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
                  <input className="input" value={newCust.first_name}
                         onChange={(e) => setNewCust({ ...newCust, first_name: e.target.value })}/>
                </div>
                <div>
                  <label className="label">Last name</label>
                  <input className="input" value={newCust.last_name}
                         onChange={(e) => setNewCust({ ...newCust, last_name: e.target.value })}/>
                </div>
                <div>
                  <label className="label">Phone</label>
                  <input className="input" value={newCust.phone}
                         onChange={(e) => setNewCust({ ...newCust, phone: e.target.value })}/>
                </div>

                <div className="md:col-span-3">
                  <label className="label">Street</label>
                  <input className="input" value={newCust.street_name}
                         onChange={(e) => setNewCust({ ...newCust, street_name: e.target.value })}/>
                </div>

                <div>
                  <label className="label">Village/Town</label>
                  <input className="input" value={newCust.village_town}
                         onChange={(e) => setNewCust({ ...newCust, village_town: e.target.value })}/>
                </div>
                <div>
                  <label className="label">City</label>
                  <input className="input" value={newCust.city}
                         onChange={(e) => setNewCust({ ...newCust, city: e.target.value })}/>
                </div>
                <div>
                  <label className="label">State</label>
                  <input className="input" value={newCust.state}
                         onChange={(e) => setNewCust({ ...newCust, state: e.target.value })}/>
                </div>
                <div>
                  <label className="label">PIN</label>
                  <input className="input" value={newCust.postal_code}
