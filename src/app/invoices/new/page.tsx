
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
  base_price: number;   // base price from DB
  margin_pct: number;   // margin (screen only, print-hidden)
  qty: number;
  unit_price: number;   // computed price (base + margin%)
  tax_rate: number;
  description?: string;
}

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
  const [customerName, setCustomerName] = useState<string>('');     // NEW: First + Last
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

  // Lookup customer
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
      setCustomerName(fullName(c));                                // NEW
      setCustomerAddress1Line(oneLineAddress(c));
      setShowCreateCustomer(false);
    }
  };

  // Create customer
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
    setCustomerName(fullName(c));                                   // NEW
    setCustomerAddress1Line(oneLineAddress(c));
    setShowCreateCustomer(false);
  };

  // Change item on a row (dropdown) — your original behavior
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
              unit_price: it?.unit_price || 0,     // auto price
              tax_rate: it?.tax_rate || 0,
              description: it?.name || '',
            }
          : r
      )
    );
  };

  // Margin %
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

  // Save
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

      // lines
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

      // stock moves
      const moveType = docType === 'sale' ? 'issue' : 'return';
      const moves = rows.map((r) => ({
        item_id: r.item_id,
        move_type: moveType,
        qty: r.qty,
        ref: inv.invoice_no,
        reason: docType,
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
  };

  // New invoice (reset page)
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
        base_price: 0,
        margin_pct: 0,
        qty: 1,
        unit_price: 0,
        tax_rate: 0,
        description: '',
      },
    ]);
    setNotes('');
    setSaving(false);
    setInvoiceIdJustSaved(null);
    setInvoiceNoJustSaved(null);
  }

  // Print invoice
  function openPrint() {
    if (invoiceIdJustSaved) {
      window.open(`/invoices/${invoiceIdJustSaved}`, '_blank');
    }
  }

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
