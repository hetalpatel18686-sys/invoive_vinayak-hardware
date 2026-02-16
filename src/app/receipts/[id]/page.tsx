'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

/* ----------------- Helpers ----------------- */
function ceilRupee(n: number) {
  const x = Number(n || 0);
  return Number.isFinite(x) ? Math.ceil(x) : 0;
}
const fmt = (n?: number | null) => `₹ ${(Number(n || 0)).toFixed(2)}`;

function fullName(c: any) {
  return [c?.first_name, c?.last_name].filter(Boolean).join(' ').trim();
}
function oneLineAddress(c: any) {
  return [c?.street_name, c?.village_town, c?.city, c?.postal_code, c?.state]
    .filter(Boolean)
    .map((s: any) => String(s).trim())
    .join(', ');
}

async function waitForFontsIfSupported() {
  try {
    // @ts-ignore
    if (document?.fonts?.ready) {
      // @ts-ignore
      await document.fonts.ready;
    }
  } catch {}
}
async function waitForImages(container: HTMLElement | null) {
  if (!container) return;
  const imgs = Array.from(container.querySelectorAll('img')) as HTMLImageElement[];
  await Promise.all(
    imgs.map(async (img) => {
      try {
        if (!img.complete) {
          await new Promise<void>((resolve) => {
            img.addEventListener('load', () => resolve(), { once: true });
            img.addEventListener('error', () => resolve(), { once: true });
          });
        }
        // @ts-ignore
        if (img.decode) await img.decode().catch(() => {});
      } catch {}
    })
  );
}

