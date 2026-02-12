
'use client';

import { useEffect, useMemo, useState } from 'react';
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
  postal_code?: string | null; // PIN
}

interface Item {
  id: string;
  sku?: string | null;
  name: string;
  unit_price: number;
  tax_rate: number;
}

interface Row {
  id: string;
  // Product identity
  item_id: string;
  sku: string;
  description: string;
  // Pricing
  base_price: number;   // base (item price or original invoice price)
  unit_price: number;   // sale: base + margin%; return: original price
  tax_rate: number;
  // Qty controls
  qty: number;
  max_qty?: number;     // only in Return mode (cap to original qty)
  // Margin
  margin_pct: number;   // sale only; hidden on print
}

export default function NewInvoice() {
  // ---- Brand (ENV first, fallback to your details) ----
  const brandName   = process.env.NEXT_PUBLIC_BRAND_NAME   || 'Vinayak Hardware';
  const brandLogo   = process.env.NEXT_PUBLIC_BRAND_LOGO_URL || '/logo.png';
  const brandAddress= process.env.NEXT_PUBLIC_BRAND_ADDRESS|| 'Bilimora, Gandevi, Navsari, Gujarat, 396321';
  const brandPhone  = process.env.NEXT_PUBLIC_BRAND_PHONE  || '+91 7046826808';

  // ---- Header controls ----
  const [issuedAt, setIssuedAt] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [docType, setDocType]   = useState<DocType>('sale');

  // Return flow: link to an original invoice
  const [originalInvoiceNo, setOriginalInvoiceNo] = useState('');
  const [originalInvoiceId, setOriginalInvoiceId] = useState<string | null>(null);

  // ---- Customer (lookup/create by phone) ----
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerId, setCustomerId]       = useState<string>('');
  const [customerName, setCustomerName]   = useState(''); // First Last
  const [customerAddr1, setCustomerAddr1] = useState(''); // one-line address
  const [showCreateCustomer, setShowCreateCustomer] = useState(false);
  const [newCust, setNewCust] = useState({
    first_name: '', last_name: '', phone: '',
    street_name: '', village_town: '', city: '',
    state: '', postal_code: '',
  });

  // ---- Items & rows ----
  const [items, setItems] = useState<Item[]>([]);
  const [rows, setRows]   = useState<Row[]>([]);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [invoiceIdJustSaved, setInvoiceIdJustSaved] = useState<string | null>(null);
  const [invoiceNoJustSaved, setInvoiceNoJustSaved] = useState<string | null>(null);

  // Init: load items and one empty row
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from('items')
        .select('id, sku, name, unit_price, tax_rate')
        .eq('is_active', true)
        .order('name');
      if (!error && data) setItems(data as Item[]);

      setRows([blankRow()]);
    })();
  }, []);

  // Helpers
  const nameOf = (c: Partial<Customer>) =>
    [c.first_name, c.last_name].filter(Boolean).join(' ').trim();

  const oneLineAddress = (c: Partial<Customer>) =>
    [c.street_name, c.village_town, c.city, c.postal_code, c.state]
      .filter(Boolean)
      .map(String)
      .map((s) => s.trim())
      .join(', ');

  const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

  const blankRow = (): Row => ({
    id: crypto.randomUUID(),
    item_id: '',
    sku: '',
    description: '',
    base_price: 0,
    unit_price: 0,
    tax_rate: 0,
    qty: 1,
    margin_pct: 0,
  });

  // ---- Customer lookup ----
  async function lookupCustomerByPhone() {
    const phone = customerPhone.trim();
    if (!phone) return alert('Please enter a mobile number');

    const { data, error } = await supabase
      .from('customers')
      .select('id, first_name, last_name, phone, street_name, village_town, city, state, postal_code')
      .ilike('phone', phone);
    if (error) return alert(error.message);

    if (!data || data.length === 0) {
      setNewCust((p) => ({ ...p, phone }));
      setShowCreateCustomer(true);
      setCustomerId('');
      setCustomerName('');
      setCustomerAddr1('');
    } else {
      const c = data[0] as Customer;
      setCustomerId(c.id);
      setCustomerName(nameOf(c));
      setCustomerAddr1(oneLineAddress(c));
      setShowCreateCustomer(false);
    }
  }

  async function createCustomer() {
    if (!newCust.first_name || !newCust.last_name)
      return alert('Please enter first & last name');
    const { data, error } = await supabase
      .from('customers')
      .insert([newCust])
      .select('id, first_name, last_name, phone, street_name, village_town, city, state, postal_code')
      .single();
    if (error) return alert(error.message);

    const c = data as Customer;
    setCustomerId(c.id);
    setCustomerPhone(c.phone || newCust.phone);
    setCustomerName(nameOf(c));
    setCustomerAddr1(oneLineAddress(c));
    setShowCreateCustomer(false);
  }

  // ---- Row operations ----
  async function applySkuToRow(rowId: string, skuValue: string) {
    const s = (skuValue || '').trim();
    if (!s) return;

    let it = items.find((x) => (x.sku || '').toLowerCase() === s.toLowerCase());
    if (!it) {
      const { data, error } = await supabase
        .from('items')
        .select('id, sku, name, unit_price, tax_rate')
        .eq('sku', s)
        .limit(1);
      if (error || !data || data.length === 0) {
        alert('No item with this SKU');
        return;
      }
      it = data[0] as Item;
    }

    setRows((rows) =>
      rows.map((r) =>
        r.id === rowId
          ? {
              ...r,
              item_id: it!.id,
              sku: it!.sku || s,
              description: it!.name,
              base_price: it!.unit_price,
              unit_price: it!.unit_price, // margin applies later
              tax_rate: it!.tax_rate,
            }
          : r
      )
    );
  }

  function setMargin(rowId: string, m: number) {
    setRows((rows) =>
      rows.map((r) =>
        r.id === rowId
          ? { ...r, margin_pct: m, unit_price: round2(r.base_price * (1 + (m || 0) / 100)) }
          : r
      )
    );
  }

  function setQty(rowId: string, q: number) {
    setRows((rows) =>
      rows.map((r) => {
        if (r.id !== rowId) return r;
        let next = Math.max(0, q);
        if (docType === 'return' && r.max_qty != null) next = Math.min(next, r.max_qty);
        return { ...r, qty: next };
      })
    );
  }

  // ---- Return mode: load original invoice → rows from original lines ----
  async function loadOriginalInvoice() {
    const no = originalInvoiceNo.trim();
    if (!no) return alert('Enter original invoice number');

    const { data: inv, error: eInv } = await supabase
      .from('invoices')
      .select('id, customer_id')
      .eq('invoice_no', no)
      .single();
    if (eInv || !inv) return alert('Original invoice not found');
    setOriginalInvoiceId(inv.id);

    // hydrate customer
    const { data: cust } = await supabase
      .from('customers')
      .select('id, first_name, last_name, phone, street_name, village_town, city, state, postal_code')
      .eq('id', inv.customer_id)
      .single();
    if (cust) {
      const c = cust as Customer;
      setCustomerId(c.id);
      setCustomerPhone(c.phone || '');
      setCustomerName(nameOf(c));
      setCustomerAddr1(oneLineAddress(c));
    }

    // Lines with item (for sku)
    const { data: lines, error: eLines } = await supabase
      .from('invoice_items')
      .select('item_id, description, qty, unit_price, tax_rate, items(sku, name)')
      .eq('invoice_id', inv.id);
    if (eLines || !lines) return alert('Could not read original items');

    const newRows: Row[] = (lines as any[]).map((ln) => ({
      id: crypto.randomUUID(),
      item_id: ln.item_id,
      sku: ln.items?.sku || '',
      description: ln.description || ln.items?.name || '',
      base_price: ln.unit_price,
      unit_price: ln.unit_price,
      tax_rate: ln.tax_rate || 0,
      qty: 0, // choose how many to return
      max_qty: Number(ln.qty || 0),
      margin_pct: 0,
    }));

    setRows(newRows.length ? newRows : [blankRow()]);
  }

  // ---- Totals ----
  const totals = useMemo(() => {
    let subtotal = 0, tax = 0;
    for (const r of rows) {
      const line = r.qty * r.unit_price;
      subtotal += line;
      tax += line * (r.tax_rate / 100);
    }
    return { subtotal, tax, grand: subtotal + tax };
  }, [rows]);

  // ---- Save invoice & stock moves ----
  async function saveInvoice() {
    if (!customerId) return alert('Lookup or create the customer first');

    if (docType === 'sale') {
      if (!rows.length || !rows[0].item_id) return alert('Add at least one line item');
    } else {
      if (!originalInvoiceId) return alert('Load the original invoice first');
      const anyQty = rows.some((r) => r.qty > 0);
      if (!anyQty) return alert('Enter qty for items being returned');
    }

    setSaving(true);
    try {
      // Try sequential invoice number, else fallback
      let invoiceNo = '';
      const { data: nextNo, error: eNo } = await supabase.rpc('next_invoice_no');
      invoiceNo = !eNo && nextNo ? String(nextNo) : 'INV-' + Date.now();

      // Insert invoice (link to original in return mode if you added return_of_invoice_id)
      const { data: inv, error: e1 } = await supabase
        .from('invoices')
        .insert([
          {
            invoice_no: invoiceNo,
            customer_id: customerId,
            notes,
            subtotal: totals.subtotal,
            tax_total: totals.tax,
            grand_total: totals.grand,
            status: 'sent',
            doc_type: docType,
            issued_at: issuedAt,
            // return_of_invoice_id: docType === 'return' ? originalInvoiceId : null, // uncomment if column exists
          },
        ])
        .select()
        .single();
      if (e1) throw e1;

      // Line items
      const lineRows = rows
        .filter((r) => (docType === 'sale' ? r.item_id : r.qty > 0))
        .map((r) => ({
          invoice_id: inv.id,
          item_id: r.item_id,
          description: r.description,
          qty: r.qty,
          unit_price: r.unit_price,
          tax_rate: r.tax_rate,
          line_total: round2(r.qty * r.unit_price),
        }));
      if (!lineRows.length) throw new Error('No lines to save');

      const { error: e2 } = await supabase.from('invoice_items').insert(lineRows);
      if (e2) throw e2;

      // Stock moves
      const moveType = docType === 'sale' ? 'issue' : 'return';
      const moves = lineRows.map((r) => ({
        item_id: r.item_id,
        move_type: moveType,
        qty: r.qty,
        ref: inv.invoice_no,
        reason: docType === 'sale' ? 'Invoice issue' : 'Invoice return',
      }));
      const { error: e3 } = await supabase.from('stock_moves').insert(moves);
      if (e3) throw e3;

      setInvoiceIdJustSaved(inv.id);
      setInvoiceNoJustSaved(inv.invoice_no);
      alert('Saved invoice #' + invoiceNo);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  }

  // ---- Top buttons ----
  function handleNewInvoice() {
    // reset the entire page state cleanly
    setIssuedAt(new Date().toISOString().slice(0,10));
    setDocType('sale');
    setOriginalInvoiceNo('');
    setOriginalInvoiceId(null);
    setCustomerPhone('');
    setCustomerId('');
    setCustomerName('');
    setCustomerAddr1('');
    setShowCreateCustomer(false);
    setNewCust({
      first_name:'', last_name:'', phone:'', street_name:'', village_town:'',
      city:'', state:'', postal_code:''
    });
    setRows([blankRow()]);
    setNotes('');
    setSaving(false);
    setInvoiceIdJustSaved(null);
    setInvoiceNoJustSaved(null);
  }

  function openPrint() {
    if (invoiceIdJustSaved) {
      window.open(`/invoices/${invoiceIdJustSaved}`, '_blank');
    }
  }

  return (
    <Protected>
      {/* ---- Brand header ---- */}
      <div className="card mb-4">
        <div className="flex items-center gap-4">
          <img src={brandLogo} alt="logo" className="h-14 w-14 rounded bg-white object-contain" />
          <div>
            <div className="text-2xl font-bold text-orange-600">{brandName}</div>
            <div className="text-sm text-gray-700">{brandAddress}</div>
            <div className="text-sm text-gray-700">Phone: {brandPhone}</div>
          </div>

          {/* Right side action buttons */}
          <div className="ml-auto flex gap-2">
            {invoiceIdJustSaved && (
              <Button type="button" onClick={openPrint}>
                Print Invoice
              </Button>
            )}
            <Button type="button" onClick={handleNewInvoice} className="bg-gray-700 hover:bg-gray-800">
              New Invoice
            </Button>
          </div>
        </div>
      </div>

      {/* ---- Main Card ---- */}
      <div className="card">
        <h1 className="text-xl font-semibold mb-4">New Invoice</h1>

        {/* Top controls */}
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
            <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Private notes (not printed)" />
          </div>
        </div>

        {/* Customer lookup */}
        <div className="card mb-4">
          <div className="grid md:grid-cols-3 gap-3 items-end">
            <div>
              <label className="label">Customer Mobile</label>
              <div className="flex gap-2">
                <input
                  className="input"
                  placeholder="Enter mobile number"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); lookupCustomerByPhone(); } }}
                />
                <Button type="button" onClick={lookupCustomerByPhone}>Lookup</Button>
              </div>
            </div>
            <div>
              <label className="label">Customer Name</label>
              <input className="input" value={customerName} readOnly placeholder="(First Last)" />
            </div>
            <div>
              <label className="label">Customer Address (one line)</label>
              <input className="input" value={customerAddr1} readOnly placeholder="(auto after lookup / create)" />
            </div>
          </div>

          {/* Create-customer inline panel */}
          {showCreateCustomer && (
            <div className="mt-4 border rounded p-3 bg-orange-50">
              <div className="font-semibold mb-2">Create New Customer</div>
              <div className="grid md:grid-cols-2 gap-2 mb-2">
                <input className="input" placeholder="First name"
                  value={newCust.first_name} onChange={(e) => setNewCust({ ...newCust, first_name: e.target.value })} />
                <input className="input" placeholder="Last name"
                  value={newCust.last_name} onChange={(e) => setNewCust({ ...newCust, last_name: e.target.value })} />
              </div>
              <div className="grid md:grid-cols-2 gap-2 mb-2">
                <input className="input" placeholder="Mobile"
                  value={newCust.phone} onChange={(e) => setNewCust({ ...newCust, phone: e.target.value })} />
                <input className="input" placeholder="Street name"
                  value={newCust.street_name} onChange={(e) => setNewCust({ ...newCust, street_name: e.target.value })} />
              </div>
              <div className="grid md:grid-cols-3 gap-2 mb-2">
                <input className="input" placeholder="Village/Town"
                  value={newCust.village_town} onChange={(e) => setNewCust({ ...newCust, village_town: e.target.value })} />
                <input className="input" placeholder="City"
                  value={newCust.city} onChange={(e) => setNewCust({ ...newCust, city: e.target.value })} />
                <input className="input" placeholder="State"
                  value={newCust.state} onChange={(e) => setNewCust({ ...newCust, state: e.target.value })} />
              </div>
              <div className="grid md:grid-cols-3 gap-2 mb-2">
                <input className="input" placeholder="PIN"
                  value={newCust.postal_code} onChange={(e) => setNewCust({ ...newCust, postal_code: e.target.value })} />
                <div />
                <div />
              </div>
              <div className="flex gap-2">
                <Button type="button" onClick={createCustomer}>Save Customer</Button>
                <button type="button" className="text-gray-600" onClick={() => setShowCreateCustomer(false)}>Cancel</button>
              </div>
            </div>
          )}
        </div>

        {/* Return-only: original invoice no → load items */}
        {docType === 'return' && (
          <div className="card mb-4">
            <div className="grid md:grid-cols-3 gap-3 items-end">
              <div>
                <label className="label">Original Invoice No.</label>
                <input className="input" placeholder="e.g., INV-2026-000123"
                  value={originalInvoiceNo} onChange={(e) => setOriginalInvoiceNo(e.target.value)} />
              </div>
              <div>
                <Button type="button" onClick={loadOriginalInvoice}>Load Items</Button>
              </div>
              <div className="text-sm text-gray-600">
                (Loads items, original price & tax; choose quantities to return)
              </div>
            </div>
          </div>
        )}

        {/* Lines table */}
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: '14rem' }}>SKU</th>
              <th style={{ width: '28%' }}>Description</th>
              <th>Qty</th>
              <th className={docType === 'sale' ? 'print:hidden' : 'hidden'}>Margin %</th>
              <th>Price</th>
              <th>Tax %</th>
              <th>Line</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                {/* SKU input (scan / type → Enter) */}
                <td>
                  <input
                    className="input"
                    placeholder="Scan or type SKU"
                    value={r.sku}
                    onChange={(e) =>
                      setRows(rows.map((x) => (x.id === r.id ? { ...x, sku: e.target.value } : x)))
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        if (docType === 'sale') applySkuToRow(r.id, r.sku);
                      }
                    }}
                    disabled={docType === 'return'}
                  />
                </td>

                {/* Description */}
                <td>
                  <input
                    className="input"
                    value={r.description}
                    onChange={(e) => setRows(rows.map((x) => (x.id === r.id ? { ...x, description: e.target.value } : x)))}
                    readOnly={docType === 'return'}
                  />
                </td>

                {/* Qty */}
                <td>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    value={r.qty}
                    onChange={(e) => setQty(r.id, parseFloat(e.target.value) || 0)}
                  />
                  {docType === 'return' && r.max_qty != null && (
                    <div className="text-xs text-gray-500 mt-1">Max: {r.max_qty}</div>
                  )}
                </td>

                {/* Margin (sale only; hidden on print) */}
                <td className={docType === 'sale' ? 'print:hidden' : 'hidden'}>
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    value={r.margin_pct}
                    onChange={(e) => setMargin(r.id, parseFloat(e.target.value) || 0)}
                  />
                </td>

                {/* Price */}
                <td>
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    value={r.unit_price}
                    onChange={(e) =>
                      setRows(rows.map((x) => (x.id === r.id ? { ...x, unit_price: parseFloat(e.target.value) || 0 } : x)))
                    }
                    readOnly={docType === 'return'}
                  />
                </td>

                {/* Tax */}
                <td>
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    value={r.tax_rate}
                    onChange={(e) =>
                      setRows(rows.map((x) => (x.id === r.id ? { ...x, tax_rate: parseFloat(e.target.value) || 0 } : x)))
                    }
                    readOnly={docType === 'return'}
                  />
                </td>

                {/* Line total */}
                <td>₹{(r.qty * r.unit_price).toFixed(2)}</td>

                {/* Remove row */}
                <td>
                  <button className="text-red-600" onClick={() => setRows(rows.filter((x) => x.id !== r.id))}>
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Add row (sale only) */}
        {docType === 'sale' && (
          <div className="mt-3">
            <button className="text-primary" onClick={() => setRows([...rows, blankRow()])}>
              + Add Line
            </button>
          </div>
        )}

        {/* Totals + Save */}
        <div className="mt-6 grid md:grid-cols-2">
          <div />
          <div className="card">
            <div className="flex justify-between">
              <span>Subtotal</span>
              <span>₹{totals.subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span>Tax</span>
              <span>₹{totals.tax.toFixed(2)}</span>
            </div>
            <div className="flex justify-between font-semibold text-lg">
              <span>Grand Total</span>
              <span>₹{totals.grand.toFixed(2)}</span>
            </div>

            <div className="mt-3 flex gap-2">
              <Button disabled={saving} onClick={saveInvoice}>
                {saving ? 'Saving...' : 'Save Invoice'}
              </Button>
              {invoiceIdJustSaved && (
                <>
                  <Button type="button" onClick={openPrint}>Print Invoice</Button>
                  <Button type="button" onClick={handleNewInvoice} className="bg-gray-700 hover:bg-gray-800">
                    New Invoice
                  </Button>
                </>
              )}
            </div>

            {/* Also show a text link */}
            {invoiceIdJustSaved && (
              <div className="mt-3 text-sm">
                Saved #{invoiceNoJustSaved}.{' '}
                <a className="text-primary underline" href={`/invoices/${invoiceIdJustSaved}`} target="_blank" rel="noreferrer">
                  Open / Print invoice
                </a>
              </div>
            )}
          </div>
        </div>
      </div>
    </Protected>
  );
}
