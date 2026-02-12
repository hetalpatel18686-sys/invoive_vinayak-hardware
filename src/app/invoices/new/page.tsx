
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
  name: string;
  unit_price: number;
  tax_rate: number;
}

interface Row {
  id: string;
  item_id: string;
  base_price: number;  // item base price from DB
  margin_pct: number;  // NEW margin
  qty: number;
  unit_price: number;  // computed price (base + margin%)
  tax_rate: number;
  description?: string;
}

export default function NewInvoice() {
  // --- Branding (env first; fallback to your provided details) ---
  const brandName = process.env.NEXT_PUBLIC_BRAND_NAME || 'Vinayak Hardware';
  const brandLogo = process.env.NEXT_PUBLIC_BRAND_LOGO_URL || '/logo.png';
  const brandAddress =
    process.env.NEXT_PUBLIC_BRAND_ADDRESS ||
    'Bilimora, Gandevi, Navsari, Gujarat, 396321';
  const brandPhone =
    process.env.NEXT_PUBLIC_BRAND_PHONE || '+91 7046826808';

  // --- Invoice header fields ---
  const [issuedAt, setIssuedAt] = useState<string>(() => {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  });
  const [docType, setDocType] = useState<DocType>('sale');

  // --- Customer by phone ---
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerId, setCustomerId] = useState<string>('');
  const [customerAddress1Line, setCustomerAddress1Line] = useState<string>('');
  const [showCreateCustomer, setShowCreateCustomer] = useState(false);

  // Create-customer mini-form (shown when phone not found)
  const [newCust, setNewCust] = useState({
    first_name: '',
    last_name: '',
    phone: '',
    street_name: '',
    village_town: '',
    city: '',
    state: '',
    postal_code: '', // PIN
  });

  // --- Items and rows ---
  const [items, setItems] = useState<Item[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [invoiceIdJustSaved, setInvoiceIdJustSaved] = useState<string | null>(null);
  const [invoiceNoJustSaved, setInvoiceNoJustSaved] = useState<string | null>(null);

  // Load items at start; initialize one empty row
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('items')
        .select('id,name,unit_price,tax_rate')
        .eq('is_active', true)
        .order('name');

      setItems((data as Item[]) ?? []);
      setRows([
        {
          id: crypto.randomUUID(),
          item_id: '',
          base_price: 0,
          margin_pct: 0,
          qty: 1,
          unit_price: 0,
          tax_rate: 0,
          description: '',
        },
      ]);
    })();
  }, []);

  // When user enters phone, try lookup customer
  const lookupCustomerByPhone = async () => {
    const phone = (customerPhone || '').trim();
    if (!phone) {
      alert('Please enter a mobile number');
      return;
    }
    const { data, error } = await supabase
      .from('customers')
      .select(
        'id, first_name, last_name, phone, street_name, village_town, city, state, postal_code'
      )
      .ilike('phone', phone); // ilike makes it a bit flexible

    if (error) {
      alert(error.message);
      return;
    }

    if (!data || data.length === 0) {
      // Not found → open create form, prefill phone
      setNewCust({
        first_name: '',
        last_name: '',
        phone: phone,
        street_name: '',
        village_town: '',
        city: '',
        state: '',
        postal_code: '',
      });
      setShowCreateCustomer(true);
      setCustomerId('');
      setCustomerAddress1Line('');
    } else {
      // Found; if multiple matches, pick the first
      const c = data[0] as Customer;
      setCustomerId(c.id);
      const line = oneLineAddress(c);
      setCustomerAddress1Line(line);
      setShowCreateCustomer(false);
    }
  };

  // Create new customer from the mini-form
  const createCustomer = async () => {
    // Basic validation
    if (!newCust.first_name || !newCust.last_name) {
      alert('Please enter first and last name for the customer');
      return;
    }
    // Insert
    const { data, error } = await supabase
      .from('customers')
      .insert([newCust])
      .select('id, first_name, last_name, phone, street_name, village_town, city, state, postal_code')
      .single();
    if (error) {
      alert(error.message);
      return;
    }
    const c = data as Customer;
    setCustomerId(c.id);
    setCustomerPhone(c.phone || newCust.phone);
    setCustomerAddress1Line(oneLineAddress(c));
    setShowCreateCustomer(false);
  };

  // Helper: stitch full address into one line
  function oneLineAddress(c: Partial<Customer>) {
    const parts = [
      c.street_name,
      c.village_town,
      c.city,
      c.postal_code, // PIN
      c.state,
    ]
      .filter(Boolean)
      .map((s) => String(s).trim());
    return parts.join(', ');
  }

  // Change item on a row
  const setItem = (rowId: string, itemId: string) => {
    const it = items.find((x) => x.id === itemId);
    setRows(
      rows.map((r) =>
        r.id === rowId
          ? {
              ...r,
              item_id: itemId,
              base_price: it?.unit_price || 0,
              margin_pct: r.margin_pct || 0,
              unit_price: it?.unit_price || 0,
              tax_rate: it?.tax_rate || 0,
              description: it?.name || '',
            }
          : r
      )
    );
  };

  // Recompute a row when margin% changes
  const setMargin = (rowId: string, m: number) => {
    setRows(
      rows.map((r) =>
        r.id === rowId
          ? {
              ...r,
              margin_pct: m,
              unit_price: round2(r.base_price * (1 + (m || 0) / 100)),
            }
          : r
      )
    );
  };

  // Totals
  const totals = useMemo(() => {
    let subtotal = 0,
      tax = 0;
    for (const r of rows) {
      const line = r.qty * r.unit_price;
      subtotal += line;
      tax += line * (r.tax_rate / 100);
    }
    return { subtotal, tax, grand: subtotal + tax };
  }, [rows]);

  // Save invoice
  const save = async () => {
    if (!customerId) return alert('Please lookup or create the customer (by phone) first');
    if (rows.length === 0 || !rows[0].item_id)
      return alert('Add at least one line item');

    setSaving(true);
    try {
      // Get sequential invoice number if RPC is present; otherwise fallback
      let invoiceNo = '';
      const { data: nextNo, error: eNo } = await supabase.rpc('next_invoice_no');
      invoiceNo = !eNo && nextNo ? String(nextNo) : 'INV-' + Date.now();

      // Insert invoice
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
            doc_type: docType, // sale | return
            issued_at: issuedAt,
          },
        ])
        .select()
        .single();
      if (e1) throw e1;

      // Insert line items (using computed price)
      const lineRows = rows.map((r) => ({
        invoice_id: inv.id,
        item_id: r.item_id,
        description: r.description,
        qty: r.qty,
        unit_price: r.unit_price,
        tax_rate: r.tax_rate,
        line_total: round2(r.qty * r.unit_price),
      }));
      const { error: e2 } = await supabase.from('invoice_items').insert(lineRows);
      if (e2) throw e2;

      // Stock move: issue (sale) or return (return)
      const moveType = docType === 'sale' ? 'issue' : 'return';
      const issues = rows.map((r) => ({
        item_id: r.item_id,
        move_type: moveType,
        qty: r.qty,
        ref: inv.invoice_no,
        reason: docType,
      }));
      const { error: e3 } = await supabase.from('stock_moves').insert(issues);
      if (e3) throw e3;

      setInvoiceIdJustSaved(inv.id);
      setInvoiceNoJustSaved(inv.invoice_no);

      alert('Saved invoice #' + invoiceNo);
      // Optionally jump to reports, but we’ll keep user here so they can click Print
      // window.location.href = '/reports';
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  function round2(n: number) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  return (
    <Protected>
      {/* ---- Shop Header (shows on screen; your print page will use similar) ---- */}
      <div className="card mb-4">
        <div className="flex items-center gap-4">
          <img
            src={brandLogo}
            alt="logo"
            className="h-14 w-14 rounded bg-white object-contain"
          />
          <div>
            <div className="text-2xl font-bold text-orange-600">{brandName}</div>
            <div className="text-sm text-gray-700">{brandAddress}</div>
            <div className="text-sm text-gray-700">Phone: {brandPhone}</div>
          </div>
        </div>
      </div>

      <div className="card">
        <h1 className="text-xl font-semibold mb-4">New Invoice</h1>

        {/* --- Top: type (sale/return), date, notes --- */}
        <div className="grid md:grid-cols-3 gap-3 mb-4">
          <div>
            <label className="label">Type</label>
            <select
              className="input"
              value={docType}
              onChange={(e) => setDocType(e.target.value as DocType)}
            >
              <option value="sale">Sale</option>
              <option value="return">Return</option>
            </select>
          </div>

          <div>
            <label className="label">Invoice Date</label>
            <input
              className="input"
              type="date"
              value={issuedAt}
              onChange={(e) => setIssuedAt(e.target.value)}
            />
          </div>

          <div>
            <label className="label">Notes</label>
            <input
              className="input"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Private notes (not printed)"
            />
          </div>
        </div>

        {/* --- Customer by phone --- */}
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
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      lookupCustomerByPhone();
                    }
                  }}
                />
                <Button type="button" onClick={lookupCustomerByPhone}>
                  Lookup
                </Button>
              </div>
            </div>

            <div className="md:col-span-2">
              <label className="label">Customer Address (One line)</label>
              <input
                className="input"
                value={customerAddress1Line}
                onChange={() => {}}
                readOnly
                placeholder="(Will appear after lookup or creating new customer)"
              />
            </div>
          </div>

          {/* Mini-create-customer dialog (simple inline card) */}
          {showCreateCustomer && (
            <div className="mt-4 border rounded p-3 bg-orange-50">
              <div className="font-semibold mb-2">Create New Customer</div>
              <div className="grid md:grid-cols-2 gap-2 mb-2">
                <input
                  className="input"
                  placeholder="First name"
                  value={newCust.first_name}
                  onChange={(e) =>
                    setNewCust({ ...newCust, first_name: e.target.value })
                  }
                />
                <input
                  className="input"
                  placeholder="Last name"
                  value={newCust.last_name}
                  onChange={(e) =>
                    setNewCust({ ...newCust, last_name: e.target.value })
                  }
                />
              </div>
              <div className="grid md:grid-cols-2 gap-2 mb-2">
                <input
                  className="input"
                  placeholder="Mobile"
                  value={newCust.phone}
                  onChange={(e) => setNewCust({ ...newCust, phone: e.target.value })}
                />
                <input
                  className="input"
                  placeholder="Street name"
                  value={newCust.street_name}
                  onChange={(e) =>
                    setNewCust({ ...newCust, street_name: e.target.value })
                  }
                />
              </div>
              <div className="grid md:grid-cols-3 gap-2 mb-2">
                <input
                  className="input"
                  placeholder="Village/Town"
                  value={newCust.village_town}
                  onChange={(e) =>
                    setNewCust({ ...newCust, village_town: e.target.value })
                  }
                />
                <input
                  className="input"
                  placeholder="City"
                  value={newCust.city}
                  onChange={(e) => setNewCust({ ...newCust, city: e.target.value })}
                />
                <input
                  className="input"
                  placeholder="State"
                  value={newCust.state}
                  onChange={(e) => setNewCust({ ...newCust, state: e.target.value })}
                />
              </div>
              <div className="grid md:grid-cols-3 gap-2 mb-2">
                <input
                  className="input"
                  placeholder="PIN"
                  value={newCust.postal_code}
                  onChange={(e) =>
                    setNewCust({ ...newCust, postal_code: e.target.value })
                  }
                />
                <div />
                <div />
              </div>

              <div className="flex gap-2">
                <Button type="button" onClick={createCustomer}>
                  Save Customer
                </Button>
                <button
                  type="button"
                  className="text-gray-600"
                  onClick={() => setShowCreateCustomer(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {/* --- Lines table (Margin column is print:hidden) --- */}
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: '35%' }}>Item</th>
              <th>Qty</th>
              <th className="print:hidden">Margin %</th>
              <th>Price</th>
              <th>Tax %</th>
              <th>Line</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <select
                    className="input"
                    value={r.item_id}
                    onChange={(e) => setItem(r.id, e.target.value)}
                  >
                    <option value="">Select item...</option>
                    {items.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    className="input"
                    type="number"
                    min={1}
                    value={r.qty}
                    onChange={(e) =>
                      setRows(
                        rows.map((x) =>
                          x.id === r.id
                            ? { ...x, qty: parseFloat(e.target.value) || 0 }
                            : x
                        )
                      )
                    }
                  />
                </td>
                <td className="print:hidden">
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    value={r.margin_pct}
                    onChange={(e) =>
                      setMargin(r.id, parseFloat(e.target.value) || 0)
                    }
                  />
                </td>
                <td>
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    value={r.unit_price}
                    onChange={(e) =>
                      setRows(
                        rows.map((x) =>
                          x.id === r.id
                            ? { ...x, unit_price: parseFloat(e.target.value) || 0 }
                            : x
                        )
                      )
                    }
                  />
                </td>
                <td>
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    value={r.tax_rate}
                    onChange={(e) =>
                      setRows(
                        rows.map((x) =>
                          x.id === r.id
                            ? { ...x, tax_rate: parseFloat(e.target.value) || 0 }
                            : x
                        )
                      )
                    }
                  />
                </td>
                <td>₹{(r.qty * r.unit_price).toFixed(2)}</td>
                <td>
                  <button
                    onClick={() => setRows(rows.filter((x) => x.id !== r.id))}
                    className="text-red-600"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-3">
          <button
            className="text-primary"
            onClick={() =>
              setRows([
                ...rows,
                {
                  id: crypto.randomUUID(),
                  item_id: '',
                  base_price: 0,
                  margin_pct: 0,
                  qty: 1,
                  unit_price: 0,
                  tax_rate: 0,
                  description: '',
                },
              ])
            }
          >
            + Add Line
          </button>
        </div>

        {/* Totals box + Save */}
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
            <Button className="mt-3" disabled={saving} onClick={save}>
              {saving ? 'Saving...' : 'Save Invoice'}
            </Button>

            {/* After save: show quick Print link */}
            {invoiceIdJustSaved && (
              <div className="mt-3 text-sm">
                Saved #{invoiceNoJustSaved}.{' '}
                <a
                  className="text-primary underline"
                  href={`/invoices/${invoiceIdJustSaved}`}
                  target="_blank"
                  rel="noreferrer"
                >
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
