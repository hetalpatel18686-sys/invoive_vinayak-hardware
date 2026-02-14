'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

export default function NavBar() {
  // --- Hide NavBar on /login (and you can add /signup if you ever create it) ---
  const pathname = usePathname();
  if (pathname === '/login') return null;

  // Brand from env (set in Vercel → Project → Settings → Environment Variables)
  const brandName = process.env.NEXT_PUBLIC_BRAND_NAME || 'Vinayak Hardware';
  const brandLogo = process.env.NEXT_PUBLIC_BRAND_LOGO_URL || '';

  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    // Hard navigation so Back button won’t reveal cached pages
    window.location.replace('/login');
  };

  // small helper for "active" link styling
  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + '/');

  const linkClass = (href: string) =>
    `transition-colors ${
      isActive(href)
        ? 'text-white underline'
        : 'text-white/90 hover:text-white'
    }`;

  return (
    <header className="w-full bg-primary text-white">
      <nav className="mx-auto max-w-6xl flex items-center justify-between px-4 py-3">
        {/* Brand (logo + name) */}
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
            <Link className={linkClass('/customers')} href="/customers">Customers</Link>
            <Link className={linkClass('/items')} href="/items">Items</Link>
            <Link className={linkClass('/invoices/new')} href="/invoices/new">New Invoice</Link>
            <Link className={linkClass('/stock')} href="/stock">Stock</Link>
            {/* ✅ NEW Inventory link */}
            <Link className={linkClass('/inventory')} href="/inventory">Inventory</Link>
            <Link className={linkClass('/reports')} href="/reports">Reports</Link>
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
            <Link className="bg-white/15 hover:bg-white/25 rounded px-3 py-1" href="/login">
              Sign in
            </Link>
          )}
        </div>
      </nav>
    </header>
  );
}
