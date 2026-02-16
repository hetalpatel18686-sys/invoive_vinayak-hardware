
'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import Protected from '@/components/Protected';

/** ---------------- Types ---------------- */
type DocType = 'sale' | 'return';

type InvoiceLite = {
  id: string;
  invoice_no: string;
  status: string | null;
  issued_at: string | null;
  grand_total: number | null;
  doc_type?: DocType | string | null;
  customer_id?: string | null;
};

type InvoiceItem = {
  invoice_id: string;
  item_id: string | null;
  description: string | null;
  qty: number;
  unit_price: number;
  line_total: number | null;
  base_cost_at_sale: number | null;
  margin_pct_at_sale: number | null;
  tax_rate: number | null;
};

type Customer = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  street_name: string | null;
  village_town: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
};

type ItemRow = { id: string; sku: string | null; uom_id?: string | null };
type UomRow  = { id: string; code: string | null };

type SortKey =
  | 'invoice_no'
  | 'customer'
  | 'doc_type'
  | 'status'
  | 'issued_at'
  | 'originalCost'
  | 'margin'
  | 'grand';

/** ---------------- Helpers ---------------- */
function fullName(c?: Partial<Customer> | null) {
  if (!c) return '';
  return [c.first_name, c.last_name].filter(Boolean).join(' ').trim();
}
function oneLineAddress(c?: Partial<Customer> | null) {
  if (!c) return '';
  return [c.street_name, c.village_town, c.city, c.postal_code, c.state]
    .filter(Boolean)
    .map(s => String(s).trim())
    .join(', ');
}
const money = (n: number | null | undefined) => `₹${Number(n || 0).toFixed(2)}`;

