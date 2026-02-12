'use client';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import { useEffect, useState } from 'react';

export default function NavBar() {
  // ✅ 1) Hide NavBar on the login page
  if (typeof window !== 'undefined') {
    if (window.location.pathname === '/login') {
      return null;
    }
  }

  // Brand from environment variables (set in Vercel → Settings → Environment Variables)
  const brandName = process.env.NEXT_PUBLIC_BRAND_NAME || 'Vinayak Hardware';
  const brandLogo = process.env.NEXT_PUBLIC_BRAND_LOGO_URL || '';

  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    window.location.href = '/login';
  };

  return (
    <header className="w-full bg-primary text-white">
      <nav className="mx-auto max-w-6xl flex items-center justify-between px-4 py-3">
        {/* ✅ 2) Brand (logo + name) on the left */}
        <div className="flex items-center gap-3">
          {brandLogo ? (
            <img
              src={brandLogo}
              alt="logo"
              className="h-7 w-7 rounded bg-white object-contain"
            />
          ) : null}
          <span className="font-semibold">{brandName}</span>

          {/* Main navigation links */}
          <div className="flex gap-6 text-sm font-medium ml-6">
            <Link href="/customers">Customers</Link>
            <Link href="/items">Items</Link>
            <Link href="/invoices/new">New Invoice</Link>
            <Link href="/stock">Stock</Link>
            <Link href="/reports">Reports</Link>
          </div>
        </div>

        {/* Right side: user or sign in */}
        <div className="text-sm">
          {email ? (
            <div className="flex items-center gap-4">
              <span className="opacity-90">{email}</span>
              <button
                onClick={signOut}
                className="bg-white/15 hover:bg-white/25 rounded px-3 py-1"
              >
                Sign out
              </button>
            </div>
          ) : (
            <Link
              className="bg-white/15 hover:bg-white/25 rounded px-3 py-1"
              href="/login"
            >
              Sign in
            </Link>
          )}
        </div>
      </nav>
    </header>
  );
}
