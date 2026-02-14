
'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import Button from '@/components/Button';
import Protected from '@/components/Protected';

type DocType = 'sale' | 'return';

/* ------------ Types ------------- */
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

/**
 * We normalize the related UoM to a simple string code.
 * (Avoids the array/object shape issue from Supabase join.)
 */
interface Item {
  id: string;
  name: string;
  unit_price: number;
  tax_rate: number;
  uom_code: string; // <-- normalized from relation ('' if missing)
}

interface Row {
  id: string;
  item_id: string;
  description?: string;
  uom_code?: string;   // read-only in UI (auto from selected item)
  base_price: number;  // base price from DB
  margin_pct: number;  // % added to base (optional)
  qty: number;
  unit_price: number;  // (auto) base + margin% | can be edited
  tax_rate: number;
}

/* ------------ Page ------------- */
export default function NewInvoice() {
  // --- Branding (env first; fallback) ---
  const brandName    = process.env.NEXT_PUBLIC_BRAND_NAME     || 'Vinayak Hardware';
  const brandLogo    = process.env.NEXT_PUBLIC_BRAND_LOGO_URL || '/logo.png';
  const brandAddress = process.env.NEXT_PUBLIC_BRAND_ADDRESS  || 'Bilimora, Gandevi, Navsari, Gujarat, 396321';
  const brandPhone   = process.env.NEXT_PUBLIC_BRAND_PHONE    || '+91 7046826808';

  // --- Invoice header fields ---
  const [issuedAt, setIssuedAt] = useState<string>(() => {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  });
  const [docType, setDocType] = useState<DocType>('sale');

  // --- Customer by phone ---
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerId, setCustomerId] = useState<string>('');
  const [customerName, setCustomerName] = useState<string>(''); // First + Last
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

  // --- Items & rows ---
  const [items, setItems] = useState<Item[]>([]);
  const [rows, setRows]   = useState<Row[]>([]);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [invoiceIdJustSaved, setInvoiceIdJustSaved] = useState<string | null>(null);
  const [invoiceNoJustSaved, setInvoiceNoJustSaved] = useState<string | null>(null);

  // Load items and start with one line
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from('items')
        .select(`
          id, name, unit_price, tax_rate,
          uom:units_of_measure ( code, name )
        `)
        // If your items table does NOT have is_active, comment the next line:
        // .eq('is_active', true)
        .order('name');

      if (error) {
        console.error(error);
        alert(error.message);
      }

      // Normalize: ensure uom_code is a string (first entry if array)
      const normalized: Item[] = (data ?? []).map((d: any) => ({
        id: d.id,
        name: d.name,
        unit_price: Number(d.unit_price || 0),
        tax_rate: Number(d.tax_rate || 0),
        uom_code: Array.isArray(d.uom) ? (d.uom[0]?.code ?? '') : (d.uom?.code ?? ''),
      }));

      setItems(normalized);

      setRows([
        {
          id: crypto.randomUUID(),
          item_id: '',
          description: '',
          uom_code: '',
          base_price: 0,
          margin_pct: 0,
          qty: 1,
          unit_price: 0,
          tax_rate: 0,
        },
      ]);
    })();
  }, []);

  // Helpers
  function fullName(c: Partial<Customer>) {
    return [c.first_name, c.last_name].filter(Boolean).join(' ').trim();
  }
  function oneLineAddress(c: Partial<Customer>) {
    return [c.street_name, c.village_town, c.city, c.postal_code, c.state]
      .filter(Boolean)
      .map((s) => String(s).trim())
      .join(', ');
  }
  function round2(n: number) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  /* -------- Customer Lookup -------- */
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
      .ilike('phone', phone);

    if (error) {
      alert(error.message);
      return;
    }

    if (!data || data.length === 0) {
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
      alert('Please enter first and last name for the customer');
      return;
    }
    const { data, error } = await supabase
      .from('customers')
      .insert([newCust])
      .select(
        'id, first_name, last_name, phone, street_name, village_town, city, state, postal_code'
      )
      .single();
    if (error) {
      alert(error.message);
      return;
    }
    const c = data as Customer;
    setCustomerId(c.id);
    setCustomerPhone(c.phone || newCust.phone);
    setCustomerName(fullName(c));
    setCustomerAddress1Line(oneLineAddress(c));
    setShowCreateCustomer(false);
  };

  /* -------- Row setters -------- */

  // When user picks an item: auto-fill price, tax, description, UoM
  const setItem = (rowId: string, itemId: string) => {
    const it = items.find((x) => x.id === itemId);
    setRows((prev) =>
      prev.map((r) =>
        r.id === rowId
          ? {
              ...r,
              item_id: itemId,
              description: it?.name || '',
              base_price: it?.unit_price || 0,
              margin_pct: r.margin_pct || 0,
              unit_price: it?.unit_price || 0, // auto price
              tax_rate: it?.tax_rate || 0,
              uom_code: it?.uom_code ?? '',   // auto UoM
            }
          : r
      )
    );
  };

  // Optional: set Margin% => recalculates unit_price
  const setMargin = (rowId: string, m: number) => {
    setRows((prev) =>
      prev.map((r) =>
        r.id === rowId
          ? {
              ...r,
              margin_pct: m,
              unit_price: round2((r.base_price || 0) * (1 + (m || 0) / 100)),
            }
          : r
      )
    );
  };

  const setQty = (rowId: string, qty: number) => {
    setRows((prev) =>
      prev.map((r) => (r.id === rowId ? { ...r, qty: qty || 0 } : r))
    );
  };

  const setUnitPrice = (rowId: string, price: number) => {
    setRows((prev) =>
      prev.map((r) => (r.id === rowId ? { ...r, unit_price: price || 0 } : r))
    );
  };

  const setTaxRate = (rowId: string, rate: number) => {
    setRows((prev) =>
      prev.map((r) => (r.id === rowId ? { ...r, tax_rate: rate || 0 } : r))
    );
  };

  const setDescription = (rowId: string, desc: string) => {
    setRows((prev) =>
      prev.map((r) => (r.id === rowId ? { ...r, description: desc } : r))
    );
  };

  const addRow = () => {
    setRows((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        item_id: '',
        description: '',
        uom_code: '',
        base_price: 0,
        margin_pct: 0,
        qty: 1,
        unit_price: 0,
        tax_rate: 0,
      },
    ]);
  };

  const removeRow = (rowId: string) => {
    setRows((prev) => prev.filter((r) => r.id !== rowId));
  };

  /* -------- Totals -------- */
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

  /* -------- Save -------- */
  const save = async () => {
    if (!customerId) return alert('Please lookup or create the customer (by phone) first');
    if (rows.length === 0 || !rows[0].item_id) return alert('Add at least one line item');

    setSaving(true);
    try {
      // sequential invoice number (if RPC available), else fallback
      let invoiceNo = '';
      const { data: nextNo, error: eNo } = await supabase.rpc('next_invoice_no');
      invoiceNo = !eNo && nextNo ? String(nextNo) : 'INV-' + Date.now();

      // invoice
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
          },
        ])
        .select()
        .single();
      if (e1) throw e1;

      // lines (NOTE: not storing UoM yet — say "save UoM too" if you want column added)
      const lineRows = rows.map((r) => ({
        invoice_id: (inv as any).id,
        item_id: r.item_id,
        description: r.description,
        qty: r.qty,
        unit_price: r.unit_price,
        tax_rate: r.tax_rate,
        line_total: round2(r.qty * r.unit_price),
      }));
      const { error: e2 } = await supabase.from('invoice_items').insert(lineRows);
      if (e2) throw e2;

      // stock moves
      const moveType = docType === 'sale' ? 'issue' : 'return';
      const moves = rows.map((r) => ({
        item_id: r.item_id,
        move_type: moveType,
        qty: r.qty,
        ref: (inv as any).invoice_no,
        reason: docType,
      }));
      const { error: e3 } = await supabase.from('stock_moves').insert(moves);
      if (e3) throw e3;

      setInvoiceIdJustSaved((inv as any).id);
      setInvoiceNoJustSaved((inv as any).invoice_no);
      alert('Saved invoice #' + invoiceNo);
    } catch (err: any) {
      console.error(err);
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  /* -------- Reset & Print -------- */
  function handleNewInvoice() {
    setIssuedAt(new Date().toISOString().slice(0, 10));
    setDocType('sale');
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
    setRows([
      {
        id: crypto.randomUUID(),
        item_id: '',
        description: '',
        uom_code: '',
        base_price: 0,
        margin_pct: 0,
        qty: 1,
        unit_price: 0,
        tax_rate: 0,
      },
    ]);
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

  /* ------------- UI ------------- */
  return (
    <Protected>
      {/* Header with brand + action buttons */}
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

          <div className="ml-auto flex gap-2">
            {invoiceIdJustSaved && (
              <Button type="button" onClick={openPrint}>
                Print Invoice
              </Button>
            )}
            <Button
              type="button"
              onClick={handleNewInvoice}
              className="bg-gray-700 hover:bg-gray-800"
            >
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
              placeholder="Optional notes"
            />
          </div>
        </div>

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
              <Button type="button" onClick={lookupCustomerByPhone}>
                Lookup Customer
              </Button>
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
                    onChange={(e) =>
                      setNewCust({ ...newCust, first_name: e.target.value })
                    }
                  />
                </div>
                <div>
                  <label className="label">Last name</label>
                  <input
                    className="input"
                    value={newCust.last_name}
                    onChange={(e) =>
                      setNewCust({ ...newCust, last_name: e.target.value })
                    }
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
                    onChange={(e) =>
                      setNewCust({ ...newCust, street_name: e.target.value })
                    }
                  />
                </div>

                <div>
                  <label className="label">Village/Town</label>
                  <input
                    className="input"
                    value={newCust.village_town}
                    onChange={(e) =>
                      setNewCust({ ...newCust, village_town: e.target.value })
                    }
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
                    onChange={(e) =>
                      setNewCust({ ...newCust, postal_code: e.target.value })
                    }
                  />
                </div>
              </div>

              <div className="mt-3">
                <Button type="button" onClick={createCustomer}>
                  Create Customer
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Line items */}
        <div className="overflow-auto">
          <table className="table">
            <thead>
              <tr>
                <th style={{ minWidth: 220 }}>Item</th>
                <th>UoM</th>
                <th style={{ minWidth: 90 }}>Qty</th>
                <th style={{ minWidth: 120 }}>Margin %</th>
                <th style={{ minWidth: 120 }}>Unit Price</th>
                <th style={{ minWidth: 90 }}>Tax %</th>
                <th style={{ minWidth: 120 }}>Line Total</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const lineTotal = round2((r.qty || 0) * (r.unit_price || 0));
                return (
                  <tr key={r.id}>
                    {/* Item select */}
                    <td>
                      <select
                        className="input"
                        value={r.item_id}
                        onChange={(e) => setItem(r.id, e.target.value)}
                      >
                        <option value="">Select item…</option>
                        {items.map((it) => (
                          <option key={it.id} value={it.id}>
                            {it.name}
                          </option>
                        ))}
                      </select>
                      <input
                        className="input mt-2"
                        placeholder="Description (optional)"
                        value={r.description || ''}
                        onChange={(e) => setDescription(r.id, e.target.value)}
                      />
                    </td>

                    {/* UoM - auto (read-only) */}
                    <td>
                      <input
                        className="input"
                        value={r.uom_code || ''}
                        readOnly
                        placeholder="-"
                      />
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

                    {/* Margin % (optional) */}
                    <td>
                      <input
                        className="input"
                        type="number"
                        step="0.01"
                        value={r.margin_pct}
                        onChange={(e) =>
                          setMargin(r.id, parseFloat(e.target.value || '0'))
                        }
                      />
                    </td>

                    {/* Unit price (auto from item, editable) */}
                    <td>
                      <input
                        className="input"
                        type="number"
                        step="0.01"
                        value={r.unit_price}
                        onChange={(e) =>
                          setUnitPrice(r.id, parseFloat(e.target.value || '0'))
                        }
                      />
                    </td>

                    {/* Tax % */}
                    <td>
                      <input
                        className="input"
                        type="number"
                        step="0.01"
                        value={r.tax_rate}
                        onChange={(e) =>
                          setTaxRate(r.id, parseFloat(e.target.value || '0'))
                        }
                      />
                    </td>

                    {/* Line total */}
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
                <td colSpan={8}>
                  <Button type="button" onClick={addRow}>
                    + Add Line
                  </Button>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Totals + Actions */}
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
                <div className="text-sm text-gray-600 self-center">
                  Saved #{invoiceNoJustSaved}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </Protected>
  );
}
