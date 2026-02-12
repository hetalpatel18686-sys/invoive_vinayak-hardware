
'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import Button from '@/components/Button'

interface Customer { id: string; first_name: string; last_name: string; email?: string|null; phone?: string|null; city?: string|null; state?: string|null; postal_code?: string|null; }

export default function Customers(){
  const [list, setList] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ first_name:'', last_name:'', email:'', phone:'', city:'', state:'', postal_code:'' })

  const load = async () => {
    setLoading(true)
    const { data, error } = await supabase.from('customers').select('*').order('created_at', { ascending: false })
    if(!error && data) setList(data as Customer[])
    setLoading(false)
  }
  useEffect(()=>{ load() }, [])

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    const { error } = await supabase.from('customers').insert([{ ...form }])
    if(!error){ setForm({ first_name:'', last_name:'', email:'', phone:'', city:'', state:'', postal_code:'' }); load() }
    else alert(error.message)
  }

  return (
    <div className="grid md:grid-cols-3 gap-4">
      <div className="card md:col-span-2">
        <h1 className="text-xl font-semibold mb-3">Customers</h1>
        {loading ? <p>Loading...</p> : (
          <table className="table">
            <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>City</th></tr></thead>
            <tbody>
              {list.map(c => (
                <tr key={c.id}>
                  <td>{c.first_name} {c.last_name}</td>
                  <td>{c.email}</td>
                  <td>{c.phone}</td>
                  <td>{c.city}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="card">
        <h2 className="font-semibold mb-2">Add New Customer</h2>
        <form onSubmit={add} className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <input className="input" placeholder="First name" value={form.first_name} onChange={e=>setForm({...form, first_name:e.target.value})} required />
            <input className="input" placeholder="Last name" value={form.last_name} onChange={e=>setForm({...form, last_name:e.target.value})} required />
          </div>
          <input className="input" placeholder="Email" value={form.email} onChange={e=>setForm({...form, email:e.target.value})} />
          <input className="input" placeholder="Phone" value={form.phone} onChange={e=>setForm({...form, phone:e.target.value})} />
          <div className="grid grid-cols-3 gap-2">
            <input className="input" placeholder="City" value={form.city} onChange={e=>setForm({...form, city:e.target.value})} />
            <input className="input" placeholder="State" value={form.state} onChange={e=>setForm({...form, state:e.target.value})} />
            <input className="input" placeholder="ZIP" value={form.postal_code} onChange={e=>setForm({...form, postal_code:e.target.value})} />
          </div>
          <Button type="submit">Save Customer</Button>
        </form>
      </div>
    </div>
  )
}
