
'use client'
import Link from 'next/link'
import { supabase } from '@/lib/supabaseClient'
import { useEffect, useState } from 'react'

export default function NavBar(){
  const [email, setEmail] = useState<string | null>(null)
  useEffect(() => {
    supabase.auth.getUser().then(({data})=> setEmail(data.user?.email ?? null))
  }, [])

  const signOut = async () => {
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  return (
    <header className="w-full bg-primary text-white">
      <nav className="mx-auto max-w-6xl flex items-center justify-between px-4 py-3">
        <div className="flex gap-6 text-sm font-medium">
          <Link href="/customers">Customers</Link>
          <Link href="/items">Items</Link>
          <Link href="/invoices/new">New Invoice</Link>
          <Link href="/stock">Stock</Link>
          <Link href="/reports">Reports</Link>
        </div>
        <div className="text-sm">
          {email ? (
            <div className="flex items-center gap-4">
              <span className="opacity-90">{email}</span>
              <button onClick={signOut} className="bg-white/15 hover:bg-white/25 rounded px-3 py-1">Sign out</button>
            </div>
          ) : (
            <Link className="bg-white/15 hover:bg-white/25 rounded px-3 py-1" href="/login">Sign in</Link>
          )}
        </div>
      </nav>
    </header>
  )
}
