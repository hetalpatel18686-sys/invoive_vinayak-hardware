'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import Button from '@/components/Button';

/* ======================================================
   Round-up helpers (ALWAYS whole rupees)
   ====================================================== */
const rupeeCeil = (n: number) => Math.ceil((n ?? 0) + Number.EPSILON);
const INR0 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

const withGst = (base: number, gstPct: number) =>
  rupeeCeil((base ?? 0) * (1 + (gstPct ?? 0) / 100));
const withGstAndMargin = (base: number, gstPct: number, marginPct: number) =>
  rupeeCeil(withGst(base ?? 0, gstPct ?? 0) * (1 + (marginPct ?? 0) / 100));

/* ======================================================
   Types
   ====================================================== */
interface InvRow {
  id: string;
  sku: string;
  name: string;
  stock_qty: number;
  unit_cost: number; // fallback average cost
  uom_code: string;
  low_stock_threshold: number | null;
  locations: { name: string; qty: number }[];
  locations_all: { name: string; qty: number }[];
  locations_text: string;

  // pricing fields from DB
  purchase_price: number | null;
  gst_percent: number | null;
  margin_percent: number | null;

  // Optional selling price column (from DB if present)
  selling_price_per_unit?: number | null;
}

type PurchaseRequest = {
  id: string;
  item_id: string;
  sku: string | null;
  name: string | null;
  current_stock: number | null;
  min_stock: number | null;
  status: 'pending' | 'ordered' | 'received';
  created_at: string;
};

type SortKey =
  | 'sku'
  | 'name'
  | 'uom_code'
  | 'stock_qty'
  | 'low_stock_threshold'
  | 'unit_cost'
  | 'total_value'
  | 'locations_text';

type LocationScope = 'all_items' | 'has_stock' | 'appears_any';
type Sel = Record<string, { checked: boolean; qty: number }>;

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/* ======================================================
   CSV helper
   ====================================================== */
function downloadCsv(filename: string, rows: string[]) {
  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* ======================================================
   Sort header
   ====================================================== */
function SortHeader({
  label, active, dir, onClick, alignRight = false,
}: {
  label: string; active: boolean; dir: 'asc'|'desc';
  onClick: () => void; alignRight?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`th-label font-semibold ${alignRight ? 'justify-end' : 'justify-start'}`}
      style={{ whiteSpace: 'nowrap' }}
      title={`Sort by ${label}`}
    >
      <span>{label}</span>
      <span className="text-xs opacity-70">{active ? (dir === 'asc' ? '▲' : '▼') : '↕'}</span>
    </button>
  );
}

/* ======================================================
   Simple Toast (popup notification)
   ====================================================== */
function Toast({ text, onClose }: { text: string; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 4000);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <div className="fixed bottom-4 right-4 z-[60] rounded bg-black text-white/90 px-3 py-2 shadow-lg">
      {text}
    </div>
  );
}

/* ======================================================
   Printable PO helpers (no external libs)
   ====================================================== */
function openPrintWindow(html: string, title = 'Purchase Order') {
  const w = window.open('', '_blank', 'noopener,noreferrer,width=900,height=700');
  if (!w) return alert('Popup blocked. Allow popups to print.');
  w.document.open();
  w.document.write(`
    <!doctype html><html><head>
      <meta charset="utf-8" />
      <title>${title}</title>
      <style>
        * { box-sizing: border-box; }
        body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; margin: 24px; color:#111827; }
        h1 { margin: 0 0 4px; font-size: 18px; }
        h2 { margin: 16px 0 8px; font-size: 16px; }
        .muted { color:#6b7280; font-size:12px; }
        table { width: 100%; border-collapse: collapse; font-size: 13px; }
        th, td { border:1px solid #e5e7eb; padding: 8px; text-align: left; }
        tfoot td { font-weight: 600; }
        .row { display:flex; gap:24px; }
        .col { flex:1; }
        .right { text-align:right; }
      </style>
    </head><body>
      ${html}
      <script>
        setTimeout(()=>{ window.print(); }, 200);
      </script>
    </body></html>
  `);
  w.document.close();
}

