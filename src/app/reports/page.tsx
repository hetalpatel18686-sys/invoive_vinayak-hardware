
'use client'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'

export default function Reports(){
  const [invoices, setInvoices] = useState<any[]>([])
  useEffect(()=>{(async()=>{
    const r = await supabase.from('invoices').select('*').order('created_at', {ascending:false}).limit(100)
    setInvoices(r.data ?? [])
  })()},[])

  const totals = useMemo(()=>{
    let grand = 0
    for(const i of invoices) grand += Number(i.grand_total||0)
    return { grand }
  }, [invoices])

  return (
    <div className="card">
      <h1 className="text-xl font-semibold mb-3">Reports</h1>
      <div className="grid md:grid-cols-3 gap-4">
        <div className="card"><div className="text-sm text-gray-600">Grand Total (last 100 invoices)</div><div className="text-2xl font-semibold">${totals.grand.toFixed(2)}</div></div>
      </div>
      <h2 className="font-semibold mt-6 mb-2">Recent Invoices</h2>
      <table className="table">
        <thead><tr><th>No.</th><th>Status</th><th>Issued</th><th>Total</th></tr></thead>
        <tbody>
          {invoices.map(i => (
            <tr key={i.id}><td>{i.invoice_no}</td><td>{i.status}</td><td>{i.issued_at}</td><td>${Number(i.grand_total||0).toFixed(2)}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