/** ---------------- Component ---------------- */
export default function Reports() {
  const [loading, setLoading] = useState(true);
  const [invoices, setInvoices] = useState<InvoiceLite[]>([]);
  const [byInvAgg, setByInvAgg] = useState<Record<string, {
    originalCost: number;   // sum(qty * base_cost_at_sale)   (signed for returns)
    margin: number;         // sum(qty * (unit - base))       (signed for returns)
    subtotal: number;       // sum(qty * unit_price)          (signed for returns)
    tax: number;            // sum(tax)                       (signed for returns)
    grand: number;          // invoices.grand_total
  }>>({});

  /** Customers map for these invoices (used for filter + display) */
  const [custMap, setCustMap] = useState<Map<string, Customer>>(new Map());

  /** -------------- Filters -------------- */
  const [fromDate, setFromDate] = useState<string>('');      // YYYY-MM-DD
  const [toDate, setToDate] = useState<string>('');          // YYYY-MM-DD
  const [docType, setDocType] = useState<'all' | 'sale' | 'return'>('all');
  const [customerId, setCustomerId] = useState<string>('all');

  /** -------------- Sorting -------------- */
  const [sortKey, setSortKey] = useState<SortKey>('issued_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  function toggleSort(k: SortKey) {
    setSortKey(prev => {
      if (prev !== k) {
        setSortDir('asc');
        return k;
      }
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
      return k;
    });
  }

  /** -------------- Detail drawer -------------- */
  const [showDrawer, setShowDrawer] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailInv, setDetailInv] = useState<InvoiceLite | null>(null);
  const [detailCust, setDetailCust] = useState<Customer | null>(null);
  const [detailLines, setDetailLines] = useState<(InvoiceItem & {
    sku?: string | null;
    uom_code?: string | null;
    _calc?: { base: number; lineOriginal: number; lineMargin: number; lineSubtotal: number; lineTax: number; };
  })[]>([]);
  const [detailAgg, setDetailAgg] = useState<{ originalCost: number; margin: number; subtotal: number; tax: number; grand: number; }>({
    originalCost: 0, margin: 0, subtotal: 0, tax: 0, grand: 0
  });

  /** Load last 100 invoices + their item aggregates */
  async function refresh() {
    try {
      setLoading(true);

      // 1) Invoices (last 100)
      const r = await supabase
        .from('invoices')
        .select('id, invoice_no, status, issued_at, grand_total, doc_type, customer_id')
        .order('created_at', { ascending: false })
        .limit(100);

      const invs: InvoiceLite[] = (r.data ?? []).map((x: any) => ({
        id: x.id,
        invoice_no: x.invoice_no,
        status: x.status,
        issued_at: x.issued_at,
        grand_total: Number(x.grand_total ?? 0),
        doc_type: (x.doc_type as DocType) ?? 'sale',
        customer_id: x.customer_id ?? null,
      }));
      setInvoices(invs);

      // 2) Customers for these invoices
      const custIds = Array.from(new Set(invs.map(i => i.customer_id).filter(Boolean))) as string[];
      let cMap = new Map<string, Customer>();
      if (custIds.length > 0) {
        const cr = await supabase
          .from('customers')
          .select('id, first_name, last_name, phone, street_name, village_town, city, state, postal_code')
          .in('id', custIds);
        (cr.data ?? []).forEach((c: any) => cMap.set(c.id, c as Customer));
      }
      setCustMap(cMap);

      // 3) Items for all invoices (one shot)
      if (invs.length === 0) { setByInvAgg({}); return; }
      const ids = invs.map(i => i.id);
      const li = await supabase
        .from('invoice_items')
        .select('invoice_id, item_id, description, qty, unit_price, line_total, base_cost_at_sale, margin_pct_at_sale, tax_rate')
        .in('invoice_id', ids);

      const lines: InvoiceItem[] = (li.data ?? []).map((ln: any) => ({
        invoice_id: ln.invoice_id,
        item_id: ln.item_id ?? null,
        description: ln.description ?? null,
        qty: Number(ln.qty ?? 0),
        unit_price: Number(ln.unit_price ?? 0),
        line_total: ln.line_total != null ? Number(ln.line_total) : null,
        base_cost_at_sale: ln.base_cost_at_sale != null ? Number(ln.base_cost_at_sale) : null,
        margin_pct_at_sale: ln.margin_pct_at_sale != null ? Number(ln.margin_pct_at_sale) : null,
        tax_rate: ln.tax_rate != null ? Number(ln.tax_rate) : null,
      }));

      // 4) Compute aggregates (returns are negative)
      const byId: Record<string, { originalCost: number; margin: number; subtotal: number; tax: number; grand: number; }> = {};
      for (const inv of invs) {
        byId[inv.id] = { originalCost: 0, margin: 0, subtotal: 0, tax: 0, grand: Number(inv.grand_total ?? 0) };
      }
      for (const ln of lines) {
        const inv = invs.find(x => x.id === ln.invoice_id);
        if (!inv) continue;
        const sign = inv.doc_type === 'return' ? -1 : 1;

        const qty = Number(ln.qty || 0);
        const unit = Number(ln.unit_price || 0);
        const base = (typeof ln.base_cost_at_sale === 'number')
          ? Number(ln.base_cost_at_sale)
          : (typeof ln.margin_pct_at_sale === 'number'
              ? unit / (1 + (ln.margin_pct_at_sale || 0) / 100)
              : 0);

        const lineSubtotal = qty * unit;
        const lineOriginal = qty * base;
        const lineMargin   = qty * Math.max(0, unit - base);

        const effLine = ln.line_total != null ? Number(ln.line_total) : lineSubtotal;
        const lineTax  = Math.ceil(effLine * ((ln.tax_rate || 0) / 100));

        byId[ln.invoice_id].originalCost += sign * Math.ceil(lineOriginal);
        byId[ln.invoice_id].margin      += sign * Math.ceil(lineMargin);
        byId[ln.invoice_id].subtotal    += sign * Math.ceil(lineSubtotal);
        byId[ln.invoice_id].tax         += sign * Math.ceil(lineTax);
      }
      setByInvAgg(byId);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  /** ---------- Build view rows with filters applied ---------- */
  const viewRows = useMemo(() => {
    // Convert to a unified row model
    const rows = invoices.map(inv => {
      const agg = byInvAgg[inv.id] || { originalCost: 0, margin: 0, subtotal: 0, tax: 0, grand: Number(inv.grand_total || 0) };
      const cust = inv.customer_id ? custMap.get(inv.customer_id) : undefined;
      return {
        id: inv.id,
        invoice_no: inv.invoice_no,
        status: inv.status || '',
        issued_at: inv.issued_at || '',
        doc_type: (inv.doc_type || 'sale') as DocType | string,
        customer_id: inv.customer_id || '',
        customer: fullName(cust) || '',
        grand: Number(inv.grand_total || 0),
        originalCost: agg.originalCost,
        margin: agg.margin,
      };
    });

    // Filters (client-side) — we have only last 100 invoices loaded
    const from = fromDate ? new Date(fromDate + 'T00:00:00') : null;
    const to   = toDate   ? new Date(toDate   + 'T23:59:59.999') : null;

    return rows.filter(r => {
      if (docType !== 'all' && r.doc_type !== docType) return false;
      if (customerId !== 'all' && r.customer_id !== customerId) return false;
      if (from || to) {
        const d = r.issued_at ? new Date(r.issued_at) : null;
        if (!d) return false;
        if (from && d < from) return false;
        if (to   && d > to)   return false;
      }
      return true;
    });
  }, [invoices, byInvAgg, custMap, fromDate, toDate, docType, customerId]);

  /** ---------- Sorting ---------- */
  const viewSorted = useMemo(() => {
    const cp = [...viewRows];
    cp.sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;

      function pick(v: typeof a, key: SortKey): any {
        switch (key) {
          case 'invoice_no':   return (v.invoice_no ?? '').toLowerCase();
          case 'customer':     return (v.customer ?? '').toLowerCase();
          case 'doc_type':     return (String(v.doc_type) ?? '').toLowerCase();
          case 'status':       return (v.status ?? '').toLowerCase();
          case 'issued_at':    return v.issued_at ? new Date(v.issued_at).valueOf() : -Infinity;
          case 'originalCost': return Number(v.originalCost ?? 0);
          case 'margin':       return Number(v.margin ?? 0);
          case 'grand':        return Number(v.grand ?? 0);
          default:             return 0;
        }
      }

      const va = pick(a, sortKey);
      const vb = pick(b, sortKey);

      if (typeof va === 'number' && typeof vb === 'number') {
        return (va - vb) * dir;
      }
      if (va < vb) return -1 * dir;
      if (va > vb) return  1 * dir;
      return 0;
    });
    return cp;
  }, [viewRows, sortKey, sortDir]);

  /** ---------- Top summary of the CURRENT VIEW ---------- */
  const top = useMemo(() => {
    let grand = 0, original = 0, margin = 0;
    for (const r of viewSorted) {
      grand    += Number(r.grand || 0);
      original += Number(r.originalCost || 0);
      margin   += Number(r.margin || 0);
    }
    return { grand, original, margin };
  }, [viewSorted]);

  /** ---------- CSV Export (current view) ---------- */
  const exportCsv = () => {
    const header = [
      'Invoice No',
      'Customer',
      'Doc Type',
      'Status',
      'Issued',
      'Original Cost',
      'Margin',
      'Grand Total',
    ];
    const lines = viewSorted.map(r => ([
      r.invoice_no,
      r.customer,
      String(r.doc_type ?? ''),
      r.status,
      r.issued_at ?? '',
      r.originalCost.toFixed(2),
      r.margin.toFixed(2),
      r.grand.toFixed(2),
    ].map(v => `"${String(v).replaceAll('"','""')}"`).join(',')));
    const date = new Date().toISOString().slice(0,10);
    const rows = [header.join(','), ...lines];
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reports_${date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /** ---------- Open Detail Drawer ---------- */
  const openDetail = async (invRowId: string) => {
    const inv = invoices.find(x => x.id === invRowId);
    if (!inv) return;

    try {
      setShowDrawer(true);
      setDetailLoading(true);
      setDetailInv(inv);
      setDetailCust(inv.customer_id ? (custMap.get(inv.customer_id) ?? null) : null);
      setDetailLines([]);
      setDetailAgg({
        originalCost: byInvAgg[inv.id]?.originalCost ?? 0,
        margin: byInvAgg[inv.id]?.margin ?? 0,
        subtotal: byInvAgg[inv.id]?.subtotal ?? 0,
        tax: byInvAgg[inv.id]?.tax ?? 0,
        grand: Number(inv.grand_total || 0),
      });

      // invoice lines
      const li = await supabase
        .from('invoice_items')
        .select('invoice_id, item_id, description, qty, unit_price, line_total, base_cost_at_sale, margin_pct_at_sale, tax_rate')
        .eq('invoice_id', inv.id);

      const lines: InvoiceItem[] = (li.data ?? []).map((ln: any) => ({
        invoice_id: ln.invoice_id,
        item_id: ln.item_id ?? null,
        description: ln.description ?? null,
        qty: Number(ln.qty ?? 0),
        unit_price: Number(ln.unit_price ?? 0),
        line_total: ln.line_total != null ? Number(ln.line_total) : null,
        base_cost_at_sale: ln.base_cost_at_sale != null ? Number(ln.base_cost_at_sale) : null,
        margin_pct_at_sale: ln.margin_pct_at_sale != null ? Number(ln.margin_pct_at_sale) : null,
        tax_rate: ln.tax_rate != null ? Number(ln.tax_rate) : null,
      }));

      // enrich with sku + uom code
      const itemIds = Array.from(new Set(lines.map(x => x.item_id).filter(Boolean))) as string[];
      let itemsMap = new Map<string, ItemRow>();
      let uomMap   = new Map<string, UomRow>();
      if (itemIds.length > 0) {
        const itemsRes = await supabase
          .from('items')
          .select('id, sku, uom_id')
          .in('id', itemIds);
        (itemsRes.data ?? []).forEach((it: any) => itemsMap.set(it.id, it));
        const uomIds = Array.from(new Set((itemsRes.data ?? []).map((it: any) => it?.uom_id).filter(Boolean)));
        if (uomIds.length > 0) {
          const uomsRes = await supabase
            .from('units_of_measure')
            .select('id, code')
            .in('id', uomIds);
          (uomsRes.data ?? []).forEach((u: any) => uomMap.set(u.id, u));
        }
      }

      const sign = inv.doc_type === 'return' ? -1 : 1;

      let aggOriginal = 0, aggMargin = 0, aggSubtotal = 0, aggTax = 0;
      const beautified = lines.map(ln => {
        const it = ln.item_id ? itemsMap.get(ln.item_id) : undefined;
        const uom_code = it?.uom_id ? (uomMap.get(String(it.uom_id))?.code ?? null) : null;
        const qty = Number(ln.qty || 0);
        const unit = Number(ln.unit_price || 0);
        const base = (typeof ln.base_cost_at_sale === 'number')
          ? Number(ln.base_cost_at_sale)
          : (typeof ln.margin_pct_at_sale === 'number'
              ? unit / (1 + (ln.margin_pct_at_sale || 0) / 100)
              : 0);

        const lineSubtotal = qty * unit;
        const lineOriginal = qty * base;
        const lineMargin   = qty * Math.max(0, unit - base);
        const effLine = ln.line_total != null ? Number(ln.line_total) : lineSubtotal;
        const lineTax  = Math.ceil(effLine * ((ln.tax_rate || 0) / 100));

        aggOriginal += sign * Math.ceil(lineOriginal);
        aggMargin   += sign * Math.ceil(lineMargin);
        aggSubtotal += sign * Math.ceil(lineSubtotal);
        aggTax      += sign * Math.ceil(lineTax);

        return {
          ...ln,
          sku: it?.sku ?? null,
          uom_code: uom_code ?? null,
          _calc: {
            base,
            lineOriginal: Math.ceil(lineOriginal) * sign,
            lineMargin: Math.ceil(lineMargin) * sign,
            lineSubtotal: Math.ceil(lineSubtotal) * sign,
            lineTax: Math.ceil(lineTax) * sign,
          }
        };
      });

      setDetailLines(beautified);
      setDetailAgg({
        originalCost: aggOriginal,
        margin: aggMargin,
        subtotal: aggSubtotal,
        tax: aggTax,
        grand: Number(inv.grand_total || 0),
      });
    } finally {
      setDetailLoading(false);
    }
  };

  /** ---------- UI ---------- */
  return (
    <Protected>
      <div className="card">
        <h1 className="text-xl font-semibold mb-3">Reports</h1>

        {/* Filters */}
        <div className="card mb-4">
          <div className="grid md:grid-cols-5 gap-3">
            <div>
              <label className="label">From</label>
              <input className="input" type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} />
            </div>
            <div>
              <label className="label">To</label>
              <input className="input" type="date" value={toDate} onChange={e => setToDate(e.target.value)} />
            </div>
            <div>
              <label className="label">Doc Type</label>
              <select className="input" value={docType} onChange={e => setDocType(e.target.value as any)}>
                <option value="all">All</option>
                <option value="sale">Sale</option>
                <option value="return">Return</option>
              </select>
            </div>
            <div>
              <label className="label">Customer</label>
              <select className="input" value={customerId} onChange={e => setCustomerId(e.target.value)}>
                <option value="all">All</option>
                {Array.from(custMap.values())
                  .sort((a,b) => fullName(a).localeCompare(fullName(b)))
                  .map(c => (
                    <option key={c.id} value={c.id}>{fullName(c) || '(no name)'}{c.phone ? ` • ${c.phone}` : ''}</option>
                  ))}
              </select>
            </div>
            <div className="flex items-end gap-2">
              <button
                type="button"
                className="px-3 py-2 rounded bg-gray-200 hover:bg-gray-300"
                onClick={() => { setFromDate(''); setToDate(''); setDocType('all'); setCustomerId('all'); }}
                title="Clear filters"
              >
                Clear
              </button>
              <button
                type="button"
                className="px-3 py-2 rounded bg-gray-700 hover:bg-gray-800 text-white"
                onClick={refresh}
                title="Reload last 100 invoices"
              >
                Refresh
              </button>
              <button
                type="button"
                className="px-3 py-2 rounded bg-primary text-white"
                onClick={exportCsv}
                title="Export current view"
              >
                Export CSV
              </button>
            </div>
          </div>
        </div>

        {/* Top summary for CURRENT VIEW */}
        <div className="grid md:grid-cols-3 gap-4">
          <div className="card">
            <div className="text-sm text-gray-600">Grand Total (current view)</div>
            <div className="text-2xl font-semibold">{money(top.grand)}</div>
          </div>
          <div className="card">
            <div className="text-sm text-gray-600">Margin Total (current view)</div>
            <div className="text-2xl font-semibold">{money(top.margin)}</div>
          </div>
          <div className="card">
            <div className="text-sm text-gray-600">Original Cost Total (current view)</div>
            <div className="text-2xl font-semibold">{money(top.original)}</div>
          </div>
        </div>

        {/* Table */}
        <h2 className="font-semibold mt-6 mb-2">Invoices</h2>
        <div className="overflow-auto">
          <table className="table w-full">
            <thead>
              <tr>
                <th>
                  <button type="button" className="w-full flex items-center gap-1 font-semibold"
                    onClick={() => toggleSort('invoice_no')}
                    title="Sort by Invoice No"
                  >
                    <span>No.</span><span className="text-xs opacity-70">{sortKey==='invoice_no' ? (sortDir==='asc'?'▲':'▼'):'↕'}</span>
                  </button>
                </th>
                <th>
                  <button type="button" className="w-full flex items-center gap-1 font-semibold"
                    onClick={() => toggleSort('customer')}
                    title="Sort by Customer"
                  >
                    <span>Customer</span><span className="text-xs opacity-70">{sortKey==='customer' ? (sortDir==='asc'?'▲':'▼'):'↕'}</span>
                  </button>
                </th>
                <th>
                  <button type="button" className="w-full flex items-center gap-1 font-semibold"
                    onClick={() => toggleSort('doc_type')}
                    title="Sort by Doc Type"
                  >
                    <span>Type</span><span className="text-xs opacity-70">{sortKey==='doc_type' ? (sortDir==='asc'?'▲':'▼'):'↕'}</span>
                  </button>
                </th>
                <th>
                  <button type="button" className="w-full flex items-center gap-1 font-semibold"
                    onClick={() => toggleSort('status')}
                    title="Sort by Status"
                  >
                    <span>Status</span><span className="text-xs opacity-70">{sortKey==='status' ? (sortDir==='asc'?'▲':'▼'):'↕'}</span>
                  </button>
                </th>
                <th>
                  <button type="button" className="w-full flex items-center gap-1 font-semibold"
                    onClick={() => toggleSort('issued_at')}
                    title="Sort by Issued"
                  >
                    <span>Issued</span><span className="text-xs opacity-70">{sortKey==='issued_at' ? (sortDir==='asc'?'▲':'▼'):'↕'}</span>
                  </button>
                </th>
                <th className="text-right">
                  <button type="button" className="w-full flex items-center gap-1 justify-end font-semibold"
                    onClick={() => toggleSort('originalCost')}
                    title="Sort by Original Cost"
                  >
                    <span>Original Cost</span><span className="text-xs opacity-70">{sortKey==='originalCost' ? (sortDir==='asc'?'▲':'▼'):'↕'}</span>
                  </button>
                </th>
                <th className="text-right">
                  <button type="button" className="w-full flex items-center gap-1 justify-end font-semibold"
                    onClick={() => toggleSort('margin')}
                    title="Sort by Margin"
                  >
                    <span>Margin</span><span className="text-xs opacity-70">{sortKey==='margin' ? (sortDir==='asc'?'▲':'▼'):'↕'}</span>
                  </button>
                </th>
                <th className="text-right">
                  <button type="button" className="w-full flex items-center gap-1 justify-end font-semibold"
                    onClick={() => toggleSort('grand')}
                    title="Sort by Total"
                  >
                    <span>Total</span><span className="text-xs opacity-70">{sortKey==='grand' ? (sortDir==='asc'?'▲':'▼'):'↕'}</span>
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {!loading && viewSorted.length === 0 ? (
                <tr><td colSpan={8} className="p-3 text-sm text-gray-600">No invoices match your filters.</td></tr>
              ) : (
                viewSorted.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <button
                        type="button"
                        className="text-primary hover:underline"
                        onClick={() => openDetail(r.id)}
                        title="View details"
                      >
                        {r.invoice_no}
                      </button>
                    </td>
                    <td>{r.customer || '—'}</td>
                    <td className="capitalize">{String(r.doc_type || 'sale')}</td>
                    <td className="capitalize">{r.status || '—'}</td>
                    <td>{r.issued_at || '—'}</td>
                    <td className="text-right" style={{ fontVariantNumeric: 'tabular-nums' }}>{money(r.originalCost)}</td>
                    <td className="text-right" style={{ fontVariantNumeric: 'tabular-nums' }}>{money(r.margin)}</td>
                    <td className="text-right" style={{ fontVariantNumeric: 'tabular-nums' }}>{money(r.grand)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ===== Detail Drawer ===== */}
      {showDrawer && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowDrawer(false)} />
          <div className="absolute right-0 top-0 h-full w-full max-w-3xl bg-white shadow-xl overflow-y-auto">
            <div className="p-4 border-b flex items-center gap-2">
              <div className="text-lg font-semibold flex-1">
                {detailInv?.doc_type === 'return' ? 'Return' : 'Invoice'}{' '}
                {detailInv?.invoice_no ? `#${detailInv?.invoice_no}` : ''}
              </div>
              {detailInv?.id && (
                <a
                  className="px-3 py-2 rounded bg-gray-100 hover:bg-gray-200 text-sm"
                  href={`/invoices/${detailInv.id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open Full Page
                </a>
              )}
              <button
                type="button"
                className="px-3 py-2 rounded bg-gray-700 hover:bg-gray-800 text-white text-sm"
                onClick={() => setShowDrawer(false)}
              >
                Close
              </button>
            </div>

            <div className="p-4">
              {detailLoading ? (
                <div className="text-sm text-gray-600">Loading…</div>
              ) : (
                <>
                  {/* Header + Customer */}
                  <div className="grid md:grid-cols-2 gap-3 mb-3">
                    <div>
                      <div className="text-sm text-gray-700">Issued</div>
                      <div className="font-medium">{detailInv?.issued_at || '—'}</div>
                      <div className="text-sm text-gray-700 mt-2">Status</div>
                      <div className="font-medium capitalize">{detailInv?.status || '—'}</div>
                      <div className="text-sm text-gray-700 mt-2">Doc Type</div>
                      <div className="font-medium capitalize">{detailInv?.doc_type || 'sale'}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-700">Customer</div>
                      <div className="font-medium">{fullName(detailCust) || '—'}</div>
                      <div className="text-sm text-gray-700">{oneLineAddress(detailCust) || '—'}</div>
                      {detailCust?.phone ? (
                        <div className="text-sm text-gray-700 mt-1">Phone: {detailCust.phone}</div>
                      ) : null}
                    </div>
                  </div>

                  {/* Lines */}
                  <div className="overflow-auto">
                    <table className="table w-full">
                      <thead>
                        <tr>
                          <th>SKU</th>
                          <th style={{ minWidth: 200 }}>Description</th>
                          <th>UoM</th>
                          <th className="text-right">Qty</th>
                          <th className="text-right">Base (Orig)</th>
                          <th className="text-right">Margin</th>
                          <th className="text-right">Unit Price</th>
                          <th className="text-right">Line Total</th>
                          <th className="text-right">Tax %</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailLines.length === 0 ? (
                          <tr><td colSpan={9} className="p-3 text-sm text-gray-600">No items.</td></tr>
                        ) : detailLines.map((ln, idx) => (
                          <tr key={idx}>
                            <td>{ln.sku || ''}</td>
                            <td>{ln.description || ''}</td>
                            <td>{ln.uom_code || '-'}</td>
                            <td className="text-right" style={{ fontVariantNumeric: 'tabular-nums' }}>
                              {ln.qty}
                            </td>
                            <td className="text-right" style={{ fontVariantNumeric: 'tabular-nums' }}>
                              {money(ln._calc?.lineOriginal ?? 0)}
                            </td>
                            <td className="text-right" style={{ fontVariantNumeric: 'tabular-nums' }}>
                              {money(ln._calc?.lineMargin ?? 0)}
                            </td>
                            <td className="text-right" style={{ fontVariantNumeric: 'tabular-nums' }}>
                              {money(ln.unit_price)}
                            </td>
                            <td className="text-right" style={{ fontVariantNumeric: 'tabular-nums' }}>
                              {money(ln.line_total != null ? ln.line_total : ln._calc?.lineSubtotal ?? 0)}
                            </td>
                            <td className="text-right">
                              {Number(ln.tax_rate || 0).toFixed(2)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Totals */}
                  <div className="mt-4 grid sm:grid-cols-2 gap-3">
                    <div className="border rounded p-3">
                      <div className="flex justify-between"><div>Original Cost</div><div>{money(detailAgg.originalCost)}</div></div>
                      <div className="flex justify-between"><div>Margin</div><div>{money(detailAgg.margin)}</div></div>
                      <div className="flex justify-between"><div>Subtotal (before tax)</div><div>{money(detailAgg.subtotal)}</div></div>
                    </div>
                    <div className="border rounded p-3">
                      <div className="flex justify-between"><div>Tax</div><div>{money(detailAgg.tax)}</div></div>
                      <div className="flex justify-between font-semibold"><div>Grand Total</div><div>{money(detailAgg.grand)}</div></div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </Protected>
  );
}
