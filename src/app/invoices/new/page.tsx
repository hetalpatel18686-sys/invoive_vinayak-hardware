
'use client'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import Button from '@/components/Button'

interface Customer { id:string; first_name:string; last_name:string }
interface Item { id:string; name:string; unit_price:number; tax_rate:number }

interface Row { id:string; item_id:string; qty:number; unit_price:number; tax_rate:number; description?:string }

export default function NewInvoice(){
  const [customers, setCustomers] = useState<Customer[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [customerId, setCustomerId] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(()=>{(async()=>{
    const c = await supabase.from('customers').select('id,first_name,last_name').order('first_name')
    const i = await supabase.from('items').select('id,name,unit_price,tax_rate').eq('is_active', true)
    setCustomers(c.data as Customer[] ?? [])
    setItems(i.data as Item[] ?? [])
    setRows([{ id: crypto.randomUUID(), item_id:'', qty:1, unit_price:0, tax_rate:0 }])
  })()},[])

  const totals = useMemo(()=>{
    let subtotal = 0, tax = 0
    for(const r of rows){
      const line = r.qty * r.unit_price
      subtotal += line
      tax += line * (r.tax_rate/100)
    }
    const grand = subtotal + tax
    return { subtotal, tax, grand }
  }, [rows])

  const setItem = (rowId:string, itemId:string) => {
    const it = items.find(x=>x.id===itemId)
    setRows(rows.map(r=> r.id===rowId ? { ...r, item_id:itemId, unit_price: it?.unit_price||0, tax_rate: it?.tax_rate||0, description: it?.name } : r ))
  }

  const save = async () => {
    if(!customerId) return alert('Select a customer')
    if(rows.length===0 || !rows[0].item_id) return alert('Add at least one line item')
    setSaving(true)
    try{
      const invoiceNo = 'INV-' + Date.now()
      const { data: inv, error: e1 } = await supabase.from('invoices').insert([{
        invoice_no: invoiceNo,
        customer_id: customerId,
        notes,
        subtotal: totals.subtotal,
        tax_total: totals.tax,
        grand_total: totals.grand,
        status: 'sent',
        issued_at: new Date().toISOString().slice(0,10)
      }]).select().single()
      if(e1) throw e1

      const lineRows = rows.map(r=>({
        invoice_id: inv.id,
        item_id: r.item_id,
        description: r.description,
        qty: r.qty,
        unit_price: r.unit_price,
        tax_rate: r.tax_rate,
        line_total: r.qty * r.unit_price
      }))
      const { error: e2 } = await supabase.from('invoice_items').insert(lineRows)
      if(e2) throw e2

      // Issue stock for each item
      const issues = rows.map(r=>({ item_id: r.item_id, move_type:'issue', qty: r.qty, ref: inv.invoice_no, reason: 'Invoice issue' }))
      const { error: e3 } = await supabase.from('stock_moves').insert(issues)
      if(e3) throw e3

      alert('Saved invoice #' + invoiceNo)
      window.location.href = '/reports'
    }catch(err:any){
      alert(err.message)
    }finally{
      setSaving(false)
    }
  }

  return (
    <div className="card">
      <h1 className="text-xl font-semibold mb-4">New Invoice</h1>
      <div className="grid md:grid-cols-3 gap-3 mb-4">
        <div>
          <label className="label">Customer</label>
          <select className="input" value={customerId} onChange={e=>setCustomerId(e.target.value)}>
            <option value="">Select...</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>)}
          </select>
        </div>
        <div className="md:col-span-2">
          <label className="label">Notes</label>
          <input className="input" value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Private notes (not printed)" />
        </div>
      </div>

      <table className="table">
        <thead><tr><th style={{width:'40%'}}>Item</th><th>Qty</th><th>Price</th><th>Tax %</th><th>Line</th><th></th></tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id}>
              <td>
                <select className="input" value={r.item_id} onChange={e=> setItem(r.id, e.target.value)}>
                  <option value="">Select item...</option>
                  {items.map(i=> <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
              </td>
              <td><input className="input" type="number" min={1} value={r.qty} onChange={e=> setRows(rows.map(x=> x.id===r.id? {...x, qty: parseFloat(e.target.value)||0}: x))}/></td>
              <td><input className="input" type="number" step="0.01" value={r.unit_price} onChange={e=> setRows(rows.map(x=> x.id===r.id? {...x, unit_price: parseFloat(e.target.value)||0}: x))}/></td>
              <td><input className="input" type="number" step="0.01" value={r.tax_rate} onChange={e=> setRows(rows.map(x=> x.id===r.id? {...x, tax_rate: parseFloat(e.target.value)||0}: x))}/></td>
              <td>${(r.qty*r.unit_price).toFixed(2)}</td>
              <td><button onClick={()=> setRows(rows.filter(x=> x.id!==r.id))} className="text-red-600">✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3">
        <button className="text-primary" onClick={()=> setRows([...rows, { id: crypto.randomUUID(), item_id:'', qty:1, unit_price:0, tax_rate:0 }])}>+ Add Line</button>
      </div>

      <div className="mt-6 grid md:grid-cols-2">
        <div></div>
        <div className="card">
          <div className="flex justify-between"><span>Subtotal</span><span>${totals.subtotal.toFixed(2)}</span></div>
          <div className="flex justify-between"><span>Tax</span><span>${totals.tax.toFixed(2)}</span></div>
          <div className="flex justify-between font-semibold text-lg"><span>Grand Total</span><span>${totals.grand.toFixed(2)}</span></div>
          <Button className="mt-3" disabled={saving} onClick={save}>{saving? 'Saving...' : 'Save Invoice'}</Button>
        </div>
      </div>
    </div>
  )
}