function buildPoHtml(opts: {
  brand: string;
  supplier: { name: string; email?: string; phone?: string; address?: string };
  request: PurchaseRequest;
}) {
  const { brand, supplier, request } = opts;
  const today = new Date().toLocaleString();
  return `
    <h1>Purchase Order (Auto)</h1>
    <div class="muted">Generated: ${today} • ${brand}</div>
    <div class="row" style="margin-top:12px;">
      <div class="col">
        <h2>Supplier</h2>
        <div><strong>${supplier.name || '-'}</strong></div>
        <div class="muted">${supplier.email || ''} ${supplier.phone ? ' • '+supplier.phone : ''}</div>
        <div class="muted">${supplier.address || ''}</div>
      </div>
      <div class="col">
        <h2>Request</h2>
        <div><strong>SKU</strong>: ${request.sku ?? '-'}</div>
        <div><strong>Item</strong>: ${request.name ?? '-'}</div>
        <div><strong>Current</strong>: ${request.current_stock ?? '-'} • <strong>Min</strong>: ${request.min_stock ?? '-'}</div>
        <div><strong>PR ID</strong>: ${request.id}</div>
      </div>
    </div>

    <h2 style="margin-top:18px;">Lines</h2>
    <table>
      <thead><tr>
        <th>#</th><th>SKU</th><th>Item</th><th class="right">Qty</th><th>UoM</th><th class="right">Remarks</th>
      </tr></thead>
      <tbody>
        <tr>
          <td>1</td>
          <td>${request.sku ?? '-'}</td>
          <td>${request.name ?? '-'}</td>
          <td class="right">${Math.max(1, Number(request.min_stock ?? 1))}</td>
          <td>EA</td>
          <td class="right">Auto low-stock PO</td>
        </tr>
      </tbody>
      <tfoot>
        <tr><td colspan="6" class="right">Thank you</td></tr>
      </tfoot>
    </table>
  `;
}

/* ======================================================
   Page
   ====================================================== */
