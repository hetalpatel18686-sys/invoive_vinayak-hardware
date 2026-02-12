
'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import Button from '@/components/Button'

interface Item { id:string; name:string }

export default function Stock(){
  const [items, setItems] = useState<Item[]>([])
  const [move, setMove] = useState({ item_id:'', move_type:'receive', qty:0, ref:'', reason:'' })
  const [history, setHistory] = useState<any[]>([])

  useEffect(()=>{(async()=>{
    const i = await supabase.from('items').select('id,name').eq('is_active', true).order('name')
    setItems(i.data as Item[] ?? [])
    loadHistory()
  })()},[])

  const loadHistory = async()=>{
    const h = await supabase.from('stock_moves').select('created_at, move_type, qty, ref, items(name)').order('created_at', {ascending:false}).limit(50)
    setHistory(h.data ?? [])
  }

  const submit = async(e: React.FormEvent)=>{
    e.preventDefault()
    const { error } = await supabase.from('stock_moves').insert([{...move, qty: Number(move.qty)}])
    if(error) alert(error.message)
    else { setMove({ item_id:'', move_type:'receive', qty:0, ref:'', reason:'' }); loadHistory() }
  }

  return (
    <div className="grid md:grid-cols-3 gap-4">
      <div className="card">
        <h2 className="font-semibold mb-2">Receive / Adjust</h2>
        <form onSubmit={submit} className="space-y-3">
          <select className="input" value={move.item_id} onChange={e=>setMove({...move, item_id:e.target.value})} required>
            <option value="">Select item...</option>
            {items.map(i=> <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
          <select className="input" value={move.move_type} onChange={e=>setMove({...move, move_type:e.target.value as any})}>
            <option value="receive">Receive</option>
            <option value="adjust">Adjust</option>
          </select>
          <input className="input" type="number" placeholder="Qty" value={move.qty} onChange={e=>setMove({...move, qty: parseInt(e.target.value||'0')})} required />
          <input className="input" placeholder="Reference (PO# etc.)" value={move.ref} onChange={e=>setMove({...move, ref:e.target.value})} />
          <input className="input" placeholder="Reason" value={move.reason} onChange={e=>setMove({...move, reason:e.target.value})} />
          <Button type="submit">Save</Button>
        </form>
      </div>
      <div className="md:col-span-2 card">
        <h2 className="font-semibold mb-2">Recent Stock Movements</h2>
        <table className="table">
          <thead><tr><th>Date</th><th>Item</th><th>Type</th><th>Qty</th><th>Ref</th></tr></thead>
          <tbody>
            {history.map((h, idx)=> (
              <tr key={idx}><td>{new Date(h.created_at).toLocaleString()}</td><td>{h.items?.name}</td><td>{h.move_type}</td><td>{h.qty}</td><td>{h.ref}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
