'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import Button from '@/components/Button'

type MoveType = 'receive' | 'adjust' | 'issue' | 'return'

interface FoundItem {
  id: string
  sku: string
  name: string | null
  description?: string | null
}

export default function Stock(){
  // --- State for SKU-based flow ---
  const [sku, setSku] = useState('')                          // user types SKU here
  const [found, setFound] = useState<FoundItem | null>(null)  // item we find by SKU

  const [moveType, setMoveType] = useState<MoveType>('receive')
  const [qty, setQty] = useState<number>(0)
  const [ref, setRef] = useState('')
  const [reason, setReason] = useState('')
  const [history, setHistory] = useState<any[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(()=>{ loadHistory() },[])

  // Load last 50 moves for the right-hand table
  const loadHistory = async()=>{
    const h = await supabase
      .from('stock_moves')
      .select('created_at, move_type, qty, ref, items(name, sku)')
      .order('created_at', {ascending:false})
      .limit(50)
    setHistory(h.data ?? [])
  }

  // Find item by SKU
  const findBySku = async () => {
    setFound(null)
    if(!sku.trim()) { alert('Please enter SKU'); return }
    const { data, error } = await supabase
      .from('items')
      .select('id, sku, name, description')
      .eq('sku', sku.trim())
      .limit(1)
    if(error) { alert(error.message); return }
    if(!data || data.length === 0){
      alert('No item found for this SKU'); 
      return
    }
    setFound(data[0] as FoundItem)
  }

  // Save stock move using found item id
  const submit = async(e: React.FormEvent)=>{
    e.preventDefault()
    if(!found) { alert('Please find an item by SKU first'); return }
    if(!qty || qty <= 0) { alert('Quantity must be > 0'); return }

    setLoading(true)
    try{
      const payload = {
        item_id: found.id,
        move_type: moveType,      // string value; PostgREST will cast to enum if your column is ENUM
        qty: Number(qty),
        ref: ref || null,
        reason: reason || null,
      }
      const { error } = await supabase.from('stock_moves').insert([payload])
      if(error) throw error

      // Clear only what you want to reset after save:
      setQty(0)
      setRef('')
      setReason('')
      await loadHistory()
    }catch(err:any){
      alert(err.message)
    }finally{
      setLoading(false)
    }
  }

  return (
    <div className="grid md:grid-cols-3 gap-4">
      {/* LEFT: Entry form */}
      <div className="card">
        <h2 className="font-semibold mb-3">Receive / Adjust</h2>

        <form onSubmit={submit} className="space-y-3">
          {/* SKU input + Find button */}
          <div className="flex gap-2">
            <input
              className="input"
              placeholder="SKU (e.g., TEST-1)"
              value={sku}
              onChange={e => setSku(e.target.value)}
              onKeyDown={e => { if(e.key === 'Enter'){ e.preventDefault(); findBySku() } }}
            />
            <Button type="button" onClick={findBySku}>Find</Button>
          </div>

          {/* Read-only item preview */}
          <div>
            <label className="label">Item</label>
            <input
              className="input"
              value={found ? `${found.name ?? ''}${found.description ? ' — ' + found.description : ''}` : ''}
              placeholder="(description will appear after Find)"
              readOnly
            />
          </div>

          {/* Move type */}
          <div>
            <label className="label">Type</label>
            <select className="input" value={moveType} onChange={e=> setMoveType(e.target.value as MoveType)}>
              <option value="receive">Receive</option>
              <option value="adjust">Adjust</option>
              <option value="return">Return</option>
              <option value="issue">Issue</option>
            </select>
          </div>

          {/* Qty */}
          <div>
            <label className="label">Qty</label>
            <input className="input" type="number" min={1} value={qty} onChange={e=> setQty(parseInt(e.target.value||'0'))} />
          </div>

          {/* Ref & Reason */}
          <input className="input" placeholder="Reference (PO# etc.)" value={ref} onChange={e=> setRef(e.target.value)} />
          <input className="input" placeholder="Reason / Note" value={reason} onChange={e=> setReason(e.target.value)} />

          <Button type="submit" disabled={loading || !found}>{loading ? 'Saving...' : 'Save'}</Button>
        </form>
      </div>

      {/* RIGHT: History */}
      <div className="md:col-span-2 card">
        <h2 className="font-semibold mb-2">Recent Stock Movements</h2>
        <table className="table">
          <thead>
            <tr><th>Date</th><th>Item</th><th>Type</th><th>Qty</th><th>Ref</th></tr>
          </thead>
          <tbody>
            {history.map((h, idx)=> (
              <tr key={idx}>
                <td>{new Date(h.created_at).toLocaleString()}</td>