export default function InventoryPage() {
  const [loading, setLoading] = useState<boolean>(true);
  const [rows, setRows] = useState<InvRow[]>([]);
  const [search, setSearch] = useState<string>('');
  const [lowOnly, setLowOnly] = useState<boolean>(false);
  const [sortKey, setSortKey] = useState<SortKey>('sku');
  const [sortDir, setSortDir] = useState<'asc'|'desc'>('asc');

  // location filter
  const [allLocations, setAllLocations] = useState<string[]>([]);
  const [selectedLocation, setSelectedLocation] = useState<string>('');
  const [locationScope, setLocationScope] = useState<LocationScope>('all_items');
  const [showZeroQtyLocations, setShowZeroQtyLocations] = useState<boolean>(false);

  // selection for labels & estimate
  const [sel, setSel] = useState<Sel>({});
  const [bulkQtyState, setBulkQtyState] = useState<number>(1);
  const setBulkQtyInput = (n: number) => setBulkQtyState(Math.max(1, Math.min(500, Math.floor(n || 1))));

  const brandName = process.env.NEXT_PUBLIC_BRAND_NAME || 'Vinayak Hardware';
  const previewRef = useRef<HTMLDivElement | null>(null);

  const [purchaseRequests, setPurchaseRequests] = useState<PurchaseRequest[]>([]);
  const [loadingPRs, setLoadingPRs] = useState(false);

  // Toast notification
  const [toast, setToast] = useState<string | null>(null);

  const toggleSort = (k: SortKey) => {
    setSortKey(prev => {
      if (prev !== k) { setSortDir('asc'); return k; }
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
      return k;
    });
  };

  // === Safe items fetch (includes selling_price_per_unit when present) ===
  const fetchItemsSafe = async () => {
    const q1 = await supabase
      .from('items')
      .select('id, sku, name, stock_qty, unit_cost, low_stock_threshold, uom_id, purchase_price, gst_percent, margin_percent, selling_price_per_unit')
      .order('sku', { ascending: true });

    if (!q1.error) return q1;

    return await supabase
      .from('items')
      .select('id, sku, name, stock_qty, unit_cost, low_stock_threshold, uom_id, purchase_price, gst_percent, margin_percent')
      .order('sku', { ascending: true });
  };

  const loadInventory = async () => {
    try {
      setLoading(true);

      const { data: itemsData, error: itemsErr } = await fetchItemsSafe();
      if (itemsErr) throw itemsErr;

      const { data: uoms } = await supabase.from('units_of_measure').select('id, code');
      const uomMap = new Map<string, string>();
      (uoms ?? []).forEach((u: any) => uomMap.set(u.id, u.code));

      const { data: moves, error: movesErr } = await supabase
        .from('stock_moves')
        .select('item_id, move_type, qty, location');
      if (movesErr) throw movesErr;

      const perItemLocMap = new Map<string, Map<string, number>>();
      const allLocSet = new Set<string>();
      (moves ?? []).forEach((m: any) => {
        const itemId = String(m.item_id);
        const mt = String(m.move_type || '').toLowerCase();
        const loc = (String(m.location ?? '').trim()) || '(unassigned)';
        const qRaw = Number(m.qty ?? 0);
        let delta = qRaw;
        if (mt === 'issue') delta = -Math.abs(qRaw);
        else if (mt === 'receive' || mt === 'return') delta = Math.abs(qRaw);
        if (!perItemLocMap.has(itemId)) perItemLocMap.set(itemId, new Map());
        const map = perItemLocMap.get(itemId)!;
        map.set(loc, (map.get(loc) ?? 0) + delta);
        allLocSet.add(loc);
      });

      const allLocArr = Array.from(allLocSet.values()).sort((a, b) => a.localeCompare(b));
      setAllLocations(allLocArr);

      const mapped: InvRow[] = (itemsData ?? []).map((it: any) => {
        const itemId = String(it.id);
        const locMap = perItemLocMap.get(itemId) ?? new Map<string, number>();
        const locations_all = Array.from(locMap.entries()).map(([name, qty]) => ({ name, qty })).sort((a, b) => a.name.localeCompare(b.name));
        const filteredLocs = locations_all.filter(l => l.qty !== 0);

        return {
          id: it.id,
          sku: it.sku,
          name: it.name,
          stock_qty: Number(it.stock_qty ?? 0),
          unit_cost: Number(it.unit_cost ?? 0),
          low_stock_threshold: it.low_stock_threshold ?? null,
          uom_code: it.uom_id ? (uomMap.get(it.uom_id) ?? '') : '',
          locations: filteredLocs,
          locations_all,
          locations_text: filteredLocs.length ? filteredLocs.map(l => `${l.name}: ${l.qty}`).join(' | ') : '',
          purchase_price: it.purchase_price ?? null,
          gst_percent: it.gst_percent ?? null,
          margin_percent: it.margin_percent ?? null,
          selling_price_per_unit: it.selling_price_per_unit ?? null,
        };
      });

      setRows(mapped);
    } catch (e) {
      console.error(e);
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  async function loadPurchaseRequests() {
    setLoadingPRs(true);
    const { data, error } = await supabase
      .from('purchase_requests')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    if (!error) setPurchaseRequests((data || []) as PurchaseRequest[]);
    setLoadingPRs(false);
  }

  // Realtime popup when PR auto-creates
  useEffect(() => {
    loadInventory();
    loadPurchaseRequests();

    const ch = supabase
      .channel('pr-realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'purchase_requests' },
        (payload) => {
          const pr = payload.new as PurchaseRequest;
          setToast(`Low stock: ${pr.sku ?? ''} — ${pr.name ?? ''}`);
          loadPurchaseRequests();
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(ch); };
  }, []);

  const rowsWithDisplayLocations = useMemo(() => {
    return rows.map(row => {
      const displayLocs = showZeroQtyLocations ? row.locations_all : row.locations_all.filter(l => l.qty !== 0);
      return {
        ...row,
        locations: displayLocs,
        locations_text: displayLocs.length ? displayLocs.map(l => `${l.name}: ${l.qty}`).join(' | ') : '',
      };
    });
  }, [rows, showZeroQtyLocations]);

  const prefiltered = useMemo(() => {
    const t = search.trim().toLowerCase();
    return rowsWithDisplayLocations.filter(r => {
      const textHit =
        !t ||
        r.sku.toLowerCase().includes(t) ||
        (r.name ?? '').toLowerCase().includes(t) ||
        (r.locations_text ?? '').toLowerCase().includes(t);

      // Optional location filter (your earlier select controls)
      const inLocation = (() => {
        if (!selectedLocation) return true;
        const qAtLoc = r.locations_all.find(x => x.name === selectedLocation)?.qty ?? 0;
        if (locationScope === 'has_stock') return qAtLoc > 0;
        if (locationScope === 'appears_any') return r.locations_all.some(x => x.name === selectedLocation);
        return true; // all_items
      })();

      const isLow =
        r.low_stock_threshold != null &&
        r.low_stock_threshold > 0 &&
        r.stock_qty <= r.low_stock_threshold;

      return textHit && inLocation && (!lowOnly || isLow);
    });
  }, [rowsWithDisplayLocations, search, lowOnly, selectedLocation, locationScope]);

  // Compute rounded prices for display and totals
  const sorted = useMemo(() => {
    const cp = prefiltered.map(r => {
      const base = Number(r.purchase_price ?? r.unit_cost ?? 0);
      const gst = Number(r.gst_percent ?? 0);
      const margin = Number(r.margin_percent ?? 0);

      const unitCostGst = withGst(base, gst); // rounded ₹

      const sellingDb = r.selling_price_per_unit;
      const sellingPrice = Number.isFinite(Number(sellingDb)) && Number(sellingDb) > 0
        ? rupeeCeil(Number(sellingDb))
        : withGstAndMargin(base, gst, margin); // rounded ₹

      const total_value = r.stock_qty * sellingPrice; // integer ₹

      return { ...r, unitCostGst, sellingPrice, total_value };
    });

    cp.sort((a: any, b: any) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      let va: any; let vb: any;
      switch (sortKey) {
        case 'sku': va = a.sku?.toLowerCase() ?? ''; vb = b.sku?.toLowerCase() ?? ''; break;
        case 'name': va = a.name?.toLowerCase() ?? ''; vb = b.name?.toLowerCase() ?? ''; break;
        case 'uom_code': va = a.uom_code?.toLowerCase() ?? ''; vb = b.uom_code?.toLowerCase() ?? ''; break;
        case 'stock_qty': va = Number(a.stock_qty); vb = Number(b.stock_qty); break;
        case 'low_stock_threshold': va = Number(a.low_stock_threshold ?? -Infinity); vb = Number(b.low_stock_threshold ?? -Infinity); break;
        case 'unit_cost': va = Number(a.unit_cost); vb = Number(b.unit_cost); break;
        case 'total_value': va = Number(a.total_value); vb = Number(b.total_value); break;
        case 'locations_text': va = (a.locations_text ?? '').toLowerCase(); vb = (b.locations_text ?? '').toLowerCase(); break;
        default: va = 0; vb = 0;
      }
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      if (va < vb) return -1 * dir;
      if (va > vb) return  1 * dir;
      return 0;
    });

    return cp as (InvRow & { unitCostGst: number; sellingPrice: number; total_value: number })[];
  }, [prefiltered, sortKey, sortDir]);

  const totals = useMemo(() => {
    let qty = 0, value = 0;
    for (const r of sorted) {
      qty += r.stock_qty;
      value += r.total_value; // already integer rupees
    }
    return { qty: round2(qty), value: rupeeCeil(value) };
  }, [sorted]);

  /* =========================
     PR: Manual creation (Option A — in addition to trigger)
     ========================= */
  async function createRequestForItem(row: InvRow) {
    const { data, error } = await supabase.from('purchase_requests').insert({
      item_id: row.id,
      sku: row.sku,
      name: row.name,
      current_stock: row.stock_qty,
      min_stock: row.low_stock_threshold ?? 0,
      status: 'pending',
    }).select('*').single();

    if (error) return alert('Create request failed: ' + error.message);
    setToast(`Request created: ${row.sku}`);
    await loadPurchaseRequests();

    // Optional: notify email/WhatsApp automatically
    if (process.env.NEXT_PUBLIC_NOTIFY_ON_CREATE === '1') {
      try { await notifyEmail(data as PurchaseRequest); } catch {}
      try { await notifyWhatsapp(data as PurchaseRequest); } catch {}
    }
  }

  /* =========================
     PR: Status changes (ordered / received)
     ========================= */
  async function setPrStatus(id: string, status: PurchaseRequest['status']) {
    const { error } = await supabase.from('purchase_requests').update({ status }).eq('id', id);
    if (error) return alert('Update failed: ' + error.message);
    await loadPurchaseRequests();
  }

  /* =========================
     Notifications (B & C)
     ========================= */
  async function callEdge(fnName: string, payload: any) {
    // Uses Supabase Edge Functions (deployed in step 3)
    const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/${fnName}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}` },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  async function notifyEmail(pr: PurchaseRequest) {
    // Requires RESEND_API_KEY set in edge function secrets
    const to = process.env.NEXT_PUBLIC_ALERT_EMAIL_TO; // set in .env.local
    if (!to) return;
    await callEdge('notify-email', {
      to,
      subject: `Low Stock: ${pr.sku ?? ''} — ${pr.name ?? ''}`,
      html: `
        <h2>Low Stock Alert</h2>
        <p>SKU: <b>${pr.sku ?? ''}</b><br/>
        Item: <b>${pr.name ?? ''}</b><br/>
        Current: <b>${pr.current_stock ?? '-'}</b> • Min: <b>${pr.min_stock ?? '-'}</b><br/>
        PR ID: <b>${pr.id}</b></p>
      `,
    });
    setToast('Email sent');
  }

  async function notifyWhatsapp(pr: PurchaseRequest) {
    const to = process.env.NEXT_PUBLIC_ALERT_WA_TO; // like "whatsapp:+91XXXXXXXXXX"
    if (!to) return;
    await callEdge('notify-whatsapp', {
      to,
      body: `LOW STOCK\nSKU: ${pr.sku ?? ''}\nItem: ${pr.name ?? ''}\nStock: ${pr.current_stock ?? '-'} / Min: ${pr.min_stock ?? '-'}\nPR: ${pr.id}`,
    });
    setToast('WhatsApp sent');
  }

  /* --------------------------------
     PRINT thermal labels (unchanged)
     -------------------------------- */
  const handlePrintThermal = () => {
    const selectedItems = (() => {
      const arr: { row: InvRow & { unitCostGst: number; sellingPrice: number; total_value: number }; qty: number }[] = [];
      for (const r of sorted) {
        const s = sel[r.id];
        if (s?.checked && r.sku) arr.push({ row: r, qty: Math.max(1, Math.min(500, Math.floor(s.qty || 1))) });
      }
      return arr;
    })();

    const totalLabels = selectedItems.reduce((sum, it) => sum + it.qty, 0);
    if (totalLabels === 0) {
      alert('Please select items and set label quantities.');
      return;
    }
    const html = previewRef.current?.innerHTML || '';
    if (!html) {
      alert('Please select items (checkbox) and set quantities first.');
      return;
    }

    const docHtml = `<!doctype html>
<html><head><meta charset="utf-8"><title>Thermal 2x1 Labels</title>
<style>
@page { size: 50.8mm 25.4mm; margin: 0; }
html, body { margin: 0; padding: 0; background: #fff; }
.sheet { width: 50.8mm; height: 25.4mm; page-break-after: always; }
.thermal-label-2x1 { width: 50.8mm; height: 25.4mm; padding: 1.5mm; box-sizing: border-box; border: none !important; background: #fff; display: flex; flex-direction: column; gap: 0.6mm; justify-content: space-between; }
.thermal-label-2x1 .label-row { display: flex; align-items: center; gap: 1mm; width: 100%; flex: 1; min-height: 0; }
.thermal-label-2x1 .label-row .barcode-wrap { flex: 1 1 auto; min-width: 0; }
.thermal-label-2x1 .label-row .qr-wrap { flex: 0 0 11mm; width: 11mm; height: 11mm; }
.thermal-label-2x1 .label-row .barcode-wrap svg { display: block; width: 100% !important; height: auto !important; }
.thermal-label-2x1 .label-row .qr-wrap svg { display: block; width: 100% !important; height: 100% !important; }
svg text { font-size: 8px; }
</style></head><body>
${(() => {
  const c = document.createElement('div'); c.innerHTML = html;
  return Array.from(c.children).map(el => `<div class="sheet">${(el as HTMLElement).outerHTML}</div>`).join('');
})()}
</body></html>`;

    const iframe = document.createElement('iframe');
    iframe.setAttribute('style', 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;');
    document.body.appendChild(iframe);

    const onFrameLoad = () => {
      try {
        const w = iframe.contentWindow!;
        const d = w.document;
        d.open(); d.write(docHtml); d.close();
        setTimeout(() => {
          w.focus(); w.print();
          const cleanup = () => { try { document.body.removeChild(iframe); } catch {} };
          w.addEventListener('afterprint', cleanup, { once: true });
          setTimeout(cleanup, 1500);
        }, 300);
      } catch (err) {
        console.error('Print failed:', err);
        try { document.body.removeChild(iframe); } catch {}
        alert('Printing failed. Please try again.');
      }
    };
    if (iframe.contentWindow?.document?.readyState === 'complete') onFrameLoad();
    else iframe.onload = onFrameLoad;
  };

  /* --------------------------------
     Estimate (Selected)
     -------------------------------- */
  const estimateSelected = () => {
    const items = Object.entries(sel).flatMap(([id, s]) => {
      if (!s?.checked) return [];
      const row = sorted.find(r => r.id === id);
      if (!row || !row.sku) return [];
      const qty = Math.max(1, Math.min(500, Math.floor(s.qty || 1)));
      const selling = Math.max(0, Math.floor(Number((row as any).sellingPrice ?? 0)));
      return [{
        sku: row.sku, qty,
        name: row.name || row.sku,
        uom_code: row.uom_code || '',
        selling,
      }];
    });

    if (items.length === 0) {
      alert('Select items (checkbox) and set quantities to create Estimate.');
      return;
    }
    try { localStorage.setItem('estimate-seed', JSON.stringify(items)); } catch {}
    window.open(`/estimate/new?seed=1`, '_blank', 'noopener,noreferrer');
  };

  /* ========= RENDER ========= */
  return (
    <div className="space-y-4">

      {/* Back to Dashboard */}
      <div className="flex items-center justify-end">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
        >
          ← Back to Dashboard
        </Link>
      </div>

      {/* ==================== Low Stock – Purchase Requests (Panel) ==================== */}
      <div className="card border border-amber-300 bg-amber-50">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-amber-800">
            Low Stock – Purchase Requests {loadingPRs ? '(loading...)' : `(${purchaseRequests.length})`}
          </h3>
          <div className="flex gap-2">
            <Button type="button" onClick={loadPurchaseRequests}>Refresh</Button>
          </div>
        </div>

        {purchaseRequests.length === 0 ? (
          <div className="text-sm text-amber-700">No pending purchase requests.</div>
        ) : (
          <div className="overflow-auto">
            <table className="table w-full">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>SKU</th>
                  <th>Item</th>
                  <th className="text-right">Stock</th>
                  <th className="text-right">Min</th>
                  <th>Status</th>
                  <th>Notify / PO</th>
                  <th>Mark</th>
                </tr>
              </thead>
              <tbody>
                {purchaseRequests.map((r) => (
                  <tr key={r.id}>
                    <td>{new Date(r.created_at).toLocaleString()}</td>
                    <td>{r.sku}</td>
                    <td>{r.name}</td>
                    <td className="text-right">{r.current_stock}</td>
                    <td className="text-right">{r.min_stock}</td>
                    <td className="capitalize">{r.status}</td>
                    <td className="space-x-2">
                      {/* B — Email */}
                      <button
                        type="button"
                        className="rounded bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 text-sm"
                        onClick={() => notifyEmail(r)}
                        title="Send Email Alert"
                      >
                        Email
                      </button>
                      {/* C — WhatsApp */}
                      <button
                        type="button"
                        className="rounded bg-green-600 hover:bg-green-700 text-white px-2 py-1 text-sm"
                        onClick={() => notifyWhatsapp(r)}
                        title="Send WhatsApp Alert"
                      >
                        WhatsApp
                      </button>
                      {/* E — PDF PO */}
                      <button
                        type="button"
                        className="rounded bg-gray-800 hover:bg-black text-white px-2 py-1 text-sm"
                        onClick={() => {
                          const supplier = {
                            name: (process.env.NEXT_PUBLIC_DEFAULT_SUPPLIER_NAME || '').trim() || 'Preferred Supplier',
                            email: process.env.NEXT_PUBLIC_DEFAULT_SUPPLIER_EMAIL || '',
                            phone: process.env.NEXT_PUBLIC_DEFAULT_SUPPLIER_PHONE || '',
                            address: process.env.NEXT_PUBLIC_DEFAULT_SUPPLIER_ADDR || '',
                          };
                          openPrintWindow(buildPoHtml({ brand: brandName, supplier, request: r }), 'Purchase Order');
                        }}
                        title="Create and Print Purchase Order PDF"
                      >
                        PO PDF
                      </button>
                    </td>
                    <td className="space-x-2">
                      <button
                        type="button"
                        className="rounded bg-indigo-600 hover:bg-indigo-700 text-white px-2 py-1 text-sm"
                        onClick={() => setPrStatus(r.id, 'ordered')}
                      >
                        Ordered
                      </button>
                      <button
                        type="button"
                        className="rounded bg-emerald-600 hover:bg-emerald-700 text-white px-2 py-1 text-sm"
                        onClick={() => setPrStatus(r.id, 'received')}
                      >
                        Received
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ==================== Inventory ==================== */}
      <div className="card">
        <div className="flex flex-wrap items-end gap-3 mb-3">
          <div className="text-lg font-semibold mr-auto">Inventory</div>

          <input className="input" placeholder="Search by SKU, Name, or Location…" value={search} onChange={(e) => setSearch(e.target.value)} />

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} />
            Low stock only
          </label>

          <div className="flex items-center gap-2">
            <select className="input" value={selectedLocation} onChange={(e) => setSelectedLocation(e.target.value)}>
              <option value="">All locations</option>
              {allLocations.map(loc => <option key={loc} value={loc}>{loc}</option>)}
            </select>

            <select className="input" value={locationScope} onChange={(e) => setLocationScope(e.target.value as LocationScope)}>
              <option value="all_items">Scope: All items</option>
              <option value="has_stock">Scope: Items with stock at location</option>
              <option value="appears_any">Scope: Items that appear at location</option>
            </select>

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={showZeroQtyLocations} onChange={(e) => setShowZeroQtyLocations(e.target.checked)} />
              Show zero-qty
            </label>
          </div>

          <Button type="button" onClick={exportCsv}>Export CSV</Button>
          <Button type="button" onClick={loadInventory}>Refresh</Button>

          <Button
            type="button"
            className="bg-emerald-600 hover:bg-emerald-700"
            onClick={estimateSelected}
            title="Create one Estimate with all selected items and quantities"
          >
            Estimate (Selected)
          </Button>

          <Link href="/estimate/new" className="rounded border px-3 py-2 hover:bg-neutral-50">Estimate</Link>
        </div>

        {/* Thermal labels controls */}
        <div className="mb-4 border rounded p-3 bg-white">
          <div className="flex flex-wrap items-end gap-2">
            <div className="font-semibold">Thermal 2×1 Labels (50.8 mm × 25.4 mm)</div>
            <Button type="button" onClick={() => {
              setSel(prev => {
                const next: Sel = { ...prev };
                for (const r of sorted) if ((r.stock_qty ?? 0) > 0 && r.sku) next[r.id] = { checked: true, qty: next[r.id]?.qty ?? 1 };
                return next;
              });
            }}>Select all (stock &gt; 0)</Button>
            <Button type="button" className="bg-gray-700 hover:bg-gray-800" onClick={() => setSel({})}>Clear selection</Button>

            <div className="ml-auto flex items-end gap-2">
              <div className="flex flex-col">
                <label className="label text-xs">Labels per selected</label>
                <input
                  className="input w-24"
                  type="number"
                  min={1}
                  max={500}
                  value={bulkQtyState}
                  onChange={(e) => setBulkQtyInput(parseInt(e.target.value || '1', 10))}
                />
              </div>
              <Button type="button" onClick={() => {
                setSel(prev => {
                  const next: Sel = { ...prev };
                  for (const r of sorted) if (next[r.id]?.checked) next[r.id] = { checked: true, qty: bulkQtyState };
                  return next;
                });
              }}>Apply to selected</Button>
              <Button type="button" className="bg-gray-700 hover:bg-gray-800" onClick={handlePrintThermal}>Print Thermal 2×1</Button>
            </div>
          </div>

          {/* Preview grid (renders selected labels) */}
          <div className="mt-3">
            <div
              ref={previewRef}
              className="grid gap-2"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}
            >
              {Object.entries(sel).flatMap(([id, s]) => {
                if (!s?.checked) return [];
                const row = sorted.find(r => r.id === id);
                if (!row) return [];
                return Array.from({ length: Math.max(1, Math.min(500, Math.floor(s.qty || 1))) }).map((_, i) => (
                  <div key={`${row.id}-${i}`} style={{
                    width: '50.8mm', height: '25.4mm', padding: '1.5mm',
                    border: '1px solid #e5e7eb', borderRadius: '1mm', background: '#fff'
                  }}>
                    {/* lightweight inline preview */}
                    <div style={{ fontSize: 10, fontWeight: 600 }}>{row.name || row.sku}</div>
                    <div style={{ fontSize: 10 }}>SKU: {row.sku}</div>
                    <div style={{ fontSize: 10 }}>₹{row.sellingPrice}</div>
                  </div>
                ));
              })}
            </div>
          </div>
        </div>

        {/* Inventory table */}
        <div className="table-scroll" style={{ maxHeight: 720, overflow: 'auto' }}>
          <table className="inventory-table">
            <colgroup>
              <col style={{ width: 160 }} />   {/* Select + Create Request */}
              <col style={{ width: 120 }} />
              <col style={{ width: 220 }} />
              <col style={{ width: 80  }} />
              <col style={{ width: 90  }} />
              <col style={{ width: 110 }} />
              <col style={{ width: 120 }} />
              <col style={{ width: 90  }} />
              <col style={{ width: 90  }} />
              <col style={{ width: 140 }} />
              <col style={{ width: 140 }} />
              <col style={{ width: 160 }} />
              <col style={{ width: 140 }} />
              <col style={{ width: 360 }} />
            </colgroup>

            <thead className="sticky-head">
              <tr>
                <th>Select / PR</th>
                <th><SortHeader label="SKU" active={sortKey==='sku'} dir={sortDir} onClick={() => toggleSort('sku')} /></th>
                <th><SortHeader label="Item" active={sortKey==='name'} dir={sortDir} onClick={() => toggleSort('name')} /></th>
                <th><SortHeader label="UoM" active={sortKey==='uom_code'} dir={sortDir} onClick={() => toggleSort('uom_code')} /></th>
                <th className="num"><SortHeader label="Qty" active={sortKey==='stock_qty'} dir={sortDir} onClick={() => toggleSort('stock_qty')} alignRight /></th>
                <th className="num"><SortHeader label="Minimum" active={sortKey==='low_stock_threshold'} dir={sortDir} onClick={() => toggleSort('low_stock_threshold')} alignRight /></th>

                <th className="num">Purchase</th>
                <th className="num">GST %</th>
                <th className="num">Margin %</th>
                <th className="num">Unit Cost (GST)</th>
                <th className="num">Selling</th>
                <th className="num"><SortHeader label="Total Value (₹)" active={sortKey==='total_value'} dir={sortDir} onClick={() => toggleSort('total_value')} alignRight /></th>
                <th>Actions</th>
                <th><SortHeader label="Locations" active={sortKey==='locations_text'} dir={sortDir} onClick={() => toggleSort('locations_text')} /></th>
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr><td colSpan={14} className="py-6 text-center">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={14} className="py-6 text-center">No items found.</td></tr>
              ) : (
                sorted.map((r) => {
                  const s = sel[r.id] || { checked: false, qty: 1 };
                  const isLow =
                    r.low_stock_threshold != null &&
                    r.low_stock_threshold > 0 &&
                    r.stock_qty <= r.low_stock_threshold;

                  return (
                    <tr key={r.id} className={isLow ? 'bg-red-50' : ''}>
                      <td>
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={s.checked}
                            onChange={(e) => setSel(prev => ({ ...prev, [r.id]: { checked: e.target.checked, qty: prev[r.id]?.qty ?? 1 } }))}
                            title="Select"
                          />
                          <input
                            className="input w-16"
                            type="number"
                            min={1}
                            max={500}
                            value={s.qty}
                            onChange={(e) => setSel(prev => ({ ...prev, [r.id]: { checked: prev[r.id]?.checked ?? false, qty: Math.max(1, Math.floor(parseInt(e.target.value || '1', 10))) } }))}
                            title="Labels/Estimate qty for this item"
                          />
                          {isLow && (
                            <button
                              type="button"
                              className="rounded bg-amber-600 hover:bg-amber-700 text-white px-2 py-1 text-xs"
                              onClick={() => createRequestForItem(r)}
                              title="Create Purchase Request now"
                            >
                              Create Request
                            </button>
                          )}
                        </div>
                      </td>
                      <td>{r.sku}</td>
                      <td className="truncate-cell">{r.name}</td>
                      <td>{r.uom_code || '-'}</td>
                      <td className="num">{r.stock_qty}</td>
                      <td className="num">{r.low_stock_threshold != null ? r.low_stock_threshold : '—'}</td>

                      <td className="num">{INR0.format(Number(r.purchase_price ?? r.unit_cost ?? 0))}</td>
                      <td className="num">{Number(r.gst_percent ?? 0).toFixed(2)}%</td>
                      <td className="num">{Number(r.margin_percent ?? 0).toFixed(2)}%</td>
                      <td className="num">{INR0.format(r.unitCostGst)}</td>
                      <td className="num">{INR0.format(r.sellingPrice)}</td>
                      <td className="num">{INR0.format(r.total_value)}</td>

                      <td>
                        <div className="flex gap-2">
                          <Link
                            href={`/estimate/new?sku=${encodeURIComponent(r.sku)}&qty=1`}
                            className="rounded bg-emerald-600 text-white px-2 py-1 text-sm hover:bg-emerald-700"
                          >
                            Estimate
                          </Link>
                          <button
                            className="rounded bg-red-600 text-white px-2 py-1 text-sm hover:bg-red-700"
                            onClick={() => {
                              if ((r.stock_qty ?? 0) > 0) return alert('Cannot delete: move/issue stock to 0 first.');
                              if (!confirm(`Delete item:\n${r.sku} — ${r.name}\n\nThis cannot be undone.`)) return;
                              supabase.from('items').delete().eq('id', r.id).then(({ error }) => {
                                if (error) return alert('Delete failed: ' + error.message);
                                setRows(prev => prev.filter(x => x.id !== r.id));
                              });
                            }}
                            title="Delete item"
                          >
                            Delete
                          </button>
                        </div>
                      </td>

                      <td>
                        {r.locations.length === 0 ? '—' : (
                          <div className="flex flex-wrap gap-1">
                            {r.locations.map(l => (
                              <span key={l.name} className="inline-flex items-center px-2 py-0.5 rounded bg-gray-100 text-xs text-gray-800">
                                {l.name}: {l.qty}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>

            <tfoot>
              <tr className="font-semibold">
                <td colSpan={4} className="text-right">Totals:</td>
                <td className="num">{totals.qty}</td>
                <td className="num">—</td>
                <td className="num">—</td>
                <td className="num">—</td>
                <td className="num">—</td>
                <td className="num">—</td>
                <td className="num">—</td> {/* Selling total not shown */}
                <td className="num">{INR0.format(totals.value)}</td>
                <td>—</td>
                <td>—</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {toast && <Toast text={toast} onClose={() => setToast(null)} />}
    </div>
  );
}
