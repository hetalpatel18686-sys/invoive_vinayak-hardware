'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

// ---------- Helpers ----------
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
        if (img.complete) {
          // try decode anyway to ensure it’s fully ready for print
          // @ts-ignore
          if (img.decode) await img.decode().catch(() => {});
          return;
        }
        await new Promise<void>((resolve) => {
          img.addEventListener('load', () => resolve(), { once: true });
          img.addEventListener('error', () => resolve(), { once: true });
        });
        // @ts-ignore
        if (img.decode) await img.decode().catch(() => {});
      } catch {}
    })
  );
}

// ---------- Page ----------
export default function ReceiptPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const id = String(params?.id || '');
  const autoprint = searchParams.get('autoprint') === '1';

  // Brand (use your existing environment defaults)
  const brandName    = process.env.NEXT_PUBLIC_BRAND_NAME     || 'Vinayak Hardware';
  const brandLogo    = process.env.NEXT_PUBLIC_BRAND_LOGO_URL || '/logo.png';
  const brandAddress = process.env.NEXT_PUBLIC_BRAND_ADDRESS  || 'Bilimora, Gandevi, Navsari, Gujarat, 396321';
  const brandPhone   = process.env.NEXT_PUBLIC_BRAND_PHONE    || '+91 7046826808';

  // Data state
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [payment, setPayment] = useState<any>(null);
  const [invoice, setInvoice] = useState<any>(null);
  const [customer, setCustomer] = useState<any>(null);

  const dataReady = useMemo(
    () => Boolean(payment && invoice),
    [payment, invoice]
  );

  // Fetch payment + invoice + customer
  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setErr(null);

      try {
        // 1) Payment
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
          .select('id, invoice_no, issued_at, grand_total, customer_id')
          .eq('id', pay.invoice_id)
          .single();

        if (e2) throw e2;
        if (!inv) throw new Error('Invoice not found for this payment.');

        // 3) Customer (optional)
        let cust: any = null;
        if (inv.customer_id) {
          const { data: c, error: e3 } = await supabase
            .from('customers')
            .select('id, first_name, last_name, phone, street_name, village_town, city, state, postal_code')
            .eq('id', inv.customer_id)
            .single();
          if (!e3) cust = c;
        }

        if (!cancelled) {
          setPayment(pay);
          setInvoice(inv);
          setCustomer(cust);
        }
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [id]);

  // Auto print when ready
  useEffect(() => {
    if (!autoprint) return;
    if (!dataReady) return;

    let cancelled = false;

    const go = async () => {
      // Wait for fonts + images within print area
      await waitForFontsIfSupported();

      const area = document.querySelector('.print-area') as HTMLElement | null;
      await waitForImages(area);

      // Two RAFs help Chrome/Safari ensure layout is fully painted
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

      if (!cancelled) {
        // Small delay helps Safari avoid blank print
        setTimeout(() => {
          if (!cancelled) window.print();
        }, 120);
      }
    };

    go();
    return () => { cancelled = true; };
  }, [autoprint, dataReady]);

  // UI
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

      <div className="print-area mx-auto max-w-3xl">
        {/* Brand */}
        <div className="mb-3 flex items-start justify-between">
          <div>
            <div className="text-2xl font-bold text-orange-600">{brandName}</div>
            <div className="text-sm text-gray-700">{brandAddress}</div>
            <div className="text-sm text-gray-700">Phone: {brandPhone}</div>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {brandLogo ? <img src={brandLogo} alt="logo" className="h-12 w-12 rounded bg-white object-contain" /> : null}
        </div>

        <div className="border-t pt-3">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-xl font-semibold">Payment Receipt</div>
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

          {/* Status blocks */}
          {loading && (
            <div className="mt-6 text-gray-600">Loading receipt…</div>
          )}
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
              </div>

              {/* Payment summary */}
              <div className="mt-4 overflow-auto">
                <table className="table w-full">
                  <thead>
                    <tr>
                      <th>Method</th>
                      <th>Direction</th>
                      <th>Reference</th>
                      <th className="text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="capitalize">{payment.method}</td>
                      <td className="uppercase">{payment.direction}</td>
                      <td>{payment.reference || '—'}</td>
                      <td className="text-right">{fmt(ceilRupee(payment.amount))}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Meta (card/qr) */}
              {payment?.meta && (
                <div className="mt-3 grid sm:grid-cols-2 gap-3">
                  {/* Card meta */}
                  {(payment.meta.card_holder || payment.meta.card_last4 || payment.meta.card_auth || payment.meta.card_txn) && (
                    <div className="border rounded p-2">
                      <div className="font-semibold mb-1">Card Details</div>
                      <div className="text-sm">Holder: {payment.meta.card_holder || '—'}</div>
                      <div className="text-sm">Last 4: {payment.meta.card_last4 || '—'}</div>
                      <div className="text-sm">Auth Code: {payment.meta.card_auth || '—'}</div>
                      <div className="text-sm">Txn ID: {payment.meta.card_txn || '—'}</div>
                    </div>
                  )}

                  {/* QR/UPI meta */}
                  {(payment.meta.upi_id || payment.meta.qr_txn || payment.meta.qr_image_url) && (
                    <div className="border rounded p-2">
                      <div className="font-semibold mb-1">UPI / QR</div>
                      <div className="text-sm">UPI ID: {payment.meta.upi_id || '—'}</div>
                      <div className="text-sm">Txn ID: {payment.meta.qr_txn || '—'}</div>

                      {payment.meta.qr_image_url ? (
                        <div className="mt-2 flex items-center">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={payment.meta.qr_image_url}
                            alt="QR"
                            className="h-28 w-28 object-contain border rounded"
                          />
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              )}

              {/* Totals recap */}
              <div className="mt-4 border rounded p-3 grid sm:grid-cols-2 gap-3">
                <div className="flex justify-between">
                  <div>Invoice Total</div>
                  <div>{fmt(invoice?.grand_total)}</div>
                </div>
                <div className="flex justify-between">
                  <div>Payment Amount</div>
                  <div className="font-semibold">{fmt(ceilRupee(payment?.amount))}</div>
                </div>
              </div>

              {/* Footer note */}
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
