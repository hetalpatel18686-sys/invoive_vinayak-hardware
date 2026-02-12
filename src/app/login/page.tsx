
'use client'
import { useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import Button from '@/components/Button'

export default function Login(){
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [msg, setMsg] = useState('')

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setMsg('Signing in...')
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if(error){ setMsg(error.message); return }
    setMsg('Success! Redirecting...')
    window.location.href = '/'
  }

  return (
    <div className="max-w-md mx-auto card">
      <h1 className="text-xl font-semibold mb-4">Sign in</h1>
      <form onSubmit={onSubmit} className="space-y-3">
        <div>
          <label className="label">Email</label>
          <input className="input" value={email} onChange={e=>setEmail(e.target.value)} type="email" required />
        </div>
        <div>
          <label className="label">Password</label>
          <input className="input" value={password} onChange={e=>setPassword(e.target.value)} type="password" required />
        </div>
        <Button type="submit">Sign in</Button>
      </form>
      {msg && <p className="mt-3 text-sm text-gray-600">{msg}</p>}
      <p className="text-xs text-gray-500 mt-4">Tip: Create a user in Supabase Auth (Dashboard → Authentication → Add user), then insert a matching row in <code>profiles</code> with role 'admin'.</p>
    </div>
  )
}