/* ----------------- Page ----------------- */
export default function ReceiptPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const id = String(params?.id || '');
  const autoprint = searchParams.get('autoprint') === '1';

  // Brand (same defaults as invoice page)
  const brandName    = process.env.NEXT_PUBLIC_BRAND_NAME     || 'Vinayak Hardware';
  const brandLogo    = process.env.NEXT_PUBLIC_BRAND_LOGO_URL || '/logo.png';
  const brandAddress = process.env.NEXT_PUBLIC_BRAND_ADDRESS  || 'Bilimora, Gandevi, Navsari, Gujarat, 396321';
  const brandPhone   = process.env.NEXT_PUBLIC_BRAND_PHONE    || '+91 7046826808';

  const [logoReady, setLogoReady] = useState(false);

  // Data state
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [payment, setPayment] = useState<any>(null);
  const [invoice, setInvoice] = useState<any>(null);
  const [customer, setCustomer] = useState<any>(null);

  // Invoice lines + lookups
  const [lines, setLines] = useState<any[]>([]);
  const [itemsById, setItemsById] = useState<Map<string, any>>(new Map());
  const [uomCodeById, setUomCodeById] = useState<Map<string, string>>(new Map());

  // 🔥 All payments for the invoice (to compute Paid In/Out/Net/Balance like your first screenshot)
  const [allPayments, setAllPayments] = useState<any[]>([]);

  const dataReady = useMemo(
    () => Boolean(payment && invoice),
    [payment, invoice]
  );

  // Totals recomputed from lines (in case invoice.grand_total absent)
  const computedTotals = useMemo(() => {
    let subtotal = 0;
    let tax = 0;
    for (const ln of lines) {
      const line = ceilRupee(Number(ln.line_total || 0));
      subtotal += line;
      const lineTax = ceilRupee(line * (Number(ln.tax_rate || 0) / 100));
      tax += lineTax;
    }
    return { subtotal: ceilRupee(subtotal), tax: ceilRupee(tax), grand: ceilRupee(subtotal + tax) };
  }, [lines]);

  // 🔢 Payment summary (like your first screenshot)
  const paymentSummary = useMemo(() => {
    const paidIn = allPayments
      .filter(p => p.direction === 'in' && !p.is_void)
      .reduce((s, p) => s + Number(p.amount || 0), 0);
    const paidOut = allPayments
      .filter(p => p.direction === 'out' && !p.is_void)
      .reduce((s, p) => s + Number(p.amount || 0), 0);

    const paidInC  = ceilRupee(paidIn);
    const paidOutC = ceilRupee(paidOut);

    const total = Number(invoice?.grand_total ?? computedTotals.grand ?? 0);
    // Balance Due = Total - PaidIn + PaidOut
    const balance = ceilRupee(total - paidInC + paidOutC);

    return {
      paidIn: paidInC,
      paidOut: paidOutC,
      netPaid: ceilRupee(paidInC - paidOutC),
      balance,
    };
  }, [allPayments, invoice?.grand_total, computedTotals.grand]);

  /* -------- Fetch payment + invoice + customer + items + ALL payments -------- */
  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setErr(null);

      try {
        // 1) Payment (current)
        const { data: pay, error: e1 } = await supabase
          .from('payments')
          .select('id, invoice_id, method, direction, amount, reference, meta, created_at, is_void')
          .eq('id', id)
          .single();

        if (e1) throw e1;
        if (!pay) throw new Error('Payment not found.');
        if (pay.is_void) throw new Error('This payment is void.');

        // 2) Invoice
        const { data: inv, error: e2 } = await supabase
          .from('invoices')
          .select('id, invoice_no, issued_at, grand_total, subtotal, tax_total, notes, customer_id, doc_type')
          .eq('id', pay.invoice_id)
          .single();
        if (e2) throw e2;
        if (!inv) throw new Error('Invoice not found for this payment.');

        // 3) Customer
        let cust: any = null;
        if (inv.customer_id) {
          const { data: c, error: e3 } = await supabase
            .from('customers')
            .select('id, first_name, last_name, phone, street_name, village_town, city, state, postal_code')
            .eq('id', inv.customer_id)
            .single();
          if (!e3) cust = c;
        }

        // 4) Invoice items
        const { data: invLines, error: e4 } = await supabase
          .from('invoice_items')
          .select('item_id, description, qty, unit_price, tax_rate, line_total')
          .eq('invoice_id', inv.id);
        if (e4) throw e4;

        // 5) Item lookups (sku, name, uom_id)
        const uniqueItemIds = Array.from(
          new Set((invLines || []).map((ln: any) => ln.item_id).filter(Boolean))
        );

        let itemsMap = new Map<string, any>();
        let uomMap = new Map<string, string>();

        if (uniqueItemIds.length > 0) {
          const { data: items, error: e5 } = await supabase
            .from('items')
            .select('id, sku, name, uom_id')
            .in('id', uniqueItemIds);
          if (e5) throw e5;

          (items || []).forEach((it: any) => itemsMap.set(it.id, it));

          const uomIds = Array.from(new Set((items || []).map((it: any) => it?.uom_id).filter(Boolean)));
          if (uomIds.length > 0) {
            const { data: uoms, error: e6 } = await supabase
              .from('units_of_measure')
              .select('id, code')
              .in('id', uomIds);
            if (e6) throw e6;
            (uoms || []).forEach((u: any) => uomMap.set(u.id, u.code));
          }
        }

        // 6) 🔥 Load all non-void payments for this invoice for the summary & table
        const { data: pays, error: e7 } = await supabase
          .from('payments')
          .select('id, method, direction, amount, reference, created_at, is_void')
          .eq('invoice_id', inv.id)
          .eq('is_void', false)
          .order('created_at', { ascending: true }); // oldest first
        if (e7) throw e7;

        if (!cancelled) {
          setPayment(pay);
          setInvoice(inv);
          setCustomer(cust);
          setLines(invLines || []);
          setItemsById(itemsMap);
          setUomCodeById(uomMap);
          setAllPayments(pays || []);
        }
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [id]);

  /* -------- Auto print when ready (fonts, logo, images) -------- */
  useEffect(() => {
    if (!autoprint) return;
    if (!dataReady) return;

    let cancelled = false;
    const go = async () => {
      await waitForFontsIfSupported();

      const area = document.querySelector('.print-area') as HTMLElement | null;
      await waitForImages(area);

      // Give a moment for the logo if not yet ready
      if (brandLogo && !logoReady) {
        await new Promise(r => setTimeout(r, 120));
      }

      // Two RAF frames help Chrome/Safari settle layout
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

      if (!cancelled) {
        setTimeout(() => { if (!cancelled) window.print(); }, 120);
      }
    };
    go();

    return () => { cancelled = true; };
  }, [autoprint, dataReady, brandLogo, logoReady]);

  const docTitle = invoice?.doc_type === 'return' ? 'Return Receipt' : 'Payment Receipt';

  return (
    <div className="min-h-screen bg-white p-4 print:p-0">
      <style>{`
        @media print {
          @page { margin: 8mm; }
          body * { visibility: hidden !important; }
          .print-area, .print-area * { visibility: visible !important; }
          .print-area { position: absolute; left: 0; top: 0; width: 100%; }
          .no-print { display: none !important; }
        }
      `}</style>

      {/* Controls (not printed) */}
      <div className="no-print mb-4 flex gap-2">
        <button
          type="button"
          onClick={() => window.print()}
          className="px-3 py-2 rounded bg-gray-800 text-white hover:bg-gray-900"
        >
          Print
        </button>
        <button
          type="button"
          onClick={() => window.close()}
          className="px-3 py-2 rounded bg-gray-200 hover:bg-gray-300"
        >
          Close
        </button>
      </div>

      <div className="print-area mx-auto max-w-4xl">
        {/* Brand header — logo on the LEFT */}
        <div className="mb-3 flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {brandLogo ? (
            <img
              src={brandLogo}
              alt="logo"
              className="h-14 w-14 rounded bg-white object-contain print:opacity-100"
              onLoad={() => setLogoReady(true)}
              onError={() => setLogoReady(true)}
            />
          ) : null}
          <div>
            <div className="text-2xl font-bold text-orange-600">{brandName}</div>
            <div className="text-sm text-gray-700">{brandAddress}</div>
            <div className="text-sm text-gray-700">Phone: {brandPhone}</div>
          </div>
        </div>

        {/* Heading */}
        <div className="border-t pt-3">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-xl font-semibold">{docTitle}</div>
              {invoice?.invoice_no ? (
                <div className="text-sm text-gray-700">For Invoice: {invoice.invoice_no}</div>
              ) : null}
              <div className="text-sm text-gray-700">
                Date: {payment?.created_at ? new Date(payment.created_at).toLocaleString() : '—'}
              </div>
            </div>
            <div className="text-right">
              {payment?.id ? <div className="text-sm text-gray-700">Receipt ID: {payment.id}</div> : null}
            </div>
          </div>

          {/* Status */}
          {loading && <div className="mt-6 text-gray-600">Loading…</div>}
          {err && !loading && (
            <div className="mt-6 text-red-700 bg-red-50 border border-red-200 rounded p-3">{err}</div>
          )}

          {/* Content */}
          {!loading && !err && dataReady && (
            <>
              {/* Bill To */}
              <div className="mt-4">
                <div className="font-semibold">Bill To</div>
                <div>{customer ? fullName(customer) : '—'}</div>
                <div className="text-sm text-gray-700">
                  {customer ? oneLineAddress(customer) : '—'}
                </div>
                {customer?.phone ? (
                  <div className="text-sm text-gray-700">Phone: {customer.phone}</div>
                ) : null}
                {invoice?.notes ? (
                  <div className="text-sm text-gray-700 mt-1">Notes: {invoice.notes}</div>
                ) : null}
              </div>

              {/* --- Invoice Items --- */}
              <div className="mt-5">
                <div className="font-semibold mb-2">Invoice Items</div>
                {lines.length === 0 ? (
                  <div className="text-sm text-gray-600">No items found for this invoice.</div>
                ) : (
                  <div className="overflow-auto">
                    <table className="table w-full">
                      <thead>
                        <tr>
                          <th>SKU</th>
                          <th style={{ minWidth: 220 }}>Description</th>
                          <th>UoM</th>
                          <th className="text-right">Qty</th>
                          <th className="text-right">Unit</th>
                          <th className="text-right">Tax %</th>
                          <th className="text-right">Line Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lines.map((ln, idx) => {
                          const it = ln.item_id ? itemsById.get(ln.item_id) : null;
                          const uomCode = it?.uom_id ? (uomCodeById.get(it.uom_id) || '') : '';
                          return (
                            <tr key={idx}>
                              <td>{it?.sku || ''}</td>
                              <td>{ln.description || it?.name || ''}</td>
                              <td>{uomCode || '-'}</td>
                              <td className="text-right">{Number(ln.qty || 0)}</td>
                              <td className="text-right">{fmt(ceilRupee(ln.unit_price))}</td>
                              <td className="text-right">{Number(ln.tax_rate || 0).toFixed(2)}</td>
                              <td className="text-right">{fmt(ceilRupee(ln.line_total))}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td colSpan={5}></td>
                          <td className="text-right font-medium">Subtotal</td>
                          <td className="text-right">{fmt(computedTotals.subtotal)}</td>
                        </tr>
                        <tr>
                          <td colSpan={5}></td>
                          <td className="text-right font-medium">Tax</td>
                          <td className="text-right">{fmt(computedTotals.tax)}</td>
                        </tr>
                        <tr className="font-semibold">
                          <td colSpan={5}></td>
                          <td className="text-right">Total</td>
                          <td className="text-right">{fmt(invoice?.grand_total ?? computedTotals.grand)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>

              {/* --- Payment section (table + 2 summary cards) --- */}
              <div className="mt-5">
                <div className="font-semibold mb-2">Payments</div>
                {/* Table of all payments for this invoice */}
                {allPayments.length === 0 ? (
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
                          <th className="text-right">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {allPayments.map(p => (
                          <tr key={p.id}>
                            <td>{p.created_at ? new Date(p.created_at).toLocaleString() : '—'}</td>
                            <td className="capitalize">{p.method}</td>
                            <td className="uppercase">{p.direction}</td>
                            <td>{p.reference || '—'}</td>
                            <td className="text-right">{fmt(ceilRupee(p.amount))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Two summary cards below the table (like your first screenshot) */}
                <div className="mt-2 grid sm:grid-cols-2 gap-3">
                  <div className="border rounded p-2">
                    <div className="flex justify-between"><div>Paid In</div><div>{fmt(paymentSummary.paidIn)}</div></div>
                    <div className="flex justify-between"><div>Refunded (Out)</div><div>{fmt(paymentSummary.paidOut)}</div></div>
                    <div className="flex justify-between font-semibold"><div>Net Paid</div><div>{fmt(paymentSummary.netPaid)}</div></div>
                  </div>
                  <div className="border rounded p-2">
                    <div className="flex justify-between font-semibold">
                      <div>Balance Due</div>
                      <div>{fmt(paymentSummary.balance)}</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* --- Totals recap (kept for clarity) --- */}
              <div className="mt-5 border rounded p-3 grid sm:grid-cols-2 gap-3">
                <div className="flex justify-between">
                  <div>Invoice Total</div>
                  <div>{fmt(invoice?.grand_total ?? computedTotals.grand)}</div>
                </div>
                <div className="flex justify-between">
                  <div>Payment Amount</div>
                  <div className="font-semibold">{fmt(ceilRupee(payment?.amount))}</div>
                </div>
              </div>

              <div className="mt-6 text-center text-sm text-gray-600">
                Thank you for your business.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
